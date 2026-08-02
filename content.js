/**
 * TL;DW YouTube AI Summarizer - Content Script
 */

let currentVideoId = null;
let currentSummaryData = null;
let isSummarizing = false;

let watchFormat = 'paragraph';
let watchLevel = 3;

const LEVEL_LABELS = {
  1: '⚡ Level 1: TL;DR',
  2: '📝 Level 2: Short',
  3: '🎯 Level 3: Standard',
  4: '📚 Level 4: Detailed',
  5: '🔬 Level 5: Deep Dive'
};

// Observe DOM mutations for infinite scrolling feed items
const feedObserver = new MutationObserver(debounce(() => {
  enhanceFeedCards();
}, 400));

// Initialize on page load
initTLDW();

// Re-initialize on YouTube SPA navigation
window.addEventListener('yt-navigate-finish', () => {
  initTLDW();
});

window.addEventListener('popstate', () => {
  setTimeout(initTLDW, 500);
});

/**
 * Main Initialization
 */
function initTLDW() {
  const url = window.location.href;

  if (url.includes('/watch?v=')) {
    const videoId = extractVideoId(url);
    if (videoId !== currentVideoId) {
      currentVideoId = videoId;
      currentSummaryData = null;
      removeWatchSummaryBox();
      scheduleWatchBoxInjection();
    } else if (!document.getElementById('tldw-summary-container')) {
      scheduleWatchBoxInjection();
    }
  }

  // Enhance feed cards across YouTube (Home, Search, Related)
  enhanceFeedCards();

  // Start observing feed scroll
  const pageContainer = document.querySelector('ytd-page-manager') || document.body;
  feedObserver.disconnect();
  feedObserver.observe(pageContainer, { childList: true, subtree: true });
}

/**
 * Schedule injection into YouTube watch page until anchor elements appear
 */
function scheduleWatchBoxInjection() {
  let attempts = 0;
  const maxAttempts = 20;

  const interval = setInterval(() => {
    attempts++;
    const injected = injectWatchSummaryBox();
    if (injected || attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 400);
}

/**
 * Inject the Summary Box into the YouTube Watch Page
 */
function injectWatchSummaryBox() {
  if (document.getElementById('tldw-summary-container')) return true;

  // Potential injection anchors on YouTube watch page
  const targetAnchor =
    document.querySelector('ytd-watch-metadata#watch-metadata') ||
    document.querySelector('#above-the-fold') ||
    document.querySelector('#meta') ||
    document.querySelector('#primary-inner');

  if (!targetAnchor) return false;

  const container = document.createElement('div');
  container.id = 'tldw-summary-container';
  container.className = 'tldw-ltr'; // Default direction

  container.innerHTML = `
    <div class="tldw-header">
      <div class="tldw-brand">
        <span>⚡ TL;DW</span>
        <span class="tldw-badge">AI Summary</span>
      </div>
      <div class="tldw-actions">
        <select id="tldw-lang-select" class="tldw-btn" title="Summary Language">
          <option value="en" selected>🇺🇸 English</option>
          <option value="ar">🇸🇦 العربية (Arabic)</option>
          <option value="auto">🌐 Auto Language</option>
        </select>
        <button id="tldw-transcript-btn" class="tldw-btn" style="display:none;" title="Toggle Full Transcript">
          📄 Transcript
        </button>
        <button id="tldw-copy-btn" class="tldw-btn" style="display:none;" title="Copy Summary">
          📋 Copy
        </button>
        <button id="tldw-refresh-btn" class="tldw-btn" style="display:none;" title="Refresh Summary">
          🔄
        </button>
        <button id="tldw-summarize-btn" class="tldw-btn tldw-btn-primary">
          ✨ Summarize Video
        </button>
      </div>
    </div>

    <!-- Format and Detail Level Toolbar -->
    <div class="tldw-toolbar-row">
      <div class="tldw-format-group">
        <button type="button" class="tldw-format-btn active" data-format="paragraph">📝 Paragraph</button>
        <button type="button" class="tldw-format-btn" data-format="bullets">📑 Bullets</button>
        <button type="button" class="tldw-format-btn" data-format="key_takeaways">💡 Takeaways</button>
      </div>
      <div class="tldw-slider-group">
        <span id="tldw-watch-level-badge" class="tldw-level-badge">🎯 Level 3: Standard</span>
        <input type="range" id="tldw-watch-level-slider" min="1" max="5" step="1" value="3" class="tldw-range-slider" title="Detail Level Slider">
      </div>
    </div>

    <div class="tldw-body" id="tldw-body">
      <div class="tldw-placeholder">
        <span class="tldw-placeholder-text">Get a clean AI summary of this video without watching the whole thing.</span>
      </div>
    </div>
    <div id="tldw-transcript-box" class="tldw-transcript-box"></div>
  `;

  // Insert before description or at top of target anchor
  const descriptionElement = targetAnchor.querySelector('#description') || targetAnchor.querySelector('#bottom-row');
  if (descriptionElement && descriptionElement.parentNode) {
    descriptionElement.parentNode.insertBefore(container, descriptionElement);
  } else {
    targetAnchor.prepend(container);
  }

  // Bind Event Listeners
  document.getElementById('tldw-summarize-btn').addEventListener('click', () => fetchAndRenderWatchSummary(false));
  document.getElementById('tldw-refresh-btn').addEventListener('click', () => fetchAndRenderWatchSummary(true));
  document.getElementById('tldw-copy-btn').addEventListener('click', copySummaryToClipboard);
  document.getElementById('tldw-transcript-btn').addEventListener('click', toggleTranscriptBox);
  document.getElementById('tldw-lang-select').addEventListener('change', () => fetchAndRenderWatchSummary(false));

  const slider = document.getElementById('tldw-watch-level-slider');
  slider.addEventListener('input', (e) => {
    watchLevel = Number(e.target.value);
    updateWatchLevelBadge(watchLevel);
  });
  slider.addEventListener('change', () => {
    fetchAndRenderWatchSummary(false);
  });

  const formatBtns = container.querySelectorAll('.tldw-format-btn');
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      watchFormat = btn.dataset.format;
      updateWatchFormatButtons(watchFormat);
      fetchAndRenderWatchSummary(false);
    });
  });

  // Load saved settings
  chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (res) => {
    if (res?.success && res.settings) {
      watchFormat = res.settings.summaryFormat || 'paragraph';
      watchLevel = res.settings.summaryLevel || 3;
      slider.value = watchLevel;
      updateWatchLevelBadge(watchLevel);
      updateWatchFormatButtons(watchFormat);

      if (res.settings.autoSummarizeWatch) {
        fetchAndRenderWatchSummary(false);
      }
    }
  });

  return true;
}

