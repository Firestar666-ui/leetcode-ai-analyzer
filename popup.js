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
    linkGithub: document.getElementById('link-github')
  };

  // ==================== 初始化 ====================

  document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    bindEvents();
    updateUI();
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
      chrome.tabs.create({ url: 'https://github.com/your-repo/leetcode-ai-analyzer#使用说明' });
    });

    elements.linkFeedback.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/your-repo/leetcode-ai-analyzer/issues' });
    });

    elements.linkGithub.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/your-repo/leetcode-ai-analyzer' });
    });
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

    try {
      const testUrl = elements.apiUrl.value.trim() || DEFAULT_API_URL;
      const testModel = elements.modelName.value.trim() || elements.modelSelect.value;
      const response = await fetch(testUrl, {
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

