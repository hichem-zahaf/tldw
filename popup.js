let currentVideoId = null;
let currentVideoUrl = '';
let currentVideoTitle = '';
let activeSummaryRequestId = null;

let selectedFormat = 'paragraph';
let selectedLevel = 3;

const LEVEL_BADGES_SHORT = {
  1: '⚡ Level 1: TL;DR',
  2: '📝 Level 2: Short',
  3: '🎯 Level 3: Standard',
  4: '📚 Level 4: Detailed',
  5: '🔬 Level 5: Deep Dive'
};

chrome.runtime.onMessage.addListener((request) => {
  if (
    request.action === 'SUMMARY_PROGRESS' &&
    request.summaryRequestId === activeSummaryRequestId &&
    request.status
  ) {
    showStatus(request.status);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settingsRes = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  if (settingsRes?.success && settingsRes.settings) {
    selectedFormat = settingsRes.settings.summaryFormat || 'paragraph';
    selectedLevel = settingsRes.settings.summaryLevel || 3;
  }

  // Set up format tabs
  updateFormatTabs(selectedFormat);
  document.querySelectorAll('.format-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedFormat = btn.dataset.format;
      updateFormatTabs(selectedFormat);
      if (currentVideoId) {
        triggerSummary(false);
      }
    });
  });

  // Set up level slider
  const slider = document.getElementById('popup-level-slider');
  slider.value = selectedLevel;
  updateLevelBadge(selectedLevel);

  slider.addEventListener('input', (e) => {
    selectedLevel = Number(e.target.value);
    updateLevelBadge(selectedLevel);
  });

  slider.addEventListener('change', () => {
    if (currentVideoId) {
      triggerSummary(false);
    }
  });

  document.getElementById('options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('clear-cache-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'CLEAR_CACHE' });
    showStatus('Cache cleared successfully.');
    document.getElementById('summary-result').style.display = 'none';
  });

  document.getElementById('summarize-btn').addEventListener('click', () => {
    if (currentVideoId) {
      triggerSummary(true);
    }
  });

  document.getElementById('lang-select').addEventListener('change', () => {
    if (currentVideoId) {
      triggerSummary(true);
    }
  });

  // Query active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/'))) {
    currentVideoUrl = tab.url;
    currentVideoId = extractVideoId(tab.url);
    currentVideoTitle = tab.title ? tab.title.replace('- YouTube', '').trim() : 'YouTube Video';

    document.getElementById('active-video-section').style.display = 'flex';
    document.getElementById('not-youtube-section').style.display = 'none';
    document.getElementById('video-title').textContent = currentVideoTitle;

    // Perform fast cache check on popup open
    checkCacheOnLoad();
  } else {
    document.getElementById('active-video-section').style.display = 'none';
    document.getElementById('not-youtube-section').style.display = 'block';
  }
});

function updateFormatTabs(format) {
  document.querySelectorAll('.format-tab').forEach(btn => {
    if (btn.dataset.format === format) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateLevelBadge(val) {
  const badge = document.getElementById('popup-level-badge');
  if (badge) {
    badge.textContent = LEVEL_BADGES_SHORT[val] || `Level ${val}`;
  }
}

/**
 * Fast cache check on popup load (non-blocking)
 */
async function checkCacheOnLoad() {
  const langSelect = document.getElementById('lang-select');
  const summaryBox = document.getElementById('summary-result');
  const selectedLang = langSelect ? langSelect.value : 'en';

  showStatus('Checking cache...');

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'CHECK_CACHE',
      videoId: currentVideoId,
      language: selectedLang,
      summaryLevel: selectedLevel,
      summaryFormat: selectedFormat
    });

    if (res && res.cached && res.summary) {
      const isArabic = isArabicText(res.summary);
      summaryBox.className = `summary-box ${isArabic ? 'rtl' : 'ltr'}`;
      summaryBox.innerHTML = parseMarkdown(res.summary);
      summaryBox.style.display = 'block';
      showStatus('Loaded from cache!');
    } else {
      showStatus('Ready to summarize. Click "✨ Summarize".');
    }
  } catch (err) {
    showStatus('Ready to summarize. Click "✨ Summarize".');
  }
}

/**
 * Trigger full summary generation
 */
async function triggerSummary(forceRefresh = false) {
  const langSelect = document.getElementById('lang-select');
  const summaryBox = document.getElementById('summary-result');
  const summarizeBtn = document.getElementById('summarize-btn');

  const selectedLang = langSelect ? langSelect.value : 'en';
  const summaryRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeSummaryRequestId = summaryRequestId;

  if (summarizeBtn) summarizeBtn.disabled = true;

  showStatus('Checking cache...');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_SUMMARY',
      videoId: currentVideoId,
      videoUrl: currentVideoUrl,
      videoTitle: currentVideoTitle,
      language: selectedLang,
      summaryLevel: selectedLevel,
      summaryFormat: selectedFormat,
      summaryRequestId,
      forceRefresh
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate summary.');
    }

    const isArabic = isArabicText(response.summary);
    summaryBox.className = `summary-box ${isArabic ? 'rtl' : 'ltr'}`;
    summaryBox.innerHTML = parseMarkdown(response.summary);
    summaryBox.style.display = 'block';

    showStatus(response.cached ? 'Loaded from cache' : 'Summary generated!');

  } catch (err) {
    showStatus(`⚠️ ${err.message || String(err)}`);
  } finally {
    if (activeSummaryRequestId === summaryRequestId) {
      activeSummaryRequestId = null;
    }
    if (summarizeBtn) summarizeBtn.disabled = false;
  }
}

function parseMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold & Italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Parse lines & lists
  const lines = html.split('\n');
  let inList = false;
  const resultLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      if (!inList) {
        resultLines.push('<ul>');
        inList = true;
      }
      resultLines.push('<li>' + trimmed.replace(/^[-*•]\s+/, '') + '</li>');
    } else {
      if (inList) {
        resultLines.push('</ul>');
        inList = false;
      }
      if (trimmed.length > 0) {
        resultLines.push('<p>' + line + '</p>');
      }
    }
  }
  if (inList) resultLines.push('</ul>');

  return resultLines.join('');
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function isArabicText(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text || '');
}

function showStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}
