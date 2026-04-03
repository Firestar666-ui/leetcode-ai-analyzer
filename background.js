// LeetCode AI Analyzer - Background Service Worker
// 处理 GLM API 请求，绕过 CORS 限制
// 监听 SPA 路由变化，自动注入 content script

const DEFAULT_GLM_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
// ==================== 获取存储的配置 ====================
async function getConfig() {
  try {
    const result = await chrome.storage.sync.get('lcAiConfig');
    return result.lcAiConfig || {};
  } catch (e) {
    return {};
  }
}

// ==================== SPA 路由监听 & 自动注入 ====================

/**
 * 检查 URL 是否是 LeetCode 提交相关页面
 */
function isLeetCodeSubmissionPage(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'leetcode.cn') return false;
    const pathname = u.pathname;
    // 提交详情页：/submissions/detail/{id}/
    if (/\/submissions\/detail\/\d+/.test(pathname)) return true;
    // 提交列表页：/problems/{slug}/submissions/
    if (/\/problems\/[^\/]+\/submissions\/?$/.test(pathname)) return true;
    // 兼容旧格式
    if (/\/problems\/[^\/]+\/submissions\/\d+/.test(pathname)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 向指定 tab 注入 content script
 */
async function injectContentScript(tabId) {
  try {
    // 通过 executeScript 主动注入 JS
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    console.log('[LeetCode AI] content.js 注入成功, tab:', tabId);

    // 注入 CSS（executeScript 注入的脚本不会自动加载 manifest 中声明的 CSS）
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css']
      });
      console.log('[LeetCode AI] content.css 注入成功, tab:', tabId);
    } catch (cssErr) {
      // CSS 可能已经注入过，忽略错误
      console.log('[LeetCode AI] CSS 注入跳过（可能已存在）:', cssErr.message);
    }
  } catch (err) {
    console.error('[LeetCode AI] 注入 content script 失败:', err.message);
  }
}

/**
 * 获取注入标记 key
 */
function getInjectionKey(tabId, url) {
  return `injected_${tabId}_${url}`;
}

/**
 * 设置注入标记（防止重复注入）
 */
async function markInjected(tabId, url) {
  try {
    await chrome.storage.session.set({ [getInjectionKey(tabId, url)]: true });
  } catch (e) {
    // storage.session 可能不可用，忽略
  }
}

/**
 * 检查是否已注入
 */
async function isAlreadyInjected(tabId, url) {
  try {
    const result = await chrome.storage.session.get(getInjectionKey(tabId, url));
    return !!result[getInjectionKey(tabId, url)];
  } catch (e) {
    return false;
  }
}

// 监听 SPA 路由变化（history.pushState / replaceState）
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  const { tabId, url, frameId } = details;

  // 只处理主框架
  if (frameId !== 0) return;

  if (!isLeetCodeSubmissionPage(url)) return;

  // 检查是否已注入
  if (await isAlreadyInjected(tabId, url)) return;

  console.log('[LeetCode AI] 检测到提交页面导航，主动注入, URL:', url);
  await markInjected(tabId, url);
  await injectContentScript(tabId);
});

// 监听页面完成加载（处理直接打开/刷新的情况）
chrome.webNavigation.onCompleted.addListener(async (details) => {
  const { tabId, url, frameId } = details;

  if (frameId !== 0) return;
  if (!isLeetCodeSubmissionPage(url)) return;

  // 这里不需要额外处理，因为 manifest 中的 content_scripts 已经会自动加载
  // 但为了保险，标记此页面为已访问
  await markInjected(tabId, url);
});

