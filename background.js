import { generateSummary } from './summarizer.js';
import { ACTIVE_SUMMARY_PROMPT_VARIANT } from './summary-prompts.js';
import { getSummaryProgressMessage } from './summary-progress.js';
import {
  SUMMARY_QUEUE_KEY,
  buildQueueItem,
  getQueueStats,
  mergeQueueItem
} from './summary-queue.js';

// Default configuration settings
const DEFAULT_SETTINGS = {
  clipscriptApiKey: '',
  aiProvider: 'gemini', // 'gemini', 'openai', 'groq', 'anthropic', 'openrouter'
  aiApiKey: '',
  summaryLanguage: 'en', // 'en', 'ar', 'auto'
  summaryLevel: 3, // Level 1 (Ultra Short) to 5 (Deep Dive)
  summaryFormat: 'paragraph', // 'paragraph', 'bullets', 'key_takeaways'
  autoSummarizeWatch: false,
  showFeedButtons: true
};

let summaryQueueWriteLock = Promise.resolve();

function buildSummaryCacheKey({ videoId, language, level, format, provider }) {
  return `summary_${videoId}_${language}_L${level}_F${format}_${provider}_P${ACTIVE_SUMMARY_PROMPT_VARIANT}`;
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
  console.log('[TL;DW] Extension initialized.');
});

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
});

async function getStoredSummaryQueue() {
  const data = await chrome.storage.local.get(SUMMARY_QUEUE_KEY);
  return Array.isArray(data[SUMMARY_QUEUE_KEY]) ? data[SUMMARY_QUEUE_KEY] : [];
}

async function saveSummaryQueue(queue) {
  await chrome.storage.local.set({ [SUMMARY_QUEUE_KEY]: queue });
  return queue;
}

async function updateSummaryQueueItem(patch) {
  const nextWrite = summaryQueueWriteLock.then(async () => {
    const queue = await getStoredSummaryQueue();
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
    transcript: existing.transcript || ''
  });

  processSummaryQueueItem(existing, true).catch(err => {
    console.warn('[TL;DW] Queued summary retry failed:', err);
  });

  return await handleGetSummaryQueue();
}

async function processSummaryQueueItem(item, forceRefresh = false) {
  try {
    await updateSummaryQueueItem({
      id: item.id,
      status: 'running',
      progress: getSummaryProgressMessage('checkingCache')
    });

    const response = await handleGetSummary({
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      videoTitle: item.videoTitle,
      language: item.language,
      summaryLevel: item.summaryLevel,
      summaryFormat: item.summaryFormat,
      forceRefresh
    }, async (step) => {
      await updateSummaryQueueItem({
        id: item.id,
        status: 'running',
        progress: getSummaryProgressMessage(step)
      });
    });

    await updateSummaryQueueItem({
      id: item.id,
      status: 'done',
      progress: response.cached ? 'Loaded from cache' : 'Summary ready',
      summary: response.summary,
      transcript: response.transcript,
      cached: !!response.cached,
      error: ''
    });
  } catch (err) {
    await updateSummaryQueueItem({
      id: item.id,
      status: 'error',
      progress: 'Failed',
      error: err.message || String(err)
    });
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
    return {
      cached: true,
      summary: cached[cacheKey].summary,
      transcript: cached[cacheKey].transcript,
      videoId
    };
  }

  return { cached: false, videoId };
}

/**
 * Handle fetching transcription from Clipscript/YouTube and summarizing it
 */
async function handleGetSummary({ videoId, videoUrl, videoTitle, forceRefresh, language: requestedLang, summaryLevel: requestedLevel, summaryFormat: requestedFormat }, onProgress = () => {}) {
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
      return {
        success: true,
        summary: cached[cacheKey].summary,
        transcript: cached[cacheKey].transcript,
        cached: true,
        videoId
      };
    }
  }

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
  console.log(`[TL;DW] Generating summary using provider: ${settings.aiProvider}, prompt: ${ACTIVE_SUMMARY_PROMPT_VARIANT}`);
  onProgress('summarizing');
  const summary = await generateSummary(transcriptText, {
    provider: settings.aiProvider,
    apiKey: settings.aiApiKey,
    language: targetLang,
    videoTitle,
    summaryLevel: targetLevel,
    summaryFormat: targetFormat
  });

  // Step 3: Cache result
  const cacheData = {
    summary,
    transcript: transcriptText,
    timestamp: Date.now()
  };
  onProgress('savingSummary');
  await chrome.storage.local.set({ [cacheKey]: cacheData });

  return {
    success: true,
    summary,
    transcript: transcriptText,
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
  const cacheKeys = Object.keys(all).filter(k => k.startsWith('summary_'));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}
