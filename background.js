import { generateSummary } from './summarizer.js';
import { ACTIVE_SUMMARY_PROMPT_VARIANT } from './summary-prompts.js';
import { getSummaryProgressMessage } from './summary-progress.js';
import {
  buildClassificationCacheKey,
  classifyVideo,
  heuristicClassification
} from './video-classifier.js';
import { parseSummaryAnswer } from './summary-answer.js';
import {
  SUMMARY_QUEUE_KEY,
  buildQueueItem,
  countUnreadQueueItems,
  getQueueStats,
  markQueueItemsRead,
  mergeQueueItem
} from './summary-queue.js';
import { buildObsidianOpenVaultUri, planObsidianExport } from './obsidian-export.js';
import {
  TIME_SAVED_KEY,
  getTimeSavedStats,
  normalizeTimeSavedLedger,
  parseDurationSeconds,
  recordTimeSaved
} from './time-saved.js';

// Default configuration settings
const DEFAULT_SETTINGS = {
  clipscriptApiKey: '',
  aiProvider: 'gemini', // 'gemini', 'openai', 'groq', 'anthropic', 'openrouter'
  aiApiKey: '',
  summaryLanguage: 'en', // 'en', 'ar', 'auto'
  summaryLevel: 3, // Level 1 (Ultra Short) to 5 (Deep Dive)
  summaryFormat: 'paragraph', // 'paragraph', 'bullets', 'key_takeaways'
  autoSummarizeWatch: false,
  showFeedButtons: true,
  answerFirst: true,
  obsidianEnabled: false,
  obsidianVault: ''
};

let summaryQueueWriteLock = Promise.resolve();
let timeSavedWriteLock = Promise.resolve();

function buildSummaryCacheKey({ videoId, language, level, format, provider }) {
  return `summary_${videoId}_${language}_L${level}_F${format}_${provider}_P${ACTIVE_SUMMARY_PROMPT_VARIANT}`;
}

/**
 * Classifies from thumbnail + title, caching per video. Callers start this
 * before transcript retrieval and await it just before summarizing, so the
 * vision call costs no wall-clock time.
 */
async function getVideoClassification({ videoId, videoTitle, settings }) {
  if (!videoId) return heuristicClassification(videoTitle);
  if (settings.answerFirst === false) return heuristicClassification(videoTitle);

  const cacheKey = buildClassificationCacheKey(videoId);
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached?.[cacheKey]?.type) return cached[cacheKey];

  const classification = await classifyVideo({
    provider: settings.aiProvider,
    apiKey: settings.aiApiKey,
    videoId,
    videoTitle
  });

  // A heuristic result is a fallback, not an answer — never cache it, so the
  // next attempt can still reach the model.
  if (classification.source === 'model') {
    await chrome.storage.local.set({ [cacheKey]: classification });
  }

  return classification;
}

function buildSummaryAnswer(summary, classification) {
  const parsed = parseSummaryAnswer(summary);

  return {
    ...parsed,
    // The classifier read the promise off the thumbnail, which is the version
    // the reader recognizes. The summary only supplies one as a fallback.
    hook: classification?.hook || parsed.hook,
    videoType: classification?.type || '',
    thumbnailText: classification?.thumbnailText || ''
  };
}

function createSummaryProgressReporter(request, sender) {
  return (step) => {
    if (!request.summaryRequestId) return;

    const message = {
      action: 'SUMMARY_PROGRESS',
      summaryRequestId: request.summaryRequestId,
      step,
      status: getSummaryProgressMessage(step)
    };

    if (sender?.tab?.id !== undefined) {
      chrome.tabs.sendMessage(sender.tab.id, message).catch(() => {});
      return;
    }

    chrome.runtime.sendMessage(message).catch(() => {});
  };
}

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const newSettings = { ...DEFAULT_SETTINGS, ...current };
  await chrome.storage.local.set(newSettings);
  await refreshUnreadBadge();
  console.log('[TL;DW] Extension initialized.');
});

// The service worker is torn down when idle, so the badge is restored from
// storage every time it spins back up.
chrome.runtime.onStartup.addListener(() => {
  refreshUnreadBadge();
});
refreshUnreadBadge();

