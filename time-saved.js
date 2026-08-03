export const TIME_SAVED_KEY = 'tldw_time_saved';
export const TIME_SAVED_VERSION = 1;

// Average adult silent reading speed for non-fiction prose. Summaries are read,
// not watched, so their reading time is subtracted from the video length.
export const READING_WPM = 230;

// Bounds the per-video dedupe window. Totals live outside the map, so trimming
// old entries never changes the reported numbers — it only means a video
// summarized 500+ summaries ago could count twice if summarized again.
export const TIME_SAVED_VIDEO_LIMIT = 500;

// Anything longer is almost certainly a parse error or a 24/7 livestream, and
// letting it through would make the headline number meaningless.
export const MAX_CREDITED_VIDEO_SECONDS = 6 * 60 * 60;

export function createTimeSavedLedger() {
  return {
    version: TIME_SAVED_VERSION,
    watchSeconds: 0,
    readSeconds: 0,
    count: 0,
    firstAt: 0,
    videos: {}
  };
}

export function normalizeTimeSavedLedger(raw) {
  const base = createTimeSavedLedger();
  if (!raw || typeof raw !== 'object') return base;

  const videos = {};
  if (raw.videos && typeof raw.videos === 'object') {
    for (const [videoId, at] of Object.entries(raw.videos)) {
      const ts = Number(at);
      if (videoId && Number.isFinite(ts)) videos[videoId] = ts;
    }
  }

  return {
    ...base,
    watchSeconds: toNonNegativeInt(raw.watchSeconds),
    readSeconds: toNonNegativeInt(raw.readSeconds),
    count: toNonNegativeInt(raw.count),
    firstAt: toNonNegativeInt(raw.firstAt),
    videos
  };
}

/**
 * Accepts whatever the page gave us: a number of seconds, a clock label
 * ("12:34", "1:02:03"), or YouTube's spoken aria-label ("12 minutes, 34 seconds").
 * Returns 0 when nothing usable is there, which callers treat as "unknown".
 */
export function parseDurationSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  const text = String(value || '').trim();
  if (!text) return 0;

  const clock = text.match(/(?:^|\s)(\d{1,3}(?::[0-5]?\d){1,2})(?:\s|$)/);
  if (clock) {
    return clock[1]
      .split(':')
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0);
  }

  const spoken = /(\d+)\s*(hour|minute|second)/gi;
  let seconds = 0;
  let match;
  while ((match = spoken.exec(text)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    seconds += amount * (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1);
  }

  return seconds;
}

export function estimateReadingSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(1, Math.round((words / READING_WPM) * 60));
}

/**
 * Credits one video, once. A video with an unknown length is deliberately not
 * recorded at all, so a later summary of the same video can still count it.
 */
export function recordTimeSaved(ledger, {
  videoId,
  durationSeconds,
  summary = '',
  readSeconds,
  now = Date.now()
} = {}) {
  const current = normalizeTimeSavedLedger(ledger);
  const id = String(videoId || '').trim();
  const duration = parseDurationSeconds(durationSeconds);

  if (!id || !duration || duration > MAX_CREDITED_VIDEO_SECONDS) {
    return { ledger: current, recorded: false };
  }

  if (Object.prototype.hasOwnProperty.call(current.videos, id)) {
    return { ledger: current, recorded: false };
  }

  const reading = Number.isFinite(readSeconds)
    ? Math.max(0, Math.round(readSeconds))
    : estimateReadingSeconds(summary);

  const next = {
    ...current,
    watchSeconds: current.watchSeconds + duration,
    // Reading a summary is never slower than watching the video it replaced.
    readSeconds: current.readSeconds + Math.min(reading, duration),
    count: current.count + 1,
    firstAt: current.firstAt || now,
    videos: trimVideoWindow({ ...current.videos, [id]: now })
  };

  return { ledger: next, recorded: true };
}

function trimVideoWindow(videos) {
  const entries = Object.entries(videos);
  if (entries.length <= TIME_SAVED_VIDEO_LIMIT) return videos;

  return Object.fromEntries(
    entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, TIME_SAVED_VIDEO_LIMIT)
  );
}

export function getTimeSavedStats(ledger) {
  const current = normalizeTimeSavedLedger(ledger);

  return {
    videos: current.count,
    watchSeconds: current.watchSeconds,
    readSeconds: current.readSeconds,
    savedSeconds: Math.max(0, current.watchSeconds - current.readSeconds),
    firstAt: current.firstAt
  };
}

/** Compact human duration: "3d 4h", "2h 12m", "18m", "40s". */
export function formatTimeSpan(seconds) {
  const total = toNonNegativeInt(seconds);
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Clock label the way YouTube prints it on a thumbnail: "12:34", "1:02:03". */
export function formatClock(seconds) {
  const total = toNonNegativeInt(seconds);
  if (!total) return '';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function toNonNegativeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}