// 清理已关闭 tab 的注入标记
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const data = await chrome.storage.session.get(null);
    const keysToRemove = Object.keys(data).filter(k => k.startsWith(`injected_${tabId}_`));
    if (keysToRemove.length > 0) {
      await chrome.storage.session.remove(keysToRemove);
    }
  } catch (e) {
    // 忽略
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GLM_API_REQUEST') {
    handleGLMRequest(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GLM_API_STREAM') {
    // 根据配置决定是流式还是非流式
    getConfig().then(config => {
      if (config.streamOutput === false) {
        // 非流式模式：调用普通请求，完成后发送 DONE 消息
        handleGLMRequest(message.payload)
          .then(content => {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'GLM_STREAM_DONE',
              fullContent: content
            }).catch(() => {});
          })
          .catch(err => {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'GLM_STREAM_ERROR',
              error: err.message
            }).catch(() => {});
          });
      } else {
        handleGLMStream(message.payload, sender.tab.id);
      }
    });
    return true;
  }

  if (message.type === 'FETCH_PROBLEM_DESC') {
    fetchProblemDescription(message.slug)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'LC_RELOAD') {
    // content script 请求重新注入（context 失效后的自修复尝试）
    const tabId = sender.tab?.id;
    if (tabId) {
      console.log('[LeetCode AI] 收到重新注入请求, tab:', tabId);
      injectContentScript(tabId)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      sendResponse({ success: false, error: '无法获取 tab ID' });
    }
    return true;
  }

  // 获取配置
  if (message.type === 'GET_CONFIG') {
    getConfig()
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 分析完成通知
  if (message.type === 'SHOW_NOTIFICATION') {
    showAnalysisNotification(message.title, message.body);
    return false;
  }

  // 保存分析历史
  if (message.type === 'SAVE_HISTORY') {
    saveAnalysisHistory(message.record)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 读取历史记录
  if (message.type === 'GET_HISTORY') {
    getAnalysisHistory()
      .then(list => sendResponse({ success: true, data: list }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 清空历史记录
  if (message.type === 'CLEAR_HISTORY') {
    chrome.storage.local.remove('lcAiHistory')
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * 调用 GLM-4-Flash API（非流式）
 */
async function handleGLMRequest(payload) {
  const config = await getConfig();
  const apiKey = config.apiKey || DEFAULT_API_KEY;
  const apiUrl = config.apiUrl || DEFAULT_GLM_API_URL;
  const model = config.modelName || config.model || 'glm-4.7-flash';
  const { messages, temperature = 0.7 } = payload;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages,
      stream: false,
      temperature
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.choices || result.choices.length === 0) {
    throw new Error('API 返回数据格式异常');
  }

  return result.choices[0].message.content;
}

/**
 * 流式调用 GLM API - 真正实时推送
 */
async function handleGLMStream(payload, tabId) {
  const config = await getConfig();
  const apiKey = config.apiKey || DEFAULT_API_KEY;
  const apiUrl = config.apiUrl || DEFAULT_GLM_API_URL;
  const model = config.modelName || config.model || 'glm-4.7-flash';
  const { messages, temperature = 0.7 } = payload;

  try {
    console.log('[LeetCode AI] 开始流式请求，模型:', model, 'URL:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages,
        stream: true,
        temperature
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 解码新数据
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // 处理缓冲区中的完整行
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        if (trimmedLine === 'data: [DONE]') continue;

        if (trimmedLine.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmedLine.slice(6));
            const delta = data.choices?.[0]?.delta?.content;

            if (delta && delta.length > 0) {
              fullContent += delta;

              // 立即发送给 content script，不等待、不延迟
              try {
                chrome.tabs.sendMessage(tabId, {
                  type: 'GLM_STREAM_DATA',
                  chunk: delta,
                  fullContent: fullContent
                }).catch(() => {
                  // Tab 可能已关闭，忽略错误
                });
              } catch (e) {
                // Tab 可能已关闭，忽略错误
                return;
              }
            }
          } catch (e) {
            console.log('[LeetCode AI] 解析流式数据行失败:', trimmedLine.substring(0, 50));
          }
        }
      }
    }

    // 处理缓冲区中剩余的数据
    if (buffer.trim()) {
      const trimmedLine = buffer.trim();
      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmedLine.slice(6));
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
          }
        } catch (e) {}
      }
    }

    console.log('[LeetCode AI] 流式输出完成，总长度:', fullContent.length);

    // 发送完成消息
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'GLM_STREAM_DONE',
        fullContent: fullContent
      });
    } catch (e) {
      console.log('[LeetCode AI] 发送完成消息失败');
    }

  } catch (error) {
    console.error('[LeetCode AI] 流式请求失败:', error);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'GLM_STREAM_ERROR',
        error: error.message
      });
    } catch (e) {}
  }
}

/**
 * 发送系统通知（分析完成提示）
 */
function showAnalysisNotification(title, body) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title || '✨ AI 分析完成',
      message: body || '代码分析已完成，点击查看结果',
      priority: 1
    });
  } catch (e) {
    console.log('[LeetCode AI] 发送通知失败:', e.message);
  }
}

/**
 * 保存分析历史到 local storage
 * 最多保留 50 条，超出时删除最旧的
 */
async function saveAnalysisHistory(record) {
  try {
    const result = await chrome.storage.local.get('lcAiHistory');
    const history = result.lcAiHistory || [];
    // 插入到最前面
    history.unshift(record);
    // 最多保留 50 条
    if (history.length > 50) history.splice(50);
    await chrome.storage.local.set({ lcAiHistory: history });
  } catch (e) {
    console.error('[LeetCode AI] 保存历史失败:', e);
    throw e;
  }
}

/**
 * 读取历史记录
 */
async function getAnalysisHistory() {
  try {
    const result = await chrome.storage.local.get('lcAiHistory');
    return result.lcAiHistory || [];
  } catch (e) {
    return [];
  }
}

/**
 * 获取 LeetCode 题目描述
 */
async function fetchProblemDescription(slug) {
  try {
    const response = await fetch('https://leetcode.cn/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': `https://leetcode.cn/problems/${slug}/`
      },
      body: JSON.stringify({
        query: `
          query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              title
              translatedTitle
              titleSlug
              content
              translatedContent
              difficulty
              topicTags {
                name
                translatedName
              }
            }
          }
        `,
        variables: { titleSlug: slug }
      })
    });

    if (!response.ok) throw new Error('获取题目失败: ' + response.status);

    const data = await response.json();

    if (data.errors) {
      console.error('[LeetCode AI] GraphQL 错误:', data.errors);
      throw new Error('GraphQL 查询错误');
    }

    const question = data?.data?.question;

    if (!question) throw new Error('题目数据为空');

    // 优先使用中文翻译字段
    const title = question.translatedTitle || question.title || slug;
    const content = question.translatedContent || question.content || '';
    const difficulty = question.difficulty || '未知';

    const cleanContent = content
      ? content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
      : '';

    return {
      title,
      difficulty,
      content: cleanContent,
      tags: question.topicTags?.map(t => t.translatedName || t.name) || []
    };
  } catch (e) {
    console.error('[LeetCode AI] 获取题目信息异常:', e.message);
    return { title: slug, difficulty: '未知', content: '', tags: [] };
  }
}