function updateUnreadBadge(queue) {
  const unread = countUnreadQueueItems(queue);
  try {
    chrome.action.setBadgeText({ text: unread ? String(unread) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0055' });
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  } catch (_) {}
}

async function refreshUnreadBadge() {
  try {
    updateUnreadBadge(await getStoredSummaryQueue());
  } catch (_) {}
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CHECK_CACHE') {
    handleCheckCache(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ cached: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'GET_SUMMARY') {
    handleGetSummary(request, createSummaryProgressReporter(request, sender))
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'QUEUE_SUMMARY') {
    handleQueueSummary(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'GET_SUMMARY_QUEUE') {
    handleGetSummaryQueue()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'RETRY_SUMMARY_QUEUE_ITEM') {
    handleRetrySummaryQueueItem(request.id)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'REMOVE_SUMMARY_QUEUE_ITEM') {
    handleRemoveSummaryQueueItem(request.id)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'MARK_SUMMARY_QUEUE_READ') {
    handleMarkSummaryQueueRead(request.all ? 'all' : request.id)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'CLEAR_DONE_SUMMARY_QUEUE_ITEMS') {
    handleClearDoneSummaryQueueItems()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'GET_TIME_SAVED') {
    handleGetTimeSaved()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'RESET_TIME_SAVED') {
    handleResetTimeSaved()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'GET_SETTINGS') {
    chrome.storage.local.get(DEFAULT_SETTINGS).then(settings => sendResponse({ success: true, settings }));
    return true;
  }

  if (request.action === 'SAVE_SETTINGS') {
    chrome.storage.local.set(request.settings).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'CLEAR_CACHE') {
    clearSummaryCache().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'SAVE_TO_OBSIDIAN') {
    handleSaveToObsidian(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'OPEN_OBSIDIAN_URI') {
    openObsidianUri(request.uri)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'TEST_OBSIDIAN_VAULT') {
    handleTestObsidianVault(request.vault)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }
});

async function handleTestObsidianVault(vault) {
  // Return the URI only — callers must launch it from a page with a user gesture.
  // Service-worker chrome.tabs.create(obsidian://...) is often swallowed by Chrome.
  return {
    success: true,
    uri: buildObsidianOpenVaultUri(vault),
    message: 'Open this vault URI from the settings page click handler.'
  };
}

async function handleSaveToObsidian(request) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.obsidianEnabled) {
    throw new Error('Obsidian export is disabled. Enable it in TL;DW settings.');
  }

  const vault = String(settings.obsidianVault || '').trim();
  if (!vault) {
    throw new Error('Set your Obsidian vault name in TL;DW settings.');
  }

  const summary = String(request.summary || '').trim();
  if (!summary) {
    throw new Error('No summary available to save.');
  }

  const highlight = String(request.highlight || '').trim();
  if (request.mode === 'highlight' && !highlight) {
    throw new Error('Select text in the summary to save a highlight.');
  }

  const planned = planObsidianExport({
    vault,
    videoTitle: request.videoTitle,
    videoId: request.videoId,
    videoUrl: request.videoUrl,
    summary,
    videoType: request.videoType || '',
    highlight
  });

  return {
    success: true,
    useClipboard: planned.useClipboard,
    markdown: planned.markdown,
    uri: planned.uri,
    filePath: planned.filePath
  };
}

async function openObsidianUri(uri) {
  const target = String(uri || '').trim();
  if (!target.startsWith('obsidian://')) {
    throw new Error('Invalid Obsidian URI.');
  }

  // Create a background tab for the protocol handoff. Do not navigate the
  // active YouTube tab, and do not auto-close immediately (that aborted launch).
  const tab = await chrome.tabs.create({ url: target, active: false });
  if (tab?.id !== undefined) {
    setTimeout(() => {
      chrome.tabs.remove(tab.id).catch(() => {});
    }, 5000);
  }
}

async function getTimeSavedLedger() {
  const data = await chrome.storage.local.get(TIME_SAVED_KEY);
  return normalizeTimeSavedLedger(data[TIME_SAVED_KEY]);
}

async function handleGetTimeSaved() {
  return { success: true, stats: getTimeSavedStats(await getTimeSavedLedger()) };
}

async function handleResetTimeSaved() {
  const nextWrite = timeSavedWriteLock.then(async () => {
    await chrome.storage.local.remove(TIME_SAVED_KEY);
  });

  timeSavedWriteLock = nextWrite.catch(() => {});
  await nextWrite;
  return await handleGetTimeSaved();
}

/**
 * Credits one video's length to the lifetime ledger. Callers never await this:
 * the number is a running tally, not part of the summary a reader is waiting on.
 */
async function creditTimeSaved({ videoId, videoDurationSeconds, summary, queueItemId = '' }) {
  const duration = await resolveVideoDurationSeconds(videoId, videoDurationSeconds);
  if (!duration) return 0;

  if (queueItemId) {
    await updateSummaryQueueItem(
      { id: queueItemId, durationSeconds: duration },
      { insertIfMissing: false }
    );
  }

  const nextWrite = timeSavedWriteLock.then(async () => {
    const ledger = await getTimeSavedLedger();
    const { ledger: nextLedger, recorded } = recordTimeSaved(ledger, {
      videoId,
      durationSeconds: duration,
      summary
    });
    if (recorded) await chrome.storage.local.set({ [TIME_SAVED_KEY]: nextLedger });
  });

  timeSavedWriteLock = nextWrite.catch(() => {});
  await nextWrite;
  return duration;
}

/**
 * Prefers whatever the page already knew (thumbnail badge or player), because
 * the fallback costs a full watch-page fetch.
 */
async function resolveVideoDurationSeconds(videoId, hint) {
  const fromHint = parseDurationSeconds(hint);
  const cacheKey = `vdur_${videoId}`;

  if (fromHint) {
    await chrome.storage.local.set({ [cacheKey]: fromHint });
    return fromHint;
  }

  if (!videoId) return 0;

  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  const scraped = await fetchYouTubeVideoDuration(videoId).catch(() => 0);
  if (scraped) await chrome.storage.local.set({ [cacheKey]: scraped });
  return scraped;
}

async function fetchYouTubeVideoDuration(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  const html = await response.text();
  const match = html.match(/"lengthSeconds":"(\d+)"/) || html.match(/"approxDurationMs":"(\d+)"/);
  if (!match) return 0;

  const value = Number(match[1]);
  return match[0].startsWith('"approxDurationMs"') ? Math.round(value / 1000) : value;
}

async function getStoredSummaryQueue() {
  const data = await chrome.storage.local.get(SUMMARY_QUEUE_KEY);
  return Array.isArray(data[SUMMARY_QUEUE_KEY]) ? data[SUMMARY_QUEUE_KEY] : [];
}

async function saveSummaryQueue(queue) {
  await chrome.storage.local.set({ [SUMMARY_QUEUE_KEY]: queue });
  updateUnreadBadge(queue);
  return queue;
}

async function markSummaryQueueRead(ids) {
  const nextWrite = summaryQueueWriteLock.then(async () => {
    const queue = await getStoredSummaryQueue();
    const nextQueue = markQueueItemsRead(queue, ids);
    if (countUnreadQueueItems(nextQueue) === countUnreadQueueItems(queue)) {
      return queue;
    }
    await saveSummaryQueue(nextQueue);
    return nextQueue;
  });

  summaryQueueWriteLock = nextWrite.catch(() => {});
  return await nextWrite;
}

async function handleMarkSummaryQueueRead(ids) {
  const queue = await markSummaryQueueRead(ids);
  return {
    success: true,
    queue,
    stats: getQueueStats(queue)
  };
}

async function updateSummaryQueueItem(patch, { insertIfMissing = true } = {}) {
  const nextWrite = summaryQueueWriteLock.then(async () => {
    const queue = await getStoredSummaryQueue();
    const itemExists = queue.some(item => item.id === patch.id);

    if (!insertIfMissing && !itemExists) {
      return queue;
    }

    const nextQueue = mergeQueueItem(queue, {
      ...patch,
      updatedAt: patch.updatedAt || Date.now()
    });
    await saveSummaryQueue(nextQueue);
    return nextQueue;
  });

  summaryQueueWriteLock = nextWrite.catch(() => {});
  return await nextWrite;
}

async function removeSummaryQueueItem(id) {
  const nextWrite = summaryQueueWriteLock.then(async () => {
    const queue = await getStoredSummaryQueue();
    const nextQueue = queue.filter(item => item.id !== id);
    await saveSummaryQueue(nextQueue);
    return nextQueue;
  });

  summaryQueueWriteLock = nextWrite.catch(() => {});
  return await nextWrite;
}

async function clearDoneSummaryQueueItems() {
  const nextWrite = summaryQueueWriteLock.then(async () => {
    const queue = await getStoredSummaryQueue();
    const nextQueue = queue.filter(item => item.status !== 'done');
    await saveSummaryQueue(nextQueue);
    return nextQueue;
  });

  summaryQueueWriteLock = nextWrite.catch(() => {});
  return await nextWrite;
}

async function handleClearDoneSummaryQueueItems() {
  const queue = await clearDoneSummaryQueueItems();
  return {
    success: true,
    queue,
    stats: getQueueStats(queue)
  };
}

async function handleGetSummaryQueue() {
  const queue = await getStoredSummaryQueue();
  return {
    success: true,
    queue,
    stats: getQueueStats(queue)
  };
}

async function handleQueueSummary({
  videoId,
  videoUrl,
  videoTitle,
  language,
  summaryLevel,
  summaryFormat,
  videoDurationSeconds,
  forceRefresh = false
}) {
  if (!videoId) {
    throw new Error('Missing YouTube video ID.');
  }

  const now = Date.now();
  const queueItem = buildQueueItem({
    id: `queue-${now}-${Math.random().toString(36).slice(2)}`,
    videoId,
    videoUrl: videoUrl || `https://www.youtube.com/watch?v=${videoId}`,
    videoTitle,
    language,
    summaryLevel,
    summaryFormat,
    durationSeconds: parseDurationSeconds(videoDurationSeconds),
    now
  });

  const queue = await updateSummaryQueueItem(queueItem);
  processSummaryQueueItem(queueItem, forceRefresh).catch(err => {
    console.warn('[TL;DW] Queued summary failed:', err);
  });

  return {
    success: true,
    item: queueItem,
    queue,
    stats: getQueueStats(queue)
  };
}

async function handleRetrySummaryQueueItem(id) {
  const queue = await getStoredSummaryQueue();
  const existing = queue.find(item => item.id === id);

  if (!existing) {
    throw new Error('Queue item not found.');
  }

  await updateSummaryQueueItem({
    ...existing,
    status: 'queued',
    progress: 'Queued',
    error: '',
    summary: existing.summary || '',
    transcript: existing.transcript || '',
    readAt: 0
  });

  processSummaryQueueItem(existing, true).catch(err => {
    console.warn('[TL;DW] Queued summary retry failed:', err);
  });

  return await handleGetSummaryQueue();
}

async function handleRemoveSummaryQueueItem(id) {
  if (!id) {
    throw new Error('Missing queue item ID.');
  }

  const queue = await removeSummaryQueueItem(id);
  return {
    success: true,
    queue,
    stats: getQueueStats(queue)
  };
}

async function processSummaryQueueItem(item, forceRefresh = false) {
  try {
    await updateSummaryQueueItem({
      id: item.id,
      status: 'running',
      progress: getSummaryProgressMessage('checkingCache')
    }, { insertIfMissing: false });

    const response = await handleGetSummary({
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      videoTitle: item.videoTitle,
      language: item.language,
      summaryLevel: item.summaryLevel,
      summaryFormat: item.summaryFormat,
      videoDurationSeconds: item.durationSeconds,
      queueItemId: item.id,
      forceRefresh
    }, async (step) => {
      await updateSummaryQueueItem({
        id: item.id,
        status: 'running',
        progress: getSummaryProgressMessage(step)
      }, { insertIfMissing: false });
    });

    await updateSummaryQueueItem({
      id: item.id,
      status: 'done',
      progress: response.cached ? 'Loaded from cache' : 'Summary ready',
      summary: response.summary,
      transcript: response.transcript,
      answer: response.answer || null,
      cached: !!response.cached,
      error: '',
      readAt: 0
    }, { insertIfMissing: false });
  } catch (err) {
    await updateSummaryQueueItem({
      id: item.id,
      status: 'error',
      progress: 'Failed',
      error: err.message || String(err)
    }, { insertIfMissing: false });
    throw err;
  }
}

/**
 * Fast Cache Checker - Returns immediately without making network calls
 */
async function handleCheckCache({ videoId, language, summaryLevel, summaryFormat }) {
  if (!videoId) return { cached: false };

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const targetLang = language || settings.summaryLanguage || 'en';
  const level = summaryLevel || settings.summaryLevel || 3;
  const format = summaryFormat || settings.summaryFormat || 'paragraph';

  const cacheKey = buildSummaryCacheKey({
    videoId,
    language: targetLang,
    level,
    format,
    provider: settings.aiProvider
  });

  const cached = await chrome.storage.local.get(cacheKey);
  if (cached && cached[cacheKey]) {
    const classKey = buildClassificationCacheKey(videoId);
    const classCache = await chrome.storage.local.get(classKey);

    return {
      cached: true,
      summary: cached[cacheKey].summary,
      transcript: cached[cacheKey].transcript,
      answer: buildSummaryAnswer(cached[cacheKey].summary, classCache?.[classKey]),
      videoId
    };
  }

  return { cached: false, videoId };
}

/**
 * Handle fetching transcription from Clipscript/YouTube and summarizing it
 */
async function handleGetSummary({ videoId, videoUrl, videoTitle, forceRefresh, language: requestedLang, summaryLevel: requestedLevel, summaryFormat: requestedFormat, videoDurationSeconds, queueItemId }, onProgress = () => {}) {
  if (!videoId) {
    throw new Error('Missing YouTube video ID.');
  }

  onProgress('checkingCache');

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const clipscriptApiKey = settings.clipscriptApiKey || DEFAULT_SETTINGS.clipscriptApiKey;

  const targetLang = requestedLang || settings.summaryLanguage || 'en';
  const targetLevel = requestedLevel || settings.summaryLevel || 3;
  const targetFormat = requestedFormat || settings.summaryFormat || 'paragraph';

  const cacheKey = buildSummaryCacheKey({
    videoId,
    language: targetLang,
    level: targetLevel,
    format: targetFormat,
    provider: settings.aiProvider
  });

  // Check cache unless forceRefresh is explicitly requested
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached && cached[cacheKey]) {
      const classKey = buildClassificationCacheKey(videoId);
      const classCache = await chrome.storage.local.get(classKey);

      creditTimeSaved({
        videoId,
        videoDurationSeconds,
        summary: cached[cacheKey].summary,
        queueItemId
      }).catch(() => {});

      return {
        success: true,
        summary: cached[cacheKey].summary,
        transcript: cached[cacheKey].transcript,
        answer: buildSummaryAnswer(cached[cacheKey].summary, classCache?.[classKey]),
        cached: true,
        videoId
      };
    }
  }

  // Kicked off before the transcript so the vision call overlaps Clipscript's
  // polling. Nothing awaits it until summarization.
  const classificationPromise = getVideoClassification({ videoId, videoTitle, settings })
    .catch(() => heuristicClassification(videoTitle));

  const fullVideoUrl = videoUrl || `https://www.youtube.com/watch?v=${videoId}`;
  let transcriptText = '';

  // Step 1: Request transcription from Clipscript API in original language
  console.log(`[TL;DW] Fetching transcript from Clipscript for video: ${videoId}`);
  onProgress('retrievingTranscript');
  try {
    const transcriptData = await fetchClipscriptTranscription(fullVideoUrl, clipscriptApiKey, onProgress);
    transcriptText = transcriptData.transcript;
  } catch (clipErr) {
    console.warn(`[TL;DW] Clipscript transcription failed (${clipErr.message}), attempting fallback to YouTube native captions...`);
    onProgress('usingNativeCaptions');
    
    // Fallback: Attempt fetching YouTube native captions directly
    try {
      transcriptText = await fetchYouTubeNativeTranscript(videoId);
    } catch (fallbackErr) {
      throw new Error(`Clipscript Error: ${clipErr.message}. Fallback Error: ${fallbackErr.message}`);
    }
  }

  if (!transcriptText || transcriptText.trim().length === 0) {
    throw new Error('Transcript is empty or unavailable for this video.');
  }

  // Step 2: Generate summary using AI provider
  const classification = await classificationPromise;
  console.log(`[TL;DW] Generating summary using provider: ${settings.aiProvider}, prompt: ${ACTIVE_SUMMARY_PROMPT_VARIANT}, type: ${classification.type} (${classification.source})`);
  onProgress('summarizing');
  const summary = await generateSummary(transcriptText, {
    provider: settings.aiProvider,
    apiKey: settings.aiApiKey,
    language: targetLang,
    videoTitle,
    summaryLevel: targetLevel,
    summaryFormat: targetFormat,
    classification
  });

  // Step 3: Cache result
  const cacheData = {
    summary,
    transcript: transcriptText,
    timestamp: Date.now()
  };
  onProgress('savingSummary');
  await chrome.storage.local.set({ [cacheKey]: cacheData });

  creditTimeSaved({ videoId, videoDurationSeconds, summary, queueItemId }).catch(() => {});

  return {
    success: true,
    summary,
    transcript: transcriptText,
    answer: buildSummaryAnswer(summary, classification),
    cached: false,
    videoId
  };
}

