let currentVideoId = null;
let currentTabId = null;
let currentVideoUrl = '';
let currentVideoTitle = '';
let currentSummaryText = '';
let currentSummaryAnswer = null;
let activeSummaryRequestId = null;

let selectedFormat = 'paragraph';
let selectedLevel = 3;
let obsidianEnabled = false;
let obsidianVault = '';

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
    obsidianEnabled = !!settingsRes.settings.obsidianEnabled;
    obsidianVault = String(settingsRes.settings.obsidianVault || '').trim();
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

  document.getElementById('obsidian-btn').addEventListener('click', () => {
    savePopupSummaryToObsidian();
  });

  document.getElementById('lang-select').addEventListener('change', () => {
    if (currentVideoId) {
      triggerSummary(true);
    }
  });

  updateObsidianButtonVisibility();
  renderTimeSaved();

  // Query active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/'))) {
    currentVideoUrl = tab.url;
    currentVideoId = extractVideoId(tab.url);
    currentVideoTitle = tab.title ? tab.title.replace('- YouTube', '').trim() : 'YouTube Video';

    currentTabId = tab.id;
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
      currentSummaryText = res.summary;
      currentSummaryAnswer = res.answer || null;
      const isArabic = isArabicText(res.summary);
      summaryBox.className = `summary-box ${isArabic ? 'rtl' : 'ltr'}`;
      summaryBox.innerHTML = renderSummaryBox(res.summary, res.answer);
      summaryBox.style.display = 'block';
      updateObsidianButtonVisibility();
      showStatus('Loaded from cache!');
    } else {
      currentSummaryText = '';
      currentSummaryAnswer = null;
      updateObsidianButtonVisibility();
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
      videoDurationSeconds: await getActiveTabVideoDuration(),
      summaryRequestId,
      forceRefresh
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate summary.');
    }

    currentSummaryText = response.summary || '';
    currentSummaryAnswer = response.answer || null;
    const isArabic = isArabicText(response.summary);
    summaryBox.className = `summary-box ${isArabic ? 'rtl' : 'ltr'}`;
    summaryBox.innerHTML = renderSummaryBox(response.summary, response.answer);
    summaryBox.style.display = 'block';
    updateObsidianButtonVisibility();

    showStatus(response.cached ? 'Loaded from cache' : 'Summary generated!');
    renderTimeSaved();

  } catch (err) {
    showStatus(`⚠️ ${err.message || String(err)}`);
  } finally {
    if (activeSummaryRequestId === summaryRequestId) {
      activeSummaryRequestId = null;
    }
    if (summarizeBtn) summarizeBtn.disabled = false;
  }
}

/** The player knows its own length; the popup can only get it via the page. */
async function getActiveTabVideoDuration() {
  if (currentTabId === null) return 0;

  try {
    const res = await chrome.tabs.sendMessage(currentTabId, { action: 'GET_VIDEO_DURATION' });
    return Number(res?.durationSeconds) || 0;
  } catch (_) {
    return 0;
  }
}

async function renderTimeSaved() {
  const box = document.getElementById('time-saved');
  if (!box) return;

  let stats = null;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_TIME_SAVED' });
    if (res?.success) stats = res.stats;
  } catch (_) {}

  if (!stats?.videos || !stats.savedSeconds) {
    box.style.display = 'none';
    return;
  }

  document.getElementById('time-saved-value').textContent = formatTimeSpan(stats.savedSeconds);
  document.getElementById('time-saved-sub').textContent =
    `${stats.videos} video${stats.videos === 1 ? '' : 's'} summarized` +
    (stats.readSeconds >= 60 ? ` · ~${formatTimeSpan(stats.readSeconds)} reading instead` : '');
  box.style.display = 'flex';
}

