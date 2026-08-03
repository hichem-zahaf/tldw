import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CREDITED_VIDEO_SECONDS,
  TIME_SAVED_VIDEO_LIMIT,
  createTimeSavedLedger,
  estimateReadingSeconds,
  formatClock,
  formatTimeSpan,
  getTimeSavedStats,
  normalizeTimeSavedLedger,
  parseDurationSeconds,
  recordTimeSaved
} from './time-saved.js';

test('parseDurationSeconds reads clock labels, spoken labels, and numbers', () => {
  assert.equal(parseDurationSeconds('12:34'), 754);
  assert.equal(parseDurationSeconds('1:02:03'), 3723);
  assert.equal(parseDurationSeconds(' 7:05 '), 425);
  assert.equal(parseDurationSeconds('12 minutes, 34 seconds'), 754);
  assert.equal(parseDurationSeconds('1 hour, 2 minutes, 3 seconds'), 3723);
  assert.equal(parseDurationSeconds(612.4), 612);
  assert.equal(parseDurationSeconds('LIVE'), 0);
  assert.equal(parseDurationSeconds(''), 0);
  assert.equal(parseDurationSeconds(undefined), 0);
});

test('estimateReadingSeconds scales with word count', () => {
  assert.equal(estimateReadingSeconds(''), 0);
  assert.equal(estimateReadingSeconds('   '), 0);
  // 230 words is one minute at the assumed reading speed.
  assert.equal(estimateReadingSeconds(Array(230).fill('word').join(' ')), 60);
  assert.equal(estimateReadingSeconds(Array(460).fill('word').join(' ')), 120);
});

test('recordTimeSaved credits a video once', () => {
  const first = recordTimeSaved(createTimeSavedLedger(), {
    videoId: 'abc',
    durationSeconds: '10:00',
    summary: Array(115).fill('word').join(' '),
    now: 1000
  });

  assert.equal(first.recorded, true);
  assert.equal(first.ledger.count, 1);
  assert.equal(first.ledger.watchSeconds, 600);
  assert.equal(first.ledger.readSeconds, 30);
  assert.equal(first.ledger.firstAt, 1000);

  const again = recordTimeSaved(first.ledger, {
    videoId: 'abc',
    durationSeconds: '10:00',
    summary: 'different summary at a different level',
    now: 2000
  });

  assert.equal(again.recorded, false);
  assert.deepEqual(again.ledger, first.ledger);
});

test('recordTimeSaved skips unknown or implausible durations so a later pass can count them', () => {
  const ledger = createTimeSavedLedger();

  const unknown = recordTimeSaved(ledger, { videoId: 'abc', durationSeconds: 0, summary: 'hi' });
  assert.equal(unknown.recorded, false);
  assert.deepEqual(unknown.ledger.videos, {});

  const marathon = recordTimeSaved(ledger, {
    videoId: 'stream',
    durationSeconds: MAX_CREDITED_VIDEO_SECONDS + 1
  });
  assert.equal(marathon.recorded, false);

  const later = recordTimeSaved(unknown.ledger, { videoId: 'abc', durationSeconds: 300, summary: 'hi' });
  assert.equal(later.recorded, true);
  assert.equal(later.ledger.watchSeconds, 300);
});

test('recordTimeSaved never claims reading took longer than watching', () => {
  const { ledger } = recordTimeSaved(createTimeSavedLedger(), {
    videoId: 'short',
    durationSeconds: 30,
    summary: Array(2000).fill('word').join(' ')
  });

  assert.equal(ledger.readSeconds, 30);
  assert.equal(getTimeSavedStats(ledger).savedSeconds, 0);
});

test('recordTimeSaved trims the dedupe window without disturbing totals', () => {
  let ledger = createTimeSavedLedger();

  for (let i = 0; i < TIME_SAVED_VIDEO_LIMIT + 25; i++) {
    ledger = recordTimeSaved(ledger, {
      videoId: `video-${i}`,
      durationSeconds: 60,
      summary: '',
      now: 1000 + i
    }).ledger;
  }

  assert.equal(Object.keys(ledger.videos).length, TIME_SAVED_VIDEO_LIMIT);
  assert.equal(ledger.count, TIME_SAVED_VIDEO_LIMIT + 25);
  assert.equal(ledger.watchSeconds, (TIME_SAVED_VIDEO_LIMIT + 25) * 60);
  assert.equal(Object.prototype.hasOwnProperty.call(ledger.videos, 'video-0'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(ledger.videos, `video-${TIME_SAVED_VIDEO_LIMIT + 24}`),
    true
  );
});

test('normalizeTimeSavedLedger repairs junk written by older or corrupt state', () => {
  assert.deepEqual(normalizeTimeSavedLedger(null), createTimeSavedLedger());
  assert.deepEqual(normalizeTimeSavedLedger({ watchSeconds: -5, videos: 'nope' }), createTimeSavedLedger());

  const repaired = normalizeTimeSavedLedger({
    watchSeconds: '600',
    readSeconds: 30.4,
    count: 1,
    videos: { abc: '1000', '': 5, bad: 'x' }
  });

  assert.equal(repaired.watchSeconds, 600);
  assert.equal(repaired.readSeconds, 30);
  assert.deepEqual(repaired.videos, { abc: 1000 });
});

test('getTimeSavedStats reports the net figure', () => {
  const stats = getTimeSavedStats({ watchSeconds: 3600, readSeconds: 400, count: 6, firstAt: 12 });

  assert.deepEqual(stats, {
    videos: 6,
    watchSeconds: 3600,
    readSeconds: 400,
    savedSeconds: 3200,
    firstAt: 12
  });
});

test('formatTimeSpan and formatClock print compact labels', () => {
  assert.equal(formatTimeSpan(0), '0s');
  assert.equal(formatTimeSpan(45), '45s');
  assert.equal(formatTimeSpan(600), '10m');
  assert.equal(formatTimeSpan(3600), '1h');
  assert.equal(formatTimeSpan(7920), '2h 12m');
  assert.equal(formatTimeSpan(90000), '1d 1h');
  assert.equal(formatTimeSpan(86400), '1d');

  assert.equal(formatClock(0), '');
  assert.equal(formatClock(754), '12:34');
  assert.equal(formatClock(3723), '1:02:03');
  assert.equal(formatClock(65), '1:05');
});
