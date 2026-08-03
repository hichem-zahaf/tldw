/**
 * TL;DW YouTube AI Summarizer - Content Script
 */

let currentVideoId = null;
let currentSummaryData = null;
let isSummarizing = false;
let activeSummaryRequestId = null;

let watchFormat = 'paragraph';
let watchLevel = 3;
let queueLanguage = 'en';
let summaryQueue = [];
let isSummaryQueueOpen = false;
let contentSettingsLoaded = false;
const collapsedSummaryQueueItemIds = new Set();

const SUMMARY_QUEUE_KEY = 'tldw_summary_queue';

const LEVEL_LABELS = {
  1: 'Brief',
  2: 'Short',
  3: 'Medium',
  4: 'Detailed',
  5: 'Full'
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

window.addEventListener('resize', debounce(repositionWatchSummaryBox, 250));

chrome.runtime.onMessage.addListener((request) => {
  if (
    request.action === 'SUMMARY_PROGRESS' &&
    request.summaryRequestId === activeSummaryRequestId &&
    request.status
  ) {
    renderWatchLoadingStatus(request.status);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SUMMARY_QUEUE_KEY]) return;
  summaryQueue = Array.isArray(changes[SUMMARY_QUEUE_KEY].newValue)
    ? changes[SUMMARY_QUEUE_KEY].newValue
    : [];
  renderSummaryQueueWidget();
  updateFeedPillStates();
});

/**
 * Main Initialization
 */
function initTLDW() {
  const url = window.location.href;

  ensureContentSettingsLoaded();
  injectSummaryQueueWidget();
  loadSummaryQueue();

  if (url.includes('/watch?v=')) {
    const videoId = extractVideoId(url);
    if (videoId !== currentVideoId) {
      currentVideoId = videoId;
      currentSummaryData = null;
      removeWatchSummaryBox();
      scheduleWatchBoxInjection();
    } else if (!document.getElementById('tldw-summary-container')) {
      scheduleWatchBoxInjection();
    } else {
      repositionWatchSummaryBox();
    }
  }

  // Enhance feed cards across YouTube (Home, Search, Related)
  enhanceFeedCards();

  // Start observing feed scroll
  const pageContainer = document.querySelector('ytd-page-manager') || document.body;
  feedObserver.disconnect();
  feedObserver.observe(pageContainer, { childList: true, subtree: true });
}

async function ensureContentSettingsLoaded() {
  if (contentSettingsLoaded) return;
  contentSettingsLoaded = true;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    if (res?.success && res.settings) {
      watchFormat = res.settings.summaryFormat || watchFormat;
      watchLevel = res.settings.summaryLevel || watchLevel;
      queueLanguage = res.settings.summaryLanguage || queueLanguage;
    }
  } catch (_) {}
}

