// LeetCode AI Analyzer - Content Script
// 在提交通过页面注入 AI 分析功能

(function () {
  'use strict';

  // ==================== 全局控制器（跨实例共享） ====================
  // 所有 IIFE 实例共享同一个控制器，确保只有一个实例有效
  const CTRL = window.__LC_AI_CTRL = window.__LC_AI_CTRL || {
    instanceId: 0,
    routeCheckInterval: null,
    mutationObserver: null,
    pushStateInstalled: false,
    // 销毁所有资源（供新实例调用，清理旧实例）
    destroy() {
      if (this.routeCheckInterval) {
        clearInterval(this.routeCheckInterval);
        this.routeCheckInterval = null;
      }
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      // 清理旧按钮和面板
      const oldBtn = document.getElementById('lc-ai-analyze-btn');
      if (oldBtn) oldBtn.remove();
      const oldPanel = document.getElementById('lc-ai-panel');
      if (oldPanel) oldPanel.remove();
    }
  };

  // 当前实例的 ID
  const myInstanceId = ++CTRL.instanceId;
  console.log('[LeetCode AI] 实例启动, ID:', myInstanceId);

  // 清理旧实例的所有资源
  CTRL.destroy();
  console.log('[LeetCode AI] 旧实例资源已清理');

  // ==================== Context 有效性检测 ====================

  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /**
   * 安全的 chrome.runtime.sendMessage 封装
   * 返回 Promise，context 失效时 reject
   */
  function safeSendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!isContextValid()) {
        reject(new Error('EXT_CONTEXT_INVALID'));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ==================== 状态管理 ====================
  let analyzerState = {
    isAnalyzing: false,
    result: null,
    activeTab: 'method',
    buttonInjected: false,
    panelInjected: false,
    streamContent: '', // 流式输出累积内容
    apiLanguage: null, // 从 GraphQL API 获取的语言
    apiProblemSlug: null // 从 GraphQL API 获取的题目 slug
  };

  // 全局变量用于路由检测
  let lastUrl = location.href;
  let lastSubmissionId = null;

  // ==================== 工具函数 ====================

  /**
   * 从 URL 中提取题目 slug
   */
  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^\/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * 从 URL 中提取提交 ID
   */
  function getSubmissionId() {
    const match = window.location.pathname.match(/\/submissions\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * 检查是否在提交详情页
   * LeetCode 提交详情页 URL 格式：
   * - https://leetcode.cn/submissions/detail/{submission-id}/
   * - https://leetcode.cn/submissions/detail/{submission-id}/
   * 提交列表页（也可以显示分析按钮）：
   * - https://leetcode.cn/problems/{slug}/submissions/
   */
  function isSubmissionPage() {
    const pathname = location.pathname;
    // 提交详情页（核心匹配）
    if (/\/submissions\/detail\/\d+/.test(pathname)) return 'detail';
    // 提交列表页
    if (/\/problems\/[^\/]+\/submissions\/?$/.test(pathname)) return 'list';
    // 兼容旧格式
    if (/\/problems\/[^\/]+\/submissions\/\d+/.test(pathname)) return 'detail';
    return null;
  }

  /**
   * 通过 GraphQL API 获取提交的代码（唯一可靠方案）
   * 移除所有 DOM 解析方案，因为 Monaco Editor 在提交详情页可能展示非当前提交的代码
   */
  async function fetchSubmittedCode() {
    const submissionId = getSubmissionId();
    if (!submissionId) {
      console.log('[LeetCode AI] 无法从 URL 提取 submissionId');
      return null;
    }

    console.log('[LeetCode AI] 通过 GraphQL API 获取提交代码，ID:', submissionId);

    try {
      const problemSlug = getProblemSlug();
      const referer = problemSlug
        ? `https://leetcode.cn/problems/${problemSlug}/submissions/`
        : window.location.href;

      const response = await fetch('https://leetcode.cn/graphql/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': referer,
          'Accept': '*/*'
        },
        credentials: 'include',
        body: JSON.stringify({
          query: `
            query mySubmissionDetail($id: ID!) {
              submissionDetail(submissionId: $id) {
                runtime
                runtimePercentile
                memory
                memoryPercentile
                code
                timestamp
                lang
                question {
                  questionId
                  titleSlug
                }
              }
            }
          `,
          variables: { id: submissionId },
          operationName: 'mySubmissionDetail'
        })
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '(无法读取响应体)');
        console.log('[LeetCode AI] GraphQL API 请求失败，状态码:', response.status, '响应:', errBody);
        return null;
      }

      const data = await response.json();
      const details = data?.data?.submissionDetail;

      if (!details || !details.code) {
        console.log('[LeetCode AI] GraphQL API 返回数据为空或无代码');
        return null;
      }

      console.log('[LeetCode AI] 从 GraphQL API 获取代码成功，长度:', details.code.length);

      // 同时保存语言和题目 slug 信息，避免后续需要再次 DOM 获取
      if (details.lang) {
        analyzerState.apiLanguage = details.lang;
        console.log('[LeetCode AI] 从 API 获取语言:', analyzerState.apiLanguage);
      }
      if (details.question?.titleSlug) {
        analyzerState.apiProblemSlug = details.question.titleSlug;
        console.log('[LeetCode AI] 从 API 获取题目 slug:', analyzerState.apiProblemSlug);
      }

      return details.code;
    } catch (e) {
      console.error('[LeetCode AI] GraphQL API 获取代码异常:', e);
      return null;
    }
  }

  /**
   * 获取编程语言（优先使用 API 返回值）
   */
  function getLanguage() {
    // 优先使用 GraphQL API 返回的语言
    if (analyzerState.apiLanguage) {
      return analyzerState.apiLanguage;
    }

    // Fallback：从 DOM 获取（精度较低）
    const langSelectors = [
      '.ant-select-selection-item',
      '[data-cypress="lang-select"]',
      '.Select-value-label'
    ];
    for (const sel of langSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }

    const codeEl = document.querySelector('code[class*="language-"]');
    if (codeEl) {
      const cls = codeEl.className.match(/language-(\w+)/);
      if (cls) return cls[1];
    }

    return 'Python';
  }

  /**
   * 获取题目 slug（优先使用 API 返回值）
   */
  function getProblemSlugFromAPI() {
    return analyzerState.apiProblemSlug || getProblemSlug();
  }

  // ==================== AI 调用 ====================

  function buildPrompt(code, language, problemInfo) {
    const problemContext = problemInfo
      ? `题目名称：${problemInfo.title}
难度：${problemInfo.difficulty}
相关标签：${problemInfo.tags?.join(', ') || '未知'}

题目描述：
${problemInfo.content || '（无详细描述）'}`
      : '（请根据代码内容自行判断题目类型）';

    return `你是一位资深算法工程师，请对以下已通过 LeetCode 的代码进行深度分析。

${problemContext}

编程语言：${language}

提交的代码：
\`\`\`${language}
${code}
\`\`\`

请严格按照以下 JSON 格式返回分析结果，不要包含任何其他文字，只返回 JSON：

{
  "celebration": "一句鼓励的话（20字以内，积极向上）",
  "method": {
    "current": ["当前使用的算法/方法标签，数组格式，例如：动态规划、哈希表"],
    "suggestion": "建议的更优解法（如果当前已是最优则说明即可，20字以内）",
    "core": "这道题的核心考察点（一句话，30字以内）"
  },
  "complexity": {
    "timeCurrentBig": "当前时间复杂度（数学符号形式，例如：O(n²)）",
    "spaceCurrentBig": "当前空间复杂度（数学符号形式）",
    "timeSuggestBig": "建议时间复杂度（如已最优则与当前相同）",
    "spaceSuggestBig": "建议空间复杂度（如已最优则与当前相同）",
    "tip": "效率优化建议（一句话，40字以内，如已最优则说明）"
  },
  "style": {
    "score": 85,
    "naming": "命名规范评价（一句话，30字以内）",
    "structure": "代码结构评价（一句话，30字以内）",
    "readability": "可读性评价（一句话，30字以内）",
    "suggestion": "总体风格建议（一句话，40字以内）"
  }
}`;
  }

  /**
   * 启动流式 AI 分析
   */
  function startStreamAnalysis(code, language, problemInfo) {
    const prompt = buildPrompt(code, language, problemInfo);

    // 重置流式内容
    analyzerState.streamContent = '';

    // 显示流式输出区域
    showStreamOutput();

    // 发送流式请求到 background
    if (!isContextValid()) {
      showError('扩展已更新，请刷新页面后重试');
      analyzerState.isAnalyzing = false;
      return;
    }
    safeSendMessage({
      type: 'GLM_API_STREAM',
      payload: {
        messages: [
          {
            role: 'system',
            content: '你是一位专业的算法工程师和代码审查专家，专注于 LeetCode 题目分析。你必须严格按照用户指定的 JSON 格式返回结果，不包含任何额外文字。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
      }
    }).catch(err => {
      console.error('[LeetCode AI] 发送分析请求失败:', err);
      if (err.message === 'EXT_CONTEXT_INVALID') {
        showError('扩展已更新，请刷新页面后重试');
      } else {
        showError('发送分析请求失败: ' + err.message);
      }
      analyzerState.isAnalyzing = false;
    });
  }

  /**
   * 显示流式输出区域
   */
  function showStreamOutput() {
    const container = document.getElementById('lc-ai-tab-content');
    if (!container) return;

    container.innerHTML = `
      <div class="lc-ai-stream-container" id="lc-ai-stream-container">
        <div class="lc-ai-stream-header">
          <div class="lc-ai-stream-status">
            <span class="lc-ai-stream-dot"></span>
            <span class="lc-ai-stream-text">正在连接 AI...</span>
          </div>
        </div>
        <div class="lc-ai-stream-content" id="lc-ai-stream-content">
          <div class="lc-ai-stream-placeholder">
            <div class="lc-ai-loading-spinner"></div>
            <div>正在请求 AI 分析，请稍候...</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 更新流式输出内容 - 真正实时更新
   */
  function updateStreamContent(chunk, fullContent) {
    const container = document.getElementById('lc-ai-stream-content');
    const statusText = document.querySelector('.lc-ai-stream-text');
    if (!container) return;

    // 保存到状态
    analyzerState.streamContent = fullContent;

    // 第一次收到数据时，更新状态文本
    if (statusText && statusText.textContent === '正在连接 AI...') {
      statusText.textContent = 'AI 正在分析中...';
    }

    // 如果是第一次收到数据，清除占位符
    if (container.querySelector('.lc-ai-stream-placeholder')) {
      container.innerHTML = '';
    }

    // 尝试解析当前的 JSON
    let parsedData = null;
    try {
      parsedData = parseAIResponse(fullContent);
    } catch (e) {
      // 还不能完整解析，显示原始文本
    }

    if (parsedData) {
      // 如果能解析，显示结构化的预览
      container.innerHTML = renderStreamPreview(parsedData);
    } else {
      // 显示原始文本，添加打字机效果的光标
      container.innerHTML = `<pre class="lc-ai-stream-raw">${escapeHtml(fullContent)}<span class="lc-ai-cursor">▋</span></pre>`;
    }

    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;
  }

  /**
   * 渲染流式预览（部分数据）
   */
  function renderStreamPreview(data) {
    let html = '<div class="lc-ai-stream-preview">';

    // 庆祝语
    if (data.celebration) {
      html += `<div class="lc-ai-stream-section">
        <div class="lc-ai-stream-section-title">🎉 庆祝</div>
        <div class="lc-ai-stream-section-content">${escapeHtml(data.celebration)}</div>
      </div>`;
    }

    // 方法
    if (data.method) {
      html += `<div class="lc-ai-stream-section">
        <div class="lc-ai-stream-section-title">🐾 方法</div>
        <div class="lc-ai-stream-section-content">`;
      if (data.method.current) {
        const current = Array.isArray(data.method.current) ? data.method.current.join(', ') : data.method.current;
        html += `<div>当前: ${escapeHtml(current)}</div>`;
      }
      if (data.method.suggestion) {
        html += `<div>建议: ${escapeHtml(data.method.suggestion)}</div>`;
      }
      html += `</div></div>`;
    }

    // 复杂度
    if (data.complexity) {
      html += `<div class="lc-ai-stream-section">
        <div class="lc-ai-stream-section-title">⚡ 复杂度</div>
        <div class="lc-ai-stream-section-content">`;
      if (data.complexity.timeCurrentBig) {
        html += `<div>时间: ${escapeHtml(data.complexity.timeCurrentBig)}</div>`;
      }
      if (data.complexity.spaceCurrentBig) {
        html += `<div>空间: ${escapeHtml(data.complexity.spaceCurrentBig)}</div>`;
      }
      html += `</div></div>`;
    }

    // 代码风格
    if (data.style) {
      html += `<div class="lc-ai-stream-section">
        <div class="lc-ai-stream-section-title">🎨 代码风格</div>
        <div class="lc-ai-stream-section-content">`;
      if (data.style.score) {
        html += `<div>评分: ${data.style.score}/100</div>`;
      }
      if (data.style.suggestion) {
        html += `<div>${escapeHtml(data.style.suggestion)}</div>`;
      }
      html += `</div></div>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * 完成流式输出
   */
  function finishStreamOutput(fullContent) {
    const statusText = document.querySelector('.lc-ai-stream-text');
    const statusDot = document.querySelector('.lc-ai-stream-dot');

    if (statusText) statusText.textContent = '分析完成';
    if (statusDot) statusDot.classList.add('done');

    try {
      const result = parseAIResponse(fullContent);
      analyzerState.result = result;

      // 更新庆祝语
      const celebrationText = document.getElementById('lc-ai-celebration-text');
      if (celebrationText && result.celebration) {
        celebrationText.textContent = result.celebration;
      }

      // 延迟后切换到正常 Tab 视图
      setTimeout(() => {
        analyzerState.activeTab = 'method';
        const panel = document.getElementById('lc-ai-panel');
        if (panel) {
          panel.querySelectorAll('.lc-ai-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === 'method');
          });
        }
        renderTabContent(result, 'method');
      }, 1500);

    } catch (error) {
      showError('解析分析结果失败: ' + error.message);
    }

    analyzerState.isAnalyzing = false;
  }

  /**
   * 处理流式错误
   */
  function handleStreamError(error) {
    const statusText = document.querySelector('.lc-ai-stream-text');
    if (statusText) {
      statusText.textContent = '分析失败';
      statusText.style.color = '#ef4444';
    }
    showError(error);
    analyzerState.isAnalyzing = false;
  }

  /**
   * HTML 转义
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 解析 AI 返回的 JSON
   */
  function parseAIResponse(rawText) {
    try {
      return JSON.parse(rawText);
    } catch (e) {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (e2) {}
      }

      const braceMatch = rawText.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch (e3) {}
      }

      throw new Error('无法解析 AI 返回的 JSON 格式');
    }
  }

  // ==================== UI 注入 ====================

  /**
   * 清理旧元素
   */
  function cleanupOldElements() {
    const oldBtn = document.getElementById('lc-ai-analyze-btn');
    const oldPanel = document.getElementById('lc-ai-panel');
    if (oldBtn) {
      oldBtn.remove();
      console.log('[LeetCode AI] 清理旧按钮');
    }
    if (oldPanel) {
      oldPanel.remove();
      console.log('[LeetCode AI] 清理旧面板');
    }
    analyzerState.buttonInjected = false;
    analyzerState.panelInjected = false;
    analyzerState.result = null;
    analyzerState.streamContent = '';
    analyzerState.apiLanguage = null;
    analyzerState.apiProblemSlug = null;
  }

  /**
   * 注入分析按钮 - 固定在页面底部右侧，只显示图标
   */
  function injectAnalyzeButton() {
    if (analyzerState.buttonInjected) return;
    if (document.getElementById('lc-ai-analyze-btn')) return;

    console.log('[LeetCode AI] 开始注入分析按钮');

    const btn = document.createElement('button');
    btn.id = 'lc-ai-analyze-btn';
    btn.className = 'lc-ai-btn';
    btn.innerHTML = `<span class="lc-ai-btn-icon">✨</span>`;
    btn.title = 'AI 分析';
    btn.addEventListener('click', handleAnalyzeClick);

    // 固定定位在底部右侧，只显示图标
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      width: 44px;
      height: 44px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: linear-gradient(135deg, #7c3aed, #6d28d9);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 3px 12px rgba(124, 58, 237, 0.45);
      transition: all 0.25s ease;
      font-size: 18px;
    `;

    document.body.appendChild(btn);
    analyzerState.buttonInjected = true;
    console.log('[LeetCode AI] 分析按钮注入完成');
  }

  /**
   * 创建分析面板
   */
  function createAnalysisPanel() {
    const existing = document.getElementById('lc-ai-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'lc-ai-panel';
    panel.className = 'lc-ai-panel';
    panel.innerHTML = `
      <div class="lc-ai-panel-inner">
        <div class="lc-ai-celebration" id="lc-ai-celebration">
          <span class="lc-ai-celebration-emoji">🎉</span>
          <span class="lc-ai-celebration-text" id="lc-ai-celebration-text">分析中...</span>
          <button class="lc-ai-close-btn" id="lc-ai-close-btn" title="关闭">✕</button>
        </div>
        <div class="lc-ai-tabs">
          <button class="lc-ai-tab active" data-tab="method">
            <span class="tab-icon">🐾</span> 方法
          </button>
          <button class="lc-ai-tab" data-tab="complexity">
            <span class="tab-icon">⚡</span> 运行效率
          </button>
          <button class="lc-ai-tab" data-tab="style">
            <span class="tab-icon">🎨</span> 代码风格
          </button>
        </div>
        <div class="lc-ai-tab-content" id="lc-ai-tab-content">
          <div class="lc-ai-loading" id="lc-ai-loading">
            <div class="lc-ai-loading-dots">
              <span></span><span></span><span></span>
            </div>
            <p>AI 正在分析你的代码...</p>
            <p class="lc-ai-loading-sub">获取题目信息 · 分析算法 · 评估效率</p>
          </div>
        </div>
      </div>
    `;

    panel.querySelectorAll('.lc-ai-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.lc-ai-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        analyzerState.activeTab = tab.dataset.tab;
        if (analyzerState.result) {
          renderTabContent(analyzerState.result, analyzerState.activeTab);
        }
      });
    });

    const closeBtn = panel.querySelector('#lc-ai-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        analyzerState.panelInjected = false;
      });
    }

    return panel;
  }

  function renderTabContent(data, tab) {
    const container = document.getElementById('lc-ai-tab-content');
    if (!container) return;

    const loading = document.getElementById('lc-ai-loading');
    if (loading) loading.remove();

    container.innerHTML = '';

    switch (tab) {
      case 'method':
        container.innerHTML = renderMethodTab(data.method);
        break;
      case 'complexity':
        container.innerHTML = renderComplexityTab(data.complexity);
        break;
      case 'style':
        container.innerHTML = renderStyleTab(data.style);
        break;
    }
  }

  function renderMethodTab(method) {
    if (!method) return '<div class="lc-ai-error">数据解析失败</div>';

    const currentTags = Array.isArray(method.current)
      ? method.current.map(tag => `<span class="lc-ai-tag">${tag}</span>`).join('')
      : `<span class="lc-ai-tag">${method.current}</span>`;

    return `
      <div class="lc-ai-section">
        <div class="lc-ai-row">
          <span class="lc-ai-label">当前</span>
          <div class="lc-ai-tags">${currentTags}</div>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">建议</span>
          <span class="lc-ai-value lc-ai-suggest">${method.suggestion || '当前方法已是最优'}</span>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">核心考察</span>
          <span class="lc-ai-value lc-ai-bold">${method.core || '—'}</span>
        </div>
      </div>
    `;
  }

  function renderComplexityTab(complexity) {
    if (!complexity) return '<div class="lc-ai-error">数据解析失败</div>';

    const isSameTime = complexity.timeCurrentBig === complexity.timeSuggestBig;
    const isSameSpace = complexity.spaceCurrentBig === complexity.spaceSuggestBig;

    return `
      <div class="lc-ai-section">
        <div class="lc-ai-complexity-grid">
          <div class="lc-ai-complexity-item">
            <div class="lc-ai-complexity-label">时间复杂度</div>
            <div class="lc-ai-complexity-current">${complexity.timeCurrentBig || 'O(?)'}</div>
            ${!isSameTime ? `<div class="lc-ai-complexity-arrow">↓</div><div class="lc-ai-complexity-suggest">${complexity.timeSuggestBig}</div>` : '<div class="lc-ai-complexity-optimal">✓ 已最优</div>'}
          </div>
          <div class="lc-ai-complexity-divider"></div>
          <div class="lc-ai-complexity-item">
            <div class="lc-ai-complexity-label">空间复杂度</div>
            <div class="lc-ai-complexity-current">${complexity.spaceCurrentBig || 'O(?)'}</div>
            ${!isSameSpace ? `<div class="lc-ai-complexity-arrow">↓</div><div class="lc-ai-complexity-suggest">${complexity.spaceSuggestBig}</div>` : '<div class="lc-ai-complexity-optimal">✓ 已最优</div>'}
          </div>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">优化建议</span>
          <span class="lc-ai-value">${complexity.tip || '当前效率已经很好'}</span>
        </div>
      </div>
    `;
  }

  function renderStyleTab(style) {
    if (!style) return '<div class="lc-ai-error">数据解析失败</div>';

    const score = style.score || 80;
    const scoreColor = score >= 90 ? '#22c55e' : score >= 75 ? '#a78bfa' : score >= 60 ? '#f59e0b' : '#ef4444';
    const circumference = 2 * Math.PI * 28;
    const offset = circumference * (1 - score / 100);

    return `
      <div class="lc-ai-section">
        <div class="lc-ai-style-header">
          <div class="lc-ai-score-circle">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="28" fill="none" stroke="#2d2d3d" stroke-width="6"/>
              <circle cx="36" cy="36" r="28" fill="none" stroke="${scoreColor}" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 36 36)"/>
            </svg>
            <div class="lc-ai-score-num" style="color:${scoreColor}">${score}</div>
          </div>
          <div class="lc-ai-style-summary">
            <p>${style.suggestion || '代码风格总体良好'}</p>
          </div>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">命名规范</span>
          <span class="lc-ai-value">${style.naming || '—'}</span>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">代码结构</span>
          <span class="lc-ai-value">${style.structure || '—'}</span>
        </div>
        <div class="lc-ai-divider"></div>
        <div class="lc-ai-row">
          <span class="lc-ai-label">可读性</span>
          <span class="lc-ai-value">${style.readability || '—'}</span>
        </div>
      </div>
    `;
  }

  function showError(message) {
    const container = document.getElementById('lc-ai-tab-content');
    if (!container) return;

    container.innerHTML = `
      <div class="lc-ai-error-box">
        <div class="lc-ai-error-icon">⚠️</div>
        <div class="lc-ai-error-msg">${message}</div>
        <button class="lc-ai-retry-btn" onclick="document.getElementById('lc-ai-analyze-btn').click()">
          重试
        </button>
      </div>
    `;

    analyzerState.isAnalyzing = false;
  }

  // ==================== 主流程 ====================

  async function handleAnalyzeClick() {
    if (analyzerState.isAnalyzing) return;

    // 检测 extension context 是否有效
    if (!isContextValid()) {
      showError('扩展已更新，请刷新页面后重试');
      return;
    }

    analyzerState.isAnalyzing = true;

    let panel = document.getElementById('lc-ai-panel');
    if (!panel) {
      panel = createAnalysisPanel();
      injectPanel(panel);
    } else {
      panel.style.display = 'block';
    }

    try {
      // 立即显示流式输出区域，让用户知道正在处理
      showStreamOutput();

      const language = getLanguage();
      const slug = getProblemSlugFromAPI();

      console.log('[LeetCode AI] 开始并行获取代码和题目信息...');

      // 并行获取代码和题目信息，两者都拿齐后再发 AI 请求，保证分析准确性
      const [code, problemInfo] = await Promise.all([
        fetchSubmittedCode(),
        slug
          ? safeSendMessage({ type: 'FETCH_PROBLEM_DESC', slug })
              .then(response => response?.success ? response.data : null)
              .catch(err => {
                console.warn('[LeetCode AI] 获取题目信息失败:', err.message);
                return null;
              })
          : Promise.resolve(null)
      ]);

      if (!code || code.trim().length < 10) {
        throw new Error('无法获取提交代码，请确保在提交详情页面使用此功能');
      }

      console.log('[LeetCode AI] 代码获取成功，长度:', code.length);

      if (problemInfo) {
        console.log('[LeetCode AI] 题目信息获取成功：', problemInfo.title,
          '| 难度:', problemInfo.difficulty,
          '| 标签:', problemInfo.tags?.join(', ') || '无',
          '| 描述长度:', problemInfo.content?.length || 0, '字');
      } else {
        console.log('[LeetCode AI] 题目信息未获取，将由 AI 自行推断题目类型');
      }

      // 启动流式分析
      startStreamAnalysis(code, language, problemInfo);

    } catch (error) {
      console.error('[LeetCode AI] 分析失败:', error);
      if (error.message === 'EXT_CONTEXT_INVALID') {
        showError('扩展已更新，请刷新页面后重试');
      } else {
        showError(error.message || '分析失败，请重试');
      }
      analyzerState.isAnalyzing = false;
    }
  }

  function injectPanel(panel) {
    const leftPanelSelectors = [
      '.result__1LNBR',
      '[class*="result-container"]',
      '[class*="left-part"]',
      '[class*="leftPart"]',
      '[class*="ResultBar"]',
      '.ant-col-12:first-child',
      '[class*="submission"] [class*="left"]',
    ];

    for (const sel of leftPanelSelectors) {
      const target = document.querySelector(sel);
      if (target) {
        target.insertBefore(panel, target.firstChild);
        analyzerState.panelInjected = true;
        return;
      }
    }

    const distEl = document.querySelector('[class*="distribution"], [class*="Distribution"]');
    if (distEl && distEl.parentElement) {
      distEl.parentElement.insertBefore(panel, distEl);
      analyzerState.panelInjected = true;
      return;
    }

    panel.style.cssText = `
      position: fixed;
      top: 60px;
      left: 0;
      width: 360px;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      z-index: 9998;
      border-radius: 0 12px 12px 0;
    `;
    document.body.appendChild(panel);
    analyzerState.panelInjected = true;
  }

  // ==================== 初始化与路由检测 ====================

  function init() {
    // 如果当前实例已被新实例替代，不执行
    if (CTRL.instanceId !== myInstanceId) return;

    const pageType = isSubmissionPage();
    if (!pageType) return;

    console.log('[LeetCode AI] 初始化, 页面类型:', pageType);

    // 尝试注入按钮（可能已在 setupRouteListener 之前 URL 已匹配）
    injectAnalyzeButton();

    // 短轮询：最多尝试 10 次，每次 1 秒
    let attempts = 0;
    const maxAttempts = 10;

    const checkAndInject = () => {
      // 如果当前实例已被新实例替代，停止轮询
      if (CTRL.instanceId !== myInstanceId) return;

      if (document.getElementById('lc-ai-analyze-btn')) return; // 已注入

      attempts++;
      injectAnalyzeButton();

      if (attempts < maxAttempts && !document.getElementById('lc-ai-analyze-btn')) {
        setTimeout(checkAndInject, 1000);
      }
    };

    setTimeout(checkAndInject, 1000);
  }

  function handleUrlChange() {
    // 如果当前实例已被新实例替代，不处理
    if (CTRL.instanceId !== myInstanceId) return;

    const currentUrl = location.href;
    const currentSubmissionId = getSubmissionId();

    const urlChanged = currentUrl !== lastUrl;
    const idChanged = currentSubmissionId !== lastSubmissionId;

    if (urlChanged || idChanged) {
      lastUrl = currentUrl;
      lastSubmissionId = currentSubmissionId;

      // 清理旧元素
      const oldBtn = document.getElementById('lc-ai-analyze-btn');
      if (oldBtn) oldBtn.remove();
      const oldPanel = document.getElementById('lc-ai-panel');
      if (oldPanel) oldPanel.remove();
      analyzerState.buttonInjected = false;
      analyzerState.panelInjected = false;
      analyzerState.result = null;
      analyzerState.streamContent = '';
      analyzerState.apiLanguage = null;
      analyzerState.apiProblemSlug = null;

      if (isSubmissionPage()) {
        setTimeout(init, 300);
      }
    }
  }

  function setupRouteListener() {
    lastUrl = location.href;
    lastSubmissionId = getSubmissionId();

    // 覆盖 history.pushState（只安装一次）
    if (!CTRL.pushStateInstalled) {
      CTRL.pushStateInstalled = true;
      const originalPushState = history.pushState;
      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        setTimeout(handleUrlChange, 100);
      };

      const originalReplaceState = history.replaceState;
      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        setTimeout(handleUrlChange, 100);
      };

      window.addEventListener('popstate', () => {
        setTimeout(handleUrlChange, 100);
      });
    }

    // URL 变化轮询（使用全局控制器，确保只有一个）
    if (CTRL.routeCheckInterval) {
      clearInterval(CTRL.routeCheckInterval);
    }
    CTRL.routeCheckInterval = setInterval(() => {
      handleUrlChange();
    }, 500);
  }

  function setupMutationObserver() {
    // 使用全局控制器，确保只有一个 observer
    if (CTRL.mutationObserver) {
      CTRL.mutationObserver.disconnect();
    }

    CTRL.mutationObserver = new MutationObserver(() => {
      if (CTRL.instanceId !== myInstanceId) return;
      if (isSubmissionPage() && !document.getElementById('lc-ai-analyze-btn')) {
        analyzerState.buttonInjected = false;
        injectAnalyzeButton();
      }
    });

    CTRL.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== 监听来自 background 的消息 ====================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GLM_STREAM_DATA') {
      updateStreamContent(message.chunk, message.fullContent);
    } else if (message.type === 'GLM_STREAM_DONE') {
      finishStreamOutput(message.fullContent);
    } else if (message.type === 'GLM_STREAM_ERROR') {
      handleStreamError(message.error);
    } else if (message.type === 'LC_PING') {
      // background 用来检测 content script 是否存活
      sendResponse({ instanceId: myInstanceId });
    }
  });

  // ==================== 启动 ====================

  console.log('[LeetCode AI] Content script 实例 #' + myInstanceId + ' 已加载');

  setupRouteListener();
  setupMutationObserver();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
