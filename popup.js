// LeetCode AI Analyzer - Popup Script
// 扩展配置界面逻辑

(function() {
  'use strict';

  // 默认 API 地址（智谱 GLM）
  const DEFAULT_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

  // 默认配置
  const DEFAULT_CONFIG = {
    apiKey: '',
    apiUrl: '',
    modelName: '',
    model: 'glm-4.7-flash',
    streamOutput: true,
    showNotification: true,
    saveHistory: true
  };

  // 当前配置
  let currentConfig = { ...DEFAULT_CONFIG };

  // DOM 元素
  const elements = {
    apiKey: document.getElementById('api-key'),
    apiUrl: document.getElementById('api-url'),
    modelName: document.getElementById('model-name'),
    modelSelect: document.getElementById('model-select'),
    toggleStream: document.getElementById('toggle-stream'),
    toggleNotify: document.getElementById('toggle-notify'),
    toggleHistory: document.getElementById('toggle-history'),
    btnSave: document.getElementById('btn-save'),
    btnTest: document.getElementById('btn-test'),
    toast: document.getElementById('toast'),
    statusIcon: document.getElementById('status-icon'),
    statusTitle: document.getElementById('status-title'),
    statusDesc: document.getElementById('status-desc'),
    linkHelp: document.getElementById('link-help'),
    linkFeedback: document.getElementById('link-feedback'),
    linkGithub: document.getElementById('link-github'),
    historySection: document.getElementById('history-section'),
    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),
    btnClearHistory: document.getElementById('btn-clear-history'),
    historyModal: document.getElementById('history-modal'),
    historyModalBox: document.getElementById('history-modal-box')
  };

  // ==================== 初始化 ====================

  document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    bindEvents();
    updateUI();
    await loadHistory();
  });

  // ==================== 配置管理 ====================

  /**
   * 从 storage 加载配置
   */
  async function loadConfig() {
    try {
      const result = await chrome.storage.sync.get('lcAiConfig');
      if (result.lcAiConfig) {
        currentConfig = { ...DEFAULT_CONFIG, ...result.lcAiConfig };
      }
    } catch (e) {
      console.log('[LeetCode AI] 使用默认配置');
    }
  }

  /**
   * 保存配置到 storage
   */
  async function saveConfig() {
    try {
      await chrome.storage.sync.set({ lcAiConfig: currentConfig });
      return true;
    } catch (e) {
      console.error('[LeetCode AI] 保存配置失败:', e);
      return false;
    }
  }

  /**
   * 更新 UI 显示
   */
  function updateUI() {
    elements.apiKey.value = currentConfig.apiKey || '';
    elements.apiUrl.value = currentConfig.apiUrl || '';
    elements.modelName.value = currentConfig.modelName || '';
    elements.modelSelect.value = currentConfig.model;
    
    updateToggle(elements.toggleStream, currentConfig.streamOutput);
    updateToggle(elements.toggleNotify, currentConfig.showNotification);
    updateToggle(elements.toggleHistory, currentConfig.saveHistory);

    // 更新状态显示
    const hasApiKey = currentConfig.apiKey && currentConfig.apiKey.length > 10;
    if (hasApiKey) {
      elements.statusIcon.textContent = '✓';
      elements.statusIcon.classList.remove('inactive');
      elements.statusTitle.textContent = '扩展已就绪';
      elements.statusDesc.textContent = 'API Key 已配置，可以正常使用';
    } else {
      elements.statusIcon.textContent = '!';
      elements.statusIcon.classList.add('inactive');
      elements.statusTitle.textContent = '需要配置 API Key';
      elements.statusDesc.textContent = '请在下方输入您的 API Key';
    }
  }

  /**
   * 更新开关状态
   */
  function updateToggle(toggle, isActive) {
    if (isActive) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 开关切换
    elements.toggleStream.addEventListener('click', () => {
      currentConfig.streamOutput = !currentConfig.streamOutput;
      updateToggle(elements.toggleStream, currentConfig.streamOutput);
    });

    elements.toggleNotify.addEventListener('click', () => {
      currentConfig.showNotification = !currentConfig.showNotification;
      updateToggle(elements.toggleNotify, currentConfig.showNotification);
    });

    elements.toggleHistory.addEventListener('click', () => {
      currentConfig.saveHistory = !currentConfig.saveHistory;
      updateToggle(elements.toggleHistory, currentConfig.saveHistory);
    });

    // 模型选择
    elements.modelSelect.addEventListener('change', (e) => {
      currentConfig.model = e.target.value;
    });

    // API Key 输入
    elements.apiKey.addEventListener('input', (e) => {
      currentConfig.apiKey = e.target.value.trim();
    });

    // API URL 输入
    elements.apiUrl.addEventListener('input', (e) => {
      currentConfig.apiUrl = e.target.value.trim();
    });

    // 自定义模型名输入
    elements.modelName.addEventListener('input', (e) => {
      currentConfig.modelName = e.target.value.trim();
    });

    // 保存按钮
    elements.btnSave.addEventListener('click', async () => {
      const btn = elements.btnSave;
      const originalText = btn.innerHTML;
      
      btn.innerHTML = '<div class="spinner"></div> 保存中...';
      btn.disabled = true;

      const success = await saveConfig();

      btn.innerHTML = originalText;
      btn.disabled = false;

      if (success) {
        showToast('✓ 设置已保存');
        updateUI();
      } else {
        showToast('✗ 保存失败', true);
      }
    });

    // 测试连接按钮
    elements.btnTest.addEventListener('click', async () => {
      await testConnection();
    });

    // 底部链接
    elements.linkHelp.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/Firestar666-ui/leetcode-ai-analyzer#readme' });
    });

    elements.linkFeedback.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/Firestar666-ui/leetcode-ai-analyzer/issues' });
    });

    elements.linkGithub.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/Firestar666-ui/leetcode-ai-analyzer' });
    });

    // 清空历史记录
    if (elements.btnClearHistory) {
      elements.btnClearHistory.addEventListener('click', async () => {
        try {
          await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
          // 清除界面上的历史条目
          Array.from(elements.historyList.querySelectorAll('.history-item')).forEach(el => el.remove());
          if (elements.historyEmpty) elements.historyEmpty.style.display = 'block';
          showToast('✓ 历史记录已清空');
        } catch (e) {
          showToast('✗ 清空失败', true);
        }
      });
    }
  }

  // ==================== 功能函数 ====================

  /**
   * 测试 API 连接
   */
  async function testConnection() {
    const btn = elements.btnTest;
    const originalText = btn.innerHTML;

    btn.innerHTML = '<div class="spinner"></div> 测试中...';
    btn.disabled = true;

    const apiKey = elements.apiKey.value.trim();

    if (!apiKey || apiKey.length < 10) {
      showToast('✗ 请先输入有效的 API Key', true);
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    const apiUrl = elements.apiUrl.value.trim() || DEFAULT_API_URL;

    try {
      const testModel = elements.modelName.value.trim() || elements.modelSelect.value;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        })
      });

      if (response.ok) {
        showToast('✓ 连接成功！API Key 有效');
      } else {
        const error = await response.text();
        showToast(`✗ 连接失败: ${response.status}`, true);
      }
    } catch (e) {
      showToast('✗ 网络错误，请检查网络连接', true);
    }

    btn.innerHTML = originalText;
    btn.disabled = false;
  }

  /**
   * 加载并渲染历史记录
   */
  async function loadHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const list = response?.data || [];

      const historyList = elements.historyList;
      const historyEmpty = elements.historyEmpty;

      if (list.length === 0) {
        if (historyEmpty) historyEmpty.style.display = 'block';
        return;
      }

      if (historyEmpty) historyEmpty.style.display = 'none';

      // 清除旧项（保留 empty 提示）
      Array.from(historyList.querySelectorAll('.history-item')).forEach(el => el.remove());

      list.forEach((record, idx) => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const timeStr = formatTime(record.timestamp);
        const slug = record.problemSlug || '未知题目';
        const lang = record.language || '';
        const score = record.result?.style?.score ?? '—';
        const methods = Array.isArray(record.result?.method?.current)
          ? record.result.method.current.join(' / ')
          : (record.result?.method?.current || '');

        item.innerHTML = `
          <div class="history-item-header">
            <div class="history-item-title" title="${escapeHtmlAttr(slug)}">${escapeHtml(slug)}</div>
            <div class="history-item-time">${timeStr}</div>
          </div>
          <div class="history-item-meta">
            ${lang ? `<span class="history-tag">${escapeHtml(lang)}</span>` : ''}
            ${methods ? `<span class="history-score">${escapeHtml(methods)}</span>` : ''}
            ${score !== '—' ? `<span class="history-score" style="margin-left:auto">风格 ${score}</span>` : ''}
          </div>
        `;

        item.addEventListener('click', () => showHistoryDetail(record));
        historyList.insertBefore(item, historyEmpty);
      });

    } catch (e) {
      console.log('[LeetCode AI Popup] 加载历史记录失败:', e);
    }
  }

  /**
   * 显示历史详情弹窗
   */
  function showHistoryDetail(record) {
    const modal = elements.historyModal;
    const box = elements.historyModalBox;
    if (!modal || !box) return;

    const result = record.result || {};
    const method = result.method || {};
    const complexity = result.complexity || {};
    const style = result.style || {};

    const tags = Array.isArray(method.current)
      ? method.current.map(t => `<span class="history-tag">${escapeHtml(t)}</span>`).join('')
      : (method.current ? `<span class="history-tag">${escapeHtml(method.current)}</span>` : '—');

    box.innerHTML = `
      <div class="history-modal-title">
        <span>${escapeHtml(record.problemSlug || '未知题目')}</span>
        <button class="history-modal-close" id="history-modal-close-btn">✕</button>
      </div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:12px;">${formatTime(record.timestamp)} · ${escapeHtml(record.language || '')}</div>
      ${result.celebration ? `<div style="background:rgba(124,58,237,0.12);border-radius:8px;padding:8px 10px;font-size:12px;color:#c4b5fd;margin-bottom:12px;">${escapeHtml(result.celebration)}</div>` : ''}
      <div class="history-modal-row">
        <div class="history-modal-label">🐾 方法</div>
        <div class="history-modal-value history-modal-tags">${tags}</div>
      </div>
      ${method.core ? `<div class="history-modal-row"><div class="history-modal-label">核心考察</div><div class="history-modal-value">${escapeHtml(method.core)}</div></div>` : ''}
      ${method.suggestion ? `<div class="history-modal-row"><div class="history-modal-label">建议方向</div><div class="history-modal-value">${escapeHtml(method.suggestion)}</div></div>` : ''}
      <div class="history-modal-row">
        <div class="history-modal-label">⚡ 复杂度</div>
        <div class="history-modal-value">时间: ${escapeHtml(complexity.timeCurrentBig || '?')} &nbsp; 空间: ${escapeHtml(complexity.spaceCurrentBig || '?')}</div>
      </div>
      ${complexity.tip ? `<div class="history-modal-row"><div class="history-modal-label">优化建议</div><div class="history-modal-value">${escapeHtml(complexity.tip)}</div></div>` : ''}
      <div class="history-modal-row">
        <div class="history-modal-label">🎨 代码风格</div>
        <div class="history-modal-value">评分: ${style.score ?? '—'}/100 &nbsp; ${escapeHtml(style.suggestion || '')}</div>
      </div>
    `;

    modal.classList.add('show');

    box.querySelector('#history-modal-close-btn').addEventListener('click', () => {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    }, { once: true });
  }

  /**
   * 格式化时间
   */
  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
      return '';
    }
  }

  /**
   * HTML 转义（属性用）
   */
  function escapeHtmlAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * HTML 转义
   */
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /**
   * 显示消息提示
   */
  function showToast(message, isError = false) {
    const toast = elements.toast;
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

})();