async function loadSummaryQueue() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_SUMMARY_QUEUE' });
    if (res?.success) {
      summaryQueue = Array.isArray(res.queue) ? res.queue : [];
      renderSummaryQueueWidget();
      updateFeedPillStates();
    }
  } catch (_) {}
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
  const targetAnchor = getBelowVideoSummaryAnchor();

  if (!targetAnchor && !getSidebarSummaryAnchor()) return false;

  const container = document.createElement('div');
  container.id = 'tldw-summary-container';
  container.className = 'tldw-ltr'; // Default direction

  container.innerHTML = `
    <div class="tldw-header">
      <div class="tldw-brand">
        <span>⚡ TL;DW</span>
        <span class="tldw-badge">AI Summary</span>
      </div>
      <div class="tldw-compact-toolbar" aria-label="Summary toolbar">
        <select id="tldw-lang-select" class="tldw-select" title="Summary language" aria-label="Summary language">
          <option value="en" selected>English</option>
          <option value="ar">العربية</option>
          <option value="auto">Auto</option>
        </select>
        <button id="tldw-transcript-btn" class="tldw-btn tldw-btn-secondary" style="display:none;" title="Toggle full transcript">
          Transcript
        </button>
        <button id="tldw-copy-btn" class="tldw-icon-btn" style="display:none;" title="Copy summary" aria-label="Copy summary" data-sidebar-label="Copy">
          <span aria-hidden="true">⧉</span>
        </button>
        <button id="tldw-refresh-btn" class="tldw-icon-btn" style="display:none;" title="Refresh summary" aria-label="Refresh summary" data-sidebar-label="Refresh">
          <span aria-hidden="true">↻</span>
        </button>
        <button id="tldw-summarize-btn" class="tldw-btn tldw-btn-primary">
          Summarize
        </button>
      </div>
    </div>

    <div class="tldw-settings-row" aria-label="Summary settings">
      <div class="tldw-segmented tldw-format-group" role="group" aria-label="Summary format">
        <button type="button" class="tldw-format-btn active" data-format="paragraph">Paragraph</button>
        <button type="button" class="tldw-format-btn" data-format="bullets">Bullets</button>
        <button type="button" class="tldw-format-btn" data-format="key_takeaways">Takeaways</button>
      </div>
      <div class="tldw-level-group">
        <span class="tldw-settings-label">Length</span>
        <div class="tldw-segmented tldw-detail-group" role="group" aria-label="Summary length">
          <button type="button" class="tldw-level-btn" data-level="1">Brief</button>
          <button type="button" class="tldw-level-btn" data-level="2">Short</button>
          <button type="button" class="tldw-level-btn active" data-level="3">Medium</button>
          <button type="button" class="tldw-level-btn" data-level="4">Detailed</button>
          <button type="button" class="tldw-level-btn" data-level="5">Full</button>
        </div>
        <select id="tldw-level-select" class="tldw-select tldw-level-select" title="Summary length" aria-label="Summary length">
          <option value="1">Brief</option>
          <option value="2">Short</option>
          <option value="3" selected>Medium</option>
          <option value="4">Detailed</option>
          <option value="5">Full</option>
        </select>
      </div>
    </div>

    <div class="tldw-body" id="tldw-body">
      <div class="tldw-placeholder">
        <span class="tldw-placeholder-text">Get a clean AI summary of this video without watching the whole thing.</span>
      </div>
    </div>
    <div id="tldw-transcript-box" class="tldw-transcript-box"></div>
  `;

  placeWatchSummaryBox(container);

  // Bind Event Listeners
  document.getElementById('tldw-summarize-btn').addEventListener('click', () => fetchAndRenderWatchSummary(false));
  document.getElementById('tldw-refresh-btn').addEventListener('click', () => fetchAndRenderWatchSummary(true));
  document.getElementById('tldw-copy-btn').addEventListener('click', copySummaryToClipboard);
  document.getElementById('tldw-transcript-btn').addEventListener('click', toggleTranscriptBox);
  document.getElementById('tldw-lang-select').addEventListener('change', () => fetchAndRenderWatchSummary(false));
  document.getElementById('tldw-level-select').addEventListener('change', (e) => {
    watchLevel = Number(e.target.value);
    updateWatchLevelBadge(watchLevel);
    fetchAndRenderWatchSummary(false);
  });

  const levelBtns = container.querySelectorAll('.tldw-level-btn');
  levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      watchLevel = Number(btn.dataset.level);
      updateWatchLevelBadge(watchLevel);
      fetchAndRenderWatchSummary(false);
    });
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
      updateWatchLevelBadge(watchLevel);
      updateWatchFormatButtons(watchFormat);

      if (res.settings.autoSummarizeWatch) {
        fetchAndRenderWatchSummary(false);
      }
    }
  });

  setTimeout(repositionWatchSummaryBox, 1000);
  setTimeout(repositionWatchSummaryBox, 2500);

  return true;
}

