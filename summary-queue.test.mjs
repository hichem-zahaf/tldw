import assert from 'node:assert/strict';
import {
  SUMMARY_QUEUE_LIMIT,
  buildQueueItem,
  mergeQueueItem,
  getQueueStats,
  isQueueItemUnread,
  countUnreadQueueItems,
  markQueueItemsRead,
  didQueueItemFinish
} from './summary-queue.js';

const baseJob = buildQueueItem({
  id: 'job-a',
  videoId: 'video-a',
  videoUrl: 'https://www.youtube.com/watch?v=video-a',
  videoTitle: 'First video',
  language: 'en',
  summaryLevel: 3,
  summaryFormat: 'paragraph',
  now: 1000
});

assert.deepEqual(
  {
    id: baseJob.id,
    videoId: baseJob.videoId,
    videoTitle: baseJob.videoTitle,
    status: baseJob.status,
    progress: baseJob.progress,
    language: baseJob.language,
    summaryLevel: baseJob.summaryLevel,
    summaryFormat: baseJob.summaryFormat,
    createdAt: baseJob.createdAt,
    updatedAt: baseJob.updatedAt
  },
  {
    id: 'job-a',
    videoId: 'video-a',
    videoTitle: 'First video',
    status: 'queued',
    progress: 'Queued',
    language: 'en',
    summaryLevel: 3,
    summaryFormat: 'paragraph',
    createdAt: 1000,
    updatedAt: 1000
  }
);

{
  const queue = mergeQueueItem([], baseJob);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'job-a');
}

{
  const updated = mergeQueueItem([baseJob], {
    id: 'job-a',
    status: 'done',
    progress: 'Summary ready',
    summary: 'Useful summary',
    updatedAt: 2000
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, 'done');
  assert.equal(updated[0].summary, 'Useful summary');
  assert.equal(updated[0].createdAt, 1000);
  assert.equal(updated[0].updatedAt, 2000);
}

{
  const olderJob = buildQueueItem({
    id: 'job-b',
    videoId: 'video-b',
    videoTitle: 'Older video',
    now: 500
  });
  const queue = mergeQueueItem([olderJob], baseJob);

  assert.deepEqual(queue.map(item => item.id), ['job-a', 'job-b']);
}

{
  let queue = [];
  for (let i = 0; i < SUMMARY_QUEUE_LIMIT + 3; i++) {
    queue = mergeQueueItem(queue, buildQueueItem({
      id: `job-${i}`,
      videoId: `video-${i}`,
      videoTitle: `Video ${i}`,
      now: i
    }));
  }

  assert.equal(queue.length, SUMMARY_QUEUE_LIMIT);
  assert.equal(queue[0].id, `job-${SUMMARY_QUEUE_LIMIT + 2}`);
  assert.equal(queue.at(-1).id, 'job-3');
}

{
  const stats = getQueueStats([
    { id: 'queued', status: 'queued' },
    { id: 'running', status: 'running' },
    { id: 'done', status: 'done', readAt: 0 },
    { id: 'read', status: 'done', readAt: 900 },
    { id: 'error', status: 'error' }
  ]);

  assert.deepEqual(stats, {
    total: 5,
    pending: 2,
    done: 2,
    error: 1,
    unread: 1
  });
}

// Read tracking
{
  assert.equal(buildQueueItem({ id: 'x', videoId: 'v' }).readAt, 0);

  // Only finished summaries can be unread: nothing to read while queued or failed.
  assert.equal(isQueueItemUnread({ status: 'done', readAt: 0 }), true);
  assert.equal(isQueueItemUnread({ status: 'done', readAt: 123 }), false);
  assert.equal(isQueueItemUnread({ status: 'running', readAt: 0 }), false);
  assert.equal(isQueueItemUnread({ status: 'error', readAt: 0 }), false);

  // Items stored before read tracking existed must not all light up as new.
  assert.equal(isQueueItemUnread({ status: 'done', summary: 'legacy' }), false);
  assert.equal(countUnreadQueueItems([
    { id: 'a', status: 'done', readAt: 0 },
    { id: 'b', status: 'done' },
    { id: 'c', status: 'done', readAt: 0 }
  ]), 2);
}

{
  const queue = [
    { id: 'a', status: 'done', readAt: 0, updatedAt: 300 },
    { id: 'b', status: 'done', readAt: 0, updatedAt: 200 },
    { id: 'c', status: 'running', readAt: 0, updatedAt: 100 }
  ];

  const afterOne = markQueueItemsRead(queue, 'b', 5000);
  assert.deepEqual(afterOne.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(afterOne[0].readAt, 0);
  assert.equal(afterOne[1].readAt, 5000);
  // Reading is not activity on the video, so ordering must not shift.
  assert.equal(afterOne[1].updatedAt, 200);

  const afterAll = markQueueItemsRead(queue, 'all', 6000);
  assert.deepEqual(afterAll.map(item => item.readAt), [6000, 6000, 0]);
  assert.equal(countUnreadQueueItems(afterAll), 0);

  // Original queue untouched.
  assert.equal(queue[0].readAt, 0);
}

{
  const prev = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'queued' }
  ];
  const nextDone = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'queued' }
  ];
  const nextError = [
    { id: 'a', status: 'error' },
    { id: 'b', status: 'queued' }
  ];
  const stillRunning = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'running' }
  ];
  const markReadOnly = [
    { id: 'a', status: 'done', readAt: 1 },
    { id: 'b', status: 'queued' }
  ];

  assert.equal(didQueueItemFinish(prev, nextDone), true);
  assert.equal(didQueueItemFinish(prev, nextError), true);
  assert.equal(didQueueItemFinish(prev, stillRunning), false);
  // Already-done → still-done (e.g. mark-read) must not re-open the tray.
  assert.equal(didQueueItemFinish(nextDone, markReadOnly), false);
  assert.equal(didQueueItemFinish([], nextDone), false);
}

console.log('summary-queue tests passed');
