import assert from 'node:assert/strict';
import {
  ACTIVE_SUMMARY_PROMPT_VARIANT,
  buildSummaryPrompt
} from './summary-prompts.js';
import {
  SUMMARY_PROGRESS_MESSAGES,
  getSummaryProgressMessage
} from './summary-progress.js';

const transcript = 'First point. Second point. Third point.';

{
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'Prompt test video',
    language: 'en',
    summaryLevel: 'Level 3: Standard',
    summaryFormat: 'bullet_points'
  });

  assert.equal(result.variantId, ACTIVE_SUMMARY_PROMPT_VARIANT);
  assert.equal(result.temperature, 0.3);
  assert.match(result.prompt, /4-5 bullet points/);
  assert.match(result.prompt, /Write the entire answer in clear English/);
  assert.match(result.prompt, /Output ONLY markdown bullet points/);
  assert.match(result.prompt, /Prompt test video/);
}

{
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'Is this productivity trick actually useful?',
    language: 'en',
    summaryLevel: 2,
    summaryFormat: 'paragraph'
  });

  assert.match(result.prompt, /If the video title asks a question, answer that question directly/);
}

{
  const result = buildSummaryPrompt({
    transcript,
    language: 'ar',
    summaryLevel: 1,
    summaryFormat: 'key_takeaways',
    promptVariant: 'skeptical-editor-v1'
  });

  assert.equal(result.variantId, 'skeptical-editor-v1');
  assert.equal(result.temperature, 0.2);
  assert.match(result.prompt, /Exactly 1 takeaway sentence/);
  assert.match(result.prompt, /Write the entire answer in fluent Arabic/);
  assert.match(result.prompt, /Prioritize claims, evidence, caveats, and concrete numbers/);
}

{
  const result = buildSummaryPrompt({
    transcript,
    promptVariant: 'missing-variant'
  });

  assert.equal(result.variantId, ACTIVE_SUMMARY_PROMPT_VARIANT);
}

{
  assert.equal(
    getSummaryProgressMessage('retrievingTranscript'),
    'Retrieving transcript from Clipscript.uk...'
  );
  assert.equal(
    getSummaryProgressMessage('summarizing'),
    'Generating summary...'
  );
  assert.equal(
    getSummaryProgressMessage('unknown-step'),
    SUMMARY_PROGRESS_MESSAGES.checkingCache
  );
  assert.ok(
    Object.values(SUMMARY_PROGRESS_MESSAGES).every(message => !/retrieving transcript.*generating summary/i.test(message))
  );
}

console.log('summary-prompts tests passed');