function updateWatchFormatButtons(format) {
  const container = document.getElementById('tldw-summary-container');
  if (!container) return;
  container.querySelectorAll('.tldw-format-btn').forEach(btn => {
    const isActive = btn.dataset.format === format;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function updateWatchLevelBadge(level) {
  const container = document.getElementById('tldw-summary-container');
  if (!container) return;
  container.querySelectorAll('.tldw-level-btn').forEach(btn => {
    const isActive = Number(btn.dataset.level) === Number(level);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
    btn.title = LEVEL_LABELS[btn.dataset.level] || `Level ${btn.dataset.level}`;
  });

  const levelSelect = container.querySelector('#tldw-level-select');
  if (levelSelect) {
    levelSelect.value = String(level);
  }
}

function repositionWatchSummaryBox() {
  const container = document.getElementById('tldw-summary-container');
  if (container) {
    placeWatchSummaryBox(container);
  }
}

function placeWatchSummaryBox(container) {
  const sidebarAnchor = getSidebarSummaryAnchor();

  if (sidebarAnchor) {
    container.classList.add('tldw-sidebar');
    container.classList.remove('tldw-below-video');
    sidebarAnchor.prepend(container);
    return true;
  }

  const belowVideoAnchor = getBelowVideoSummaryAnchor();
  if (!belowVideoAnchor) return false;

  container.classList.add('tldw-below-video');
  container.classList.remove('tldw-sidebar');

  const descriptionElement = belowVideoAnchor.querySelector('#description') || belowVideoAnchor.querySelector('#bottom-row');
  if (descriptionElement && descriptionElement.parentNode) {
    descriptionElement.parentNode.insertBefore(container, descriptionElement);
  } else {
    belowVideoAnchor.prepend(container);
  }

  return true;
}

function getSidebarSummaryAnchor() {
  if (!window.matchMedia('(min-width: 1120px)').matches) return null;

  const secondaryInner =
    document.querySelector('ytd-watch-flexy #secondary-inner') ||
    document.querySelector('#secondary-inner');

  if (!secondaryInner) return null;

  const secondary = secondaryInner.closest('#secondary') || secondaryInner;
  const secondaryRect = secondary.getBoundingClientRect();
  if (secondaryRect.width < 300 || secondaryRect.height === 0) return null;

  return secondaryInner;
}

function getBelowVideoSummaryAnchor() {
  return (
    document.querySelector('ytd-watch-metadata#watch-metadata') ||
    document.querySelector('#above-the-fold') ||
    document.querySelector('#meta') ||
    document.querySelector('#primary-inner')
  );
}

function setWatchSummaryDirection(isRtl) {
  const container = document.getElementById('tldw-summary-container');
  if (!container) return;
  container.classList.toggle('tldw-rtl', isRtl);
  container.classList.toggle('tldw-ltr', !isRtl);
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

  if (!container || !bodyEl) {
    isSummarizing = false;
    return;
  }

  const selectedLang = langSelect ? langSelect.value : 'en';
  const videoTitle = getWatchVideoTitle();
  const summaryRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeSummaryRequestId = summaryRequestId;

  // Show Loading State
  renderWatchLoadingStatus('Checking cache...');

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
      summaryRequestId,
      forceRefresh
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate summary.');
    }

    currentSummaryData = response;

    // Detect RTL (Arabic) or LTR text
    const isArabic = isArabicText(response.summary);
    setWatchSummaryDirection(isArabic);

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
    if (activeSummaryRequestId === summaryRequestId) {
      activeSummaryRequestId = null;
    }
    isSummarizing = false;
  }
}

function renderWatchLoadingStatus(status) {
  const bodyEl = document.getElementById('tldw-body');
  if (!bodyEl) return;

  bodyEl.innerHTML = `
    <div class="tldw-loading">
      <div class="tldw-spinner"></div>
      <span>${escapeHTML(status)}</span>
    </div>
  `;
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
      const origSidebarLabel = btn.dataset.sidebarLabel;
      btn.innerHTML = '<span aria-hidden="true">✓</span>';
      btn.dataset.sidebarLabel = 'Copied';
      setTimeout(() => {
        btn.innerHTML = origText;
        btn.dataset.sidebarLabel = origSidebarLabel;
      }, 2000);
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
    'ytd-grid-video-renderer',
    'yt-lockup-view-model'
  ];

  const cards = document.querySelectorAll(cardSelectors.join(','));

  cards.forEach(card => {
    const existingPill = card.querySelector('.tldw-feed-pill');
    if (existingPill) {
      markFeedCardEnhanced(card);
      if (existingPill.classList.contains('tldw-feed-pill-overlay') && existingPill.parentElement !== card) {
        insertFeedPill(card, existingPill);
      }
      return;
    }

    const titleLink = getFeedCardTitleLink(card);
    if (!titleLink || !titleLink.href) return;

    const videoId = extractVideoId(titleLink.href);
    if (!videoId) return;

    const pill = document.createElement('button');
    pill.className = 'tldw-feed-pill';
    pill.dataset.videoId = videoId;
    pill.innerHTML = '⚡ Summarize';
    pill.title = 'Add this video to the TL;DW summary queue';

    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleFeedCardSummary(card, videoId, titleLink.href, pill, getFeedCardVideoTitle(card, titleLink));
    });

    markFeedCardEnhanced(card);
    insertFeedPill(card, pill);
  });

  updateFeedPillStates();
}