/**
 * Call Clipscript API to get YouTube video transcription in original video language
 */
async function fetchClipscriptTranscription(videoUrl, apiKey, onProgress = () => {}) {
  if (!apiKey) {
    throw new Error('Clipscript API Key is missing. Please configure it in extension options.');
  }

  // 1. Initial POST request
  const createResp = await fetch('https://clipscript.uk/api/v1/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: videoUrl,
      timestamps: false
    })
  });

  if (!createResp.ok) {
    let errMessage = `Clipscript API status ${createResp.status}`;
    try {
      const errJson = await createResp.json();
      if (errJson.message) errMessage = errJson.message;
      else if (errJson.error) errMessage = errJson.error;
    } catch (_) {}
    throw new Error(errMessage);
  }

  const initialData = await createResp.json();

  // If cached on Clipscript server (HTTP 200 with complete)
  if (initialData.status === 'complete' && initialData.transcript) {
    return initialData;
  }

  if (!initialData.id) {
    throw new Error('Clipscript did not return a valid job ID.');
  }

  // 2. Poll until complete or failed (max 30 attempts x 1.5s = 45 seconds)
  const jobId = initialData.id;
  const maxAttempts = 30;
  const pollIntervalMs = 1500;
  onProgress('waitingForTranscript');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    const pollResp = await fetch(`https://clipscript.uk/api/v1/transcriptions/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!pollResp.ok) {
      throw new Error(`Clipscript polling error (${pollResp.status}).`);
    }

    const pollData = await pollResp.json();

    if (pollData.status === 'complete') {
      if (!pollData.transcript) {
        throw new Error('Clipscript job complete but no transcript text returned.');
      }
      return pollData;
    }

    if (pollData.status === 'failed') {
      throw new Error(pollData.error || 'Clipscript transcription failed for this video.');
    }
  }

  throw new Error('Clipscript transcription timed out.');
}

/**
 * Fallback: Fetch native YouTube captions directly from page timedtext tracks
 */
async function fetchYouTubeNativeTranscript(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(watchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  const html = await response.text();

  const match = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
  if (!match) {
    throw new Error('No native captions found on YouTube.');
  }

  const rawJson = match[1].replace(/\\u0026/g, '&');
  const captionTracks = JSON.parse(rawJson);

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks found.');
  }

  const track = captionTracks.find(t => t.languageCode === 'ar') ||
                captionTracks.find(t => t.languageCode === 'en') ||
                captionTracks[0];

  const trackUrl = track.baseUrl.replace(/\\u0026/g, '&');
  const trackResp = await fetch(trackUrl);
  const trackText = await trackResp.text();

  if (!trackText || trackText.trim().length === 0) {
    throw new Error('Empty caption file.');
  }

  // Strip XML tags
  const text = trackText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Helper to clear all summary caches
 */
async function clearSummaryCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k =>
    k.startsWith('summary_') || k.startsWith('vclass_') || k.startsWith('vdur_')
  );
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}