function updateWatchFormatButtons(format) {
  const container = document.getElementById('tldw-summary-container');
  if (!container) return;
  container.querySelectorAll('.tldw-format-btn').forEach(btn => {
    if (btn.dataset.format === format) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateWatchLevelBadge(level) {
  const badge = document.getElementById('tldw-watch-level-badge');
  if (badge) {
    badge.textContent = LEVEL_LABELS[level] || `Level ${level}`;
  }
}

/**
 * Remove watch page summary box
 */
function removeWatchSummaryBox() {
  const box = document.getElementById('tldw-summary-container');
  if (box) box.remove();
}

/**
 * Fetch summary from background script and render on watch page
 */
async function fetchAndRenderWatchSummary(forceRefresh = false) {
  if (isSummarizing) return;
  isSummarizing = true;

  const container = document.getElementById('tldw-summary-container');
  const bodyEl = document.getElementById('tldw-body');
  const summarizeBtn = document.getElementById('tldw-summarize-btn');
  const langSelect = document.getElementById('tldw-lang-select');

  if (!container || !bodyEl) return;

  const selectedLang = langSelect ? langSelect.value : 'en';
  const videoTitle = getWatchVideoTitle();

  // Show Loading State
  bodyEl.innerHTML = `
    <div class="tldw-loading">
      <div class="tldw-spinner"></div>
      <span>Retrieving transcript via Clipscript.uk & generating summary...</span>
    </div>
  `;

  if (summarizeBtn) summarizeBtn.style.display = 'none';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_SUMMARY',
      videoId: currentVideoId,
      videoUrl: window.location.href,
      videoTitle,
      language: selectedLang,
      summaryLevel: watchLevel,
      summaryFormat: watchFormat,
      forceRefresh
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate summary.');
    }

    currentSummaryData = response;

    // Detect RTL (Arabic) or LTR text
    const isArabic = isArabicText(response.summary);
    container.className = isArabic ? 'tldw-rtl' : 'tldw-ltr';

    // Render Formatted Markdown Summary
    bodyEl.innerHTML = `
      <div class="tldw-summary-text">${parseMarkdown(response.summary)}</div>
    `;

    // Populate Transcript box
    const transcriptBox = document.getElementById('tldw-transcript-box');
    if (transcriptBox && response.transcript) {
      transcriptBox.textContent = response.transcript;
    }

    // Show Action buttons
    document.getElementById('tldw-copy-btn').style.display = 'inline-flex';
    document.getElementById('tldw-refresh-btn').style.display = 'inline-flex';
    if (response.transcript) {
      document.getElementById('tldw-transcript-btn').style.display = 'inline-flex';
    }

  } catch (err) {
    bodyEl.innerHTML = `
      <div class="tldw-error">
        ⚠️ <strong>Error:</strong> ${escapeHTML(err.message || String(err))}
      </div>
    `;
    if (summarizeBtn) {
      summarizeBtn.style.display = 'inline-flex';
      summarizeBtn.textContent = '🔄 Retry Summarize';
    }
  } finally {
    isSummarizing = false;
  }
}

/**
 * Toggle Raw Transcript visibility
 */
function toggleTranscriptBox() {
  const box = document.getElementById('tldw-transcript-box');
  if (box) {
    box.classList.toggle('tldw-show');
  }
}

/**
 * Copy summary to clipboard
 */
function copySummaryToClipboard() {
  if (!currentSummaryData?.summary) return;
  navigator.clipboard.writeText(currentSummaryData.summary).then(() => {
    const btn = document.getElementById('tldw-copy-btn');
    if (btn) {
      const origText = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = origText; }, 2000);
    }
  });
}