// Mirrors formatTimeSpan in time-saved.js; the popup is a classic script and
// cannot import the module.
function formatTimeSpan(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// Mirrors renderStars/getRatingLabel in summary-answer.js; the popup is a
// classic script and cannot import the module.
function answerStars(rating) {
  const value = Math.max(0, Math.min(3, Number(rating) || 0));
  if (!value) return '';
  return '★'.repeat(value) + '☆'.repeat(3 - value);
}

function answerRatingLabel(rating, videoType) {
  const asksQuestion = videoType === 'question';
  if (rating >= 3) return asksQuestion ? 'Answers it' : 'Delivers';
  if (rating === 2) return asksQuestion ? 'Partly answers it' : 'Partly delivers';
  if (rating === 1) return asksQuestion ? 'Never answers it' : "Doesn't deliver";
  return '';
}

function renderSummaryBox(summary, answer) {
  if (!answer?.hasHeader || !answer.lead) return parseMarkdown(summary);

  const rating = Number(answer.rating) || 0;
  const label = answerRatingLabel(rating, answer.videoType);

  const verdict = rating
    ? `<span class="answer-sep" aria-hidden="true">·</span>
       <span class="answer-rating" data-rating="${rating}" role="img"
             aria-label="${escapeHTML(label)}, ${rating} out of 3">
         <span class="answer-stars" aria-hidden="true">${answerStars(rating)}</span>
         <span>${escapeHTML(label)}</span>
       </span>`
    : '';

  const sectionLabel = answer.body.trim()
    ? `<div class="section-label">${/^\s*[-*]\s+/m.test(answer.body) ? 'Key points' : 'The detail'}</div>`
    : '';

  return `
    <div class="answer-card">
      <div class="answer-head">
        <span>Core takeaway</span>
        ${verdict}
      </div>
      <div class="answer-lead">${parseMarkdown(answer.lead)}</div>
    </div>
    ${sectionLabel}
    ${parseMarkdown(answer.body)}
  `;
}

function escapeHTML(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function isObsidianExportReady() {
  return obsidianEnabled && !!obsidianVault;
}

function updateObsidianButtonVisibility() {
  const btn = document.getElementById('obsidian-btn');
  if (!btn) return;
  btn.style.display = isObsidianExportReady() && currentSummaryText
    ? 'inline-flex'
    : 'none';
}

function launchObsidianUri(uri) {
  const target = String(uri || '').trim();
  if (!target.startsWith('obsidian://')) {
    throw new Error('Invalid Obsidian URI.');
  }

  const anchor = document.createElement('a');
  anchor.href = target;
  anchor.rel = 'noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  chrome.runtime.sendMessage({ action: 'OPEN_OBSIDIAN_URI', uri: target }).catch(() => {});
}

async function savePopupSummaryToObsidian() {
  if (!currentSummaryText) return;

  const btn = document.getElementById('obsidian-btn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    if (!isObsidianExportReady()) {
      throw new Error('Enable Obsidian export in settings first.');
    }

    const response = await chrome.runtime.sendMessage({
      action: 'SAVE_TO_OBSIDIAN',
      mode: 'bookmark',
      videoId: currentVideoId,
      videoTitle: currentVideoTitle,
      videoUrl: currentVideoUrl,
      summary: currentSummaryText,
      videoType: currentSummaryAnswer?.videoType || ''
    });

    if (!response?.success || !response.uri) {
      throw new Error(response?.error || 'Failed to save to Obsidian.');
    }

    if (response.useClipboard && response.markdown) {
      await navigator.clipboard.writeText(response.markdown);
    }

    launchObsidianUri(response.uri);

    showStatus('Opening in Obsidian…');
    if (btn) btn.textContent = 'Saved';
  } catch (err) {
    showStatus(`⚠️ ${err.message || String(err)}`);
    if (btn) btn.textContent = originalText;
  } finally {
    if (btn) {
      btn.disabled = false;
      setTimeout(() => {
        if (btn.textContent === 'Saved') btn.textContent = originalText;
      }, 1600);
    }
  }
}
