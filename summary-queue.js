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
    createdAt: now,
    updatedAt: now
  };
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
    error: 0
  });
}