/**
 * Enhance Feed Video Cards on YouTube Home, Search, and Recommendations
 */
function enhanceFeedCards() {
  const cardSelectors = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer'
  ];

  const cards = document.querySelectorAll(cardSelectors.join(','));

  cards.forEach(card => {
    if (card.querySelector('.tldw-feed-pill')) return;

    const titleLink = card.querySelector('a#video-title-link, a#video-title, a#thumbnail');
    if (!titleLink || !titleLink.href) return;

    const videoId = extractVideoId(titleLink.href);
    if (!videoId) return;

    const metaContainer =
      card.querySelector('#meta') ||
      card.querySelector('.title-wrapper') ||
      card.querySelector('#details') ||
      card.querySelector('ytd-video-meta-block');

    if (!metaContainer) return;

    const pill = document.createElement('button');
    pill.className = 'tldw-feed-pill';
    pill.innerHTML = '⚡ Summarize';
    pill.title = 'Get AI summary using Clipscript transcript';

    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleFeedCardSummary(card, videoId, titleLink.href, pill);
    });

    metaContainer.appendChild(pill);
  });
}

/**
 * Handle feed card summary request
 */
async function handleFeedCardSummary(card, videoId, videoUrl, pillBtn) {
  let summaryBox = card.querySelector('.tldw-feed-card-summary');
  
  if (summaryBox) {
    summaryBox.remove();
    pillBtn.innerHTML = '⚡ Summarize';
    return;
  }

  pillBtn.innerHTML = '⏳ Loading...';

  const titleEl = card.querySelector('#video-title, #video-title-link');
  const videoTitle = titleEl ? titleEl.textContent.trim() : '';

  summaryBox = document.createElement('div');
  summaryBox.className = 'tldw-feed-card-summary tldw-ltr';
  summaryBox.innerHTML = 'Retrieving transcript & summarizing...';

  const metaContainer = pillBtn.parentElement;
  metaContainer.appendChild(summaryBox);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_SUMMARY',
      videoId,
      videoUrl,
      videoTitle,
      language: 'en',
      summaryLevel: watchLevel,
      summaryFormat: watchFormat
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to summarize video.');
    }

    const isArabic = isArabicText(response.summary);
    summaryBox.className = `tldw-feed-card-summary ${isArabic ? 'tldw-rtl' : 'tldw-ltr'}`;
    summaryBox.innerHTML = `
      <div style="font-weight: 700; font-size: 11px; margin-bottom: 6px; color: #ff3366;">⚡ TL;DW Summary:</div>
      <div>${parseMarkdown(response.summary)}</div>
    `;

    pillBtn.innerHTML = '❌ Hide Summary';

  } catch (err) {
    summaryBox.innerHTML = `⚠️ <span style="color:#ff4d4d;">${escapeHTML(err.message || String(err))}</span>`;
    pillBtn.innerHTML = '⚡ Summarize';
  }
}

/**
 * Lightweight Inline Markdown to HTML Parser
 */
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

/**
 * Helpers
 */
function extractVideoId(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function getWatchVideoTitle() {
  const titleEl = document.querySelector('h1.ytd-watch-metadata, h1.title, #title h1');
  return titleEl ? titleEl.textContent.trim() : '';
}

function isArabicText(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text || '');
}

function escapeHTML(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