function markFeedCardEnhanced(card) {
  card.classList.add('tldw-feed-card-enhanced');

  if (card.dataset.tldwHoverBound === 'true') return;
  card.dataset.tldwHoverBound = 'true';

  let hideTimer = null;

  card.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer);
    card.classList.add('tldw-feed-card-active');
  });
  card.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => {
      card.classList.remove('tldw-feed-card-active');
    }, 120);
  });
  card.addEventListener('focusin', () => {
    clearTimeout(hideTimer);
    card.classList.add('tldw-feed-card-active');
  });
  card.addEventListener('focusout', () => {
    card.classList.remove('tldw-feed-card-active');
  });
}

function getFeedCardTitleLink(card) {
  return card.querySelector([
    'a#video-title-link',
    'a#video-title',
    '.yt-lockup-metadata-view-model__title a[href*="/watch"]',
    'yt-lockup-metadata-view-model a[href*="/watch"]',
    'h3 a[href*="/watch"]',
    'a[aria-label][href*="/watch"]',
    'a[href*="/watch?v="]',
    'a#thumbnail'
  ].join(','));
}

function getFeedCardVideoTitle(card, titleLink) {
  const titleEl = card.querySelector([
    'a#video-title-link',
    'a#video-title',
    '.yt-lockup-metadata-view-model__title a[href*="/watch"]',
    'yt-lockup-metadata-view-model a[href*="/watch"]',
    'h3 a[href*="/watch"]',
    'a[title][href*="/watch"]',
    'a[aria-label][href*="/watch"]'
  ].join(','));

  return cleanFeedCardTitle(
    titleEl?.textContent ||
    titleEl?.getAttribute('title') ||
    titleEl?.getAttribute('aria-label') ||
    titleLink?.textContent ||
    titleLink?.getAttribute('title') ||
    titleLink?.getAttribute('aria-label') ||
    ''
  );
}

function cleanFeedCardTitle(rawTitle) {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';

  return title
    .replace(/\s+by\s+.+$/i, '')
    .replace(/\s+\d+(?:,\d+)?\s+views?.*$/i, '')
    .trim();
}

function insertFeedPill(card, pill) {
  const thumbnail =
    card.querySelector('yt-thumbnail-view-model') ||
    card.querySelector('.yt-thumbnail-view-model') ||
    card.querySelector('ytd-thumbnail') ||
    card.querySelector('a#thumbnail')?.parentElement ||
    card.querySelector('a[href*="/watch"] img')?.parentElement ||
    card.querySelector('#thumbnail');

  if (thumbnail) {
    pill.classList.add('tldw-feed-pill-overlay');
    card.style.position = card.style.position || 'relative';
    card.appendChild(pill);
    return;
  }

  const details =
    card.querySelector('#details') ||
    card.querySelector('.details') ||
    card.querySelector('ytd-rich-grid-media #meta');

  if (details) {
    details.appendChild(pill);
    return;
  }

  const metadataBlock =
    card.querySelector('ytd-video-meta-block') ||
    card.querySelector('#metadata-line') ||
    card.querySelector('.title-wrapper');

  if (metadataBlock?.parentElement) {
    metadataBlock.parentElement.insertBefore(pill, metadataBlock.nextSibling);
    return;
  }

  card.appendChild(pill);
}

/**
 * Handle feed card summary request
 */
async function handleFeedCardSummary(card, videoId, videoUrl, pillBtn, videoTitle = '') {
  const existing = findQueueItemByVideoId(videoId);
  if (existing) {
    isSummaryQueueOpen = true;
    renderSummaryQueueWidget(existing.id);
    return;
  }

  pillBtn.disabled = true;
  pillBtn.innerHTML = 'Queued...';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'QUEUE_SUMMARY',
      videoId,
      videoUrl,
      videoTitle,
      language: queueLanguage,
      summaryLevel: watchLevel,
      summaryFormat: watchFormat
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to queue video.');
    }

    summaryQueue = Array.isArray(response.queue) ? response.queue : summaryQueue;
    isSummaryQueueOpen = true;
    renderSummaryQueueWidget(response.item?.id);
    updateFeedPillStates();

  } catch (err) {
    pillBtn.innerHTML = 'Retry queue';
    pillBtn.title = err.message || String(err);
  } finally {
    pillBtn.disabled = false;
  }
}

function findQueueItemByVideoId(videoId) {
  return summaryQueue.find(item => item.videoId === videoId);
}

