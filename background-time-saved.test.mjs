import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVE_SUMMARY_PROMPT_VARIANT } from './summary-prompts.js';
import { SUMMARY_QUEUE_KEY, buildQueueItem } from './summary-queue.js';
import { TIME_SAVED_KEY } from './time-saved.js';

// Drives the real service worker through its message API so the wiring between
// a summary, the video length, and the lifetime ledger is covered — not just
// the pure helpers in time-saved.js.
const store = new Map();
let onMessage = null;

function storageGet(query) {
  if (query === null || query === undefined) return Object.fromEntries(store);

  if (typeof query === 'string') {
    return store.has(query) ? { [query]: store.get(query) } : {};
  }

  if (Array.isArray(query)) {
    return Object.fromEntries(query.filter(key => store.has(key)).map(key => [key, store.get(key)]));
  }

  return Object.fromEntries(
    Object.entries(query).map(([key, fallback]) => [key, store.has(key) ? store.get(key) : fallback])
  );
}

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { onMessage = fn; } },
    sendMessage: async () => {}
  },
  storage: {
    local: {
      async get(query) { return storageGet(query); },
      async set(values) { Object.entries(values).forEach(([key, value]) => store.set(key, value)); },
      async remove(keys) { [].concat(keys).forEach(key => store.delete(key)); }
    }
  },
  action: {
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setBadgeTextColor() {}
  },
  tabs: {
    async create() { return {}; },
    async remove() {},
    async sendMessage() {}
  }
};

await import('./background.js');

function send(request) {
  return new Promise((resolve, reject) => {
    const handled = onMessage(request, {}, resolve);
    if (!handled) reject(new Error(`No handler for ${request.action}`));
  });
}

function seedCachedSummary({ videoId, summary }) {
  const key = `summary_${videoId}_en_L3_Fparagraph_gemini_P${ACTIVE_SUMMARY_PROMPT_VARIANT}`;
  store.set(key, { summary, transcript: 'transcript', timestamp: Date.now() });
}

// The ledger is written after the response is sent, on purpose: the reader
// never waits on it.
async function timeSavedStats() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await send({ action: 'GET_TIME_SAVED' });
    if (res.stats.videos > 0) return res.stats;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return (await send({ action: 'GET_TIME_SAVED' })).stats;
}

test('a summary credits the video length once, net of reading time', async () => {
  store.clear();
  seedCachedSummary({ videoId: 'vid1', summary: Array(115).fill('word').join(' ') });

  const first = await send({
    action: 'GET_SUMMARY',
    videoId: 'vid1',
    videoTitle: 'Test',
    videoDurationSeconds: '10:00'
  });
  assert.equal(first.success, true);

  const stats = await timeSavedStats();
  assert.equal(stats.videos, 1);
  assert.equal(stats.watchSeconds, 600);
  assert.equal(stats.readSeconds, 30);
  assert.equal(stats.savedSeconds, 570);

  // Same video at another detail level must not be counted twice.
  seedCachedSummary({ videoId: 'vid1', summary: 'shorter summary' });
  await send({
    action: 'GET_SUMMARY',
    videoId: 'vid1',
    videoTitle: 'Test',
    videoDurationSeconds: 600
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  const after = (await send({ action: 'GET_TIME_SAVED' })).stats;
  assert.deepEqual({ videos: after.videos, watchSeconds: after.watchSeconds }, { videos: 1, watchSeconds: 600 });
});

test('a queued summary stores the length on its row for the timeline badge', async () => {
  store.clear();
  seedCachedSummary({ videoId: 'vid2', summary: 'a summary' });

  // The row was queued from a card with no length badge, so the length only
  // arrives with the summary run.
  const item = buildQueueItem({ id: 'q1', videoId: 'vid2' });
  store.set(SUMMARY_QUEUE_KEY, [item]);
  assert.equal(item.durationSeconds, 0);

  await send({
    action: 'GET_SUMMARY',
    videoId: 'vid2',
    videoDurationSeconds: '12:34',
    queueItemId: 'q1'
  });
  await timeSavedStats();

  const [row] = store.get(SUMMARY_QUEUE_KEY);
  assert.equal(row.durationSeconds, 754);
  assert.equal(store.get('vdur_vid2'), 754);
});

test('the ledger survives a cache clear', async () => {
  store.clear();
  seedCachedSummary({ videoId: 'vid3', summary: 'a summary' });

  await send({ action: 'GET_SUMMARY', videoId: 'vid3', videoDurationSeconds: 300 });
  await timeSavedStats();

  await send({ action: 'CLEAR_CACHE' });

  const stats = (await send({ action: 'GET_TIME_SAVED' })).stats;
  assert.equal(stats.videos, 1);
  assert.equal(stats.watchSeconds, 300);
  assert.equal(store.has(TIME_SAVED_KEY), true);
});

test('resetting clears the lifetime tally', async () => {
  store.clear();
  seedCachedSummary({ videoId: 'vid4', summary: 'a summary' });

  await send({ action: 'GET_SUMMARY', videoId: 'vid4', videoDurationSeconds: 300 });
  await timeSavedStats();

  const reset = await send({ action: 'RESET_TIME_SAVED' });
  assert.equal(reset.stats.videos, 0);
  assert.equal(reset.stats.savedSeconds, 0);
});
