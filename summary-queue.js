export const SUMMARY_QUEUE_KEY = 'tldw_summary_queue';
export const SUMMARY_QUEUE_LIMIT = 25;

export function buildQueueItem({
  id,
  videoId,
  videoUrl = '',
  videoTitle = 'YouTube video',
  language = 'en',
  summaryLevel = 3,
  summaryFormat = 'paragraph',
  now = Date.now()
}) {
  return {
    id,
    videoId,
    videoUrl,
    videoTitle: String(videoTitle || 'YouTube video').trim() || 'YouTube video',
    language,
    summaryLevel,
    summaryFormat,
    status: 'queued',
    progress: 'Queued',
    summary: '',
    transcript: '',
    error: '',
    cached: false,
    readAt: 0,
    createdAt: now,
    updatedAt: now
  };
}

// A missing `readAt` means the item predates read tracking, so it counts as
// read. Every completion writes `readAt: 0` explicitly, which is what marks a
// summary as new.
export function isQueueItemUnread(item) {
  return !!item && item.status === 'done' && item.readAt === 0;
}

export function countUnreadQueueItems(queue) {
  return (Array.isArray(queue) ? queue : []).filter(isQueueItemUnread).length;
}

// Deliberately preserves order and leaves `updatedAt` alone: reading a summary
// is not activity on the video, and bumping it would reshuffle the timeline.
export function markQueueItemsRead(queue, ids, now = Date.now()) {
  const targets = ids === 'all'
    ? null
    : new Set(Array.isArray(ids) ? ids : [ids]);

  return (Array.isArray(queue) ? queue : []).map(item => {
    if (targets && !targets.has(item.id)) return item;
    if (!isQueueItemUnread(item)) return item;
    return { ...item, readAt: now };
  });
}

export function mergeQueueItem(queue, patch) {
  const existing = Array.isArray(queue) ? queue : [];
  const index = existing.findIndex(item => item.id === patch.id);
  const nextItem = index >= 0
    ? { ...existing[index], ...patch }
    : patch;

  const withoutItem = index >= 0
    ? existing.filter(item => item.id !== patch.id)
    : existing;

  return [nextItem, ...withoutItem]
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, SUMMARY_QUEUE_LIMIT);
}

export function getQueueStats(queue) {
  const items = Array.isArray(queue) ? queue : [];

  return items.reduce((stats, item) => {
    stats.total += 1;

    if (item.status === 'done') {
      stats.done += 1;
      if (isQueueItemUnread(item)) stats.unread += 1;
    } else if (item.status === 'error') {
      stats.error += 1;
    } else {
      stats.pending += 1;
    }

    return stats;
  }, {
    total: 0,
    pending: 0,
    done: 0,
    error: 0,
    unread: 0
  });
}