function updateFeedPillStates() {
  document.querySelectorAll('.tldw-feed-pill').forEach(pill => {
    const item = findQueueItemByVideoId(pill.dataset.videoId);

    pill.disabled = false;
    pill.classList.remove('tldw-feed-pill-running', 'tldw-feed-pill-done', 'tldw-feed-pill-error');

    if (!item) {
      pill.innerHTML = '⚡ Summarize';
      pill.title = 'Add this video to the TL;DW summary queue';
      return;
    }

    if (item.status === 'done') {
      pill.innerHTML = '✓ In Queue';
      pill.title = 'Summary ready. Click to open the TL;DW queue.';
      pill.classList.add('tldw-feed-pill-done');
      return;
    }

    if (item.status === 'error') {
      pill.innerHTML = '⚠ Queue Error';
      pill.title = item.error || 'Summary failed. Click to open the TL;DW queue.';
      pill.classList.add('tldw-feed-pill-error');
      return;
    }

    pill.innerHTML = item.status === 'running' ? '⏳ Summarizing' : 'Queued';
    pill.title = item.progress || 'Summary queued.';
    pill.classList.add('tldw-feed-pill-running');
  });
}

function injectSummaryQueueWidget() {
  if (document.getElementById('tldw-summary-queue-widget')) return true;
  if (!document.body) return false;

  const widget = document.createElement('div');
  widget.id = 'tldw-summary-queue-widget';
  widget.className = 'tldw-summary-queue-widget';
  widget.style.display = 'none';
  document.body.appendChild(widget);

  widget.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-tldw-queue-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.tldwQueueAction;
    const id = actionEl.dataset.queueId;

    if (action === 'toggle') {
      isSummaryQueueOpen = !isSummaryQueueOpen;
      renderSummaryQueueWidget();
      return;
    }

    if (action === 'close') {
      isSummaryQueueOpen = false;
      renderSummaryQueueWidget();
      return;
    }

    const item = summaryQueue.find(queueItem => queueItem.id === id);
    if (!item) return;

    if (action === 'toggle-summary' && e.target.closest('a, button')) {
      return;
    }

    if (action === 'copy' && item.summary) {
      await navigator.clipboard.writeText(item.summary);
      const originalText = actionEl.textContent;
      actionEl.textContent = 'Copied';
      setTimeout(() => {
        actionEl.textContent = originalText;
      }, 1600);
      return;
    }

    if (action === 'toggle-summary') {
      if (collapsedSummaryQueueItemIds.has(id)) {
        collapsedSummaryQueueItemIds.delete(id);
      } else {
        collapsedSummaryQueueItemIds.add(id);
      }
      renderSummaryQueueWidget(id);
      return;
    }

    if (action === 'retry') {
      actionEl.textContent = 'Retrying...';
      const res = await chrome.runtime.sendMessage({
        action: 'RETRY_SUMMARY_QUEUE_ITEM',
        id
      });
      if (res?.success) {
        summaryQueue = Array.isArray(res.queue) ? res.queue : summaryQueue;
        renderSummaryQueueWidget(id);
        updateFeedPillStates();
      }
      return;
    }

    if (action === 'remove') {
      actionEl.textContent = 'Removing...';
      const res = await chrome.runtime.sendMessage({
        action: 'REMOVE_SUMMARY_QUEUE_ITEM',
        id
      });
      if (res?.success) {
        collapsedSummaryQueueItemIds.delete(id);
        summaryQueue = Array.isArray(res.queue) ? res.queue : summaryQueue.filter(queueItem => queueItem.id !== id);
        renderSummaryQueueWidget();
        updateFeedPillStates();
      }
    }
  });

  renderSummaryQueueWidget();
  return true;
}

function renderSummaryQueueWidget(focusedId = '') {
  const widget = document.getElementById('tldw-summary-queue-widget');
  if (!widget) return;

  const stats = getSummaryQueueStats();
  const shouldShow = summaryQueue.length > 0 || isSummaryQueueOpen;
  widget.style.display = shouldShow ? 'block' : 'none';
  widget.classList.toggle('tldw-summary-queue-open', isSummaryQueueOpen);

  const statusText = stats.pending > 0
    ? `${stats.pending} running`
    : stats.error > 0
      ? `${stats.error} failed`
      : `${stats.done} done`;

  widget.innerHTML = `
    <button class="tldw-summary-queue-toggle" type="button" data-tldw-queue-action="toggle" aria-expanded="${String(isSummaryQueueOpen)}">
      <span class="tldw-summary-queue-logo">⚡</span>
      <span class="tldw-summary-queue-title">TL;DW Queue</span>
      <span class="tldw-summary-queue-count">${stats.total}</span>
      <span class="tldw-summary-queue-subtitle">${escapeHTML(statusText)}</span>
    </button>
    ${isSummaryQueueOpen ? renderSummaryQueuePanel(focusedId) : ''}
  `;
}

