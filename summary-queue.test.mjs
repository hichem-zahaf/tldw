import assert from 'node:assert/strict';
import {
  SUMMARY_QUEUE_LIMIT,
  buildQueueItem,
  mergeQueueItem,
  getQueueStats
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
    { id: 'done', status: 'done' },
    { id: 'error', status: 'error' }
  ]);

  assert.deepEqual(stats, {
    total: 4,
    pending: 2,
    done: 1,
    error: 1
  });
}

console.log('summary-queue tests passed');