function renderSummaryQueuePanel(focusedId) {
  const itemsHtml = summaryQueue.length
    ? summaryQueue.map(item => renderSummaryQueueItem(item, focusedId)).join('')
    : '<div class="tldw-summary-queue-empty">No summaries queued yet.</div>';

  return `
    <div class="tldw-summary-queue-panel" role="dialog" aria-label="TL;DW summary queue">
      <div class="tldw-summary-queue-panel-header">
        <div>
          <div class="tldw-summary-queue-panel-title">Summary Queue</div>
          <div class="tldw-summary-queue-panel-meta">Recent summaries stay here while you browse.</div>
        </div>
        <button class="tldw-summary-queue-close" type="button" data-tldw-queue-action="close" aria-label="Close queue">×</button>
      </div>
      <div class="tldw-summary-queue-items">
        ${itemsHtml}
      </div>
    </div>
  `;
}

function renderSummaryQueueItem(item, focusedId) {
  const isDone = item.status === 'done';
  const isError = item.status === 'error';
  const isFocused = focusedId && item.id === focusedId;
  const isCollapsed = collapsedSummaryQueueItemIds.has(item.id);
  const statusLabel = getSummaryQueueStatusLabel(item);
  const summaryHtml = isDone && item.summary && !isCollapsed
    ? `<div class="tldw-summary-queue-result ${isArabicText(item.summary) ? 'tldw-rtl' : 'tldw-ltr'}">${parseMarkdown(item.summary)}</div>`
    : '';
  const collapsedHtml = isDone && item.summary && isCollapsed
    ? '<div class="tldw-summary-queue-collapsed">Summary collapsed.</div>'
    : '';
  const errorHtml = isError && item.error
    ? `<div class="tldw-summary-queue-error">${escapeHTML(item.error)}</div>`
    : '';

  return `
    <article class="tldw-summary-queue-item ${isFocused ? 'tldw-summary-queue-item-focused' : ''}" data-status="${escapeHTML(item.status || 'queued')}">
      <div class="tldw-summary-queue-item-top" ${isDone && item.summary ? `data-tldw-queue-action="toggle-summary" data-queue-id="${escapeHTML(item.id)}"` : ''}>
        <a class="tldw-summary-queue-video-title" href="${escapeHTML(item.videoUrl || '#')}" target="_blank" rel="noreferrer">
          ${escapeHTML(item.videoTitle || 'YouTube video')}
        </a>
        <span class="tldw-summary-queue-status">${escapeHTML(statusLabel)}</span>
      </div>
      <div class="tldw-summary-queue-progress">${escapeHTML(item.progress || '')}</div>
      ${summaryHtml}
      ${collapsedHtml}
      ${errorHtml}
      <div class="tldw-summary-queue-actions">
        ${isDone ? `<button type="button" data-tldw-queue-action="copy" data-queue-id="${escapeHTML(item.id)}">Copy</button>` : ''}
        ${isError ? `<button type="button" data-tldw-queue-action="retry" data-queue-id="${escapeHTML(item.id)}">Retry</button>` : ''}
        <a href="${escapeHTML(item.videoUrl || '#')}" target="_blank" rel="noreferrer">Open video</a>
        <button class="tldw-summary-queue-remove" type="button" data-tldw-queue-action="remove" data-queue-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.videoTitle || 'YouTube video')} from queue">Remove</button>
      </div>
    </article>
  `;
}

function getSummaryQueueStats() {
  return summaryQueue.reduce((stats, item) => {
    stats.total += 1;
    if (item.status === 'done') stats.done += 1;
    else if (item.status === 'error') stats.error += 1;
    else stats.pending += 1;
    return stats;
  }, {
    total: 0,
    pending: 0,
    done: 0,
    error: 0
  });
}

function getSummaryQueueStatusLabel(item) {
  if (item.status === 'done') return item.cached ? 'Cached' : 'Done';
  if (item.status === 'error') return 'Failed';
  if (item.status === 'running') return 'Running';
  return 'Queued';
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
