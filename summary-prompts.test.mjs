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
  // No classification available: a question title still gets the answer block.
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'Is this productivity trick actually useful?',
    language: 'en',
    summaryLevel: 2,
    summaryFormat: 'paragraph'
  });

  assert.equal(result.videoType, 'question');
  assert.equal(result.hasPromise, true);
  // With no classifier hook to fall back on, the model supplies one.
  assert.match(result.prompt, /^HOOK: the question or promise the title makes/m);
  assert.match(result.prompt, /^RATING: a single digit/m);
  assert.match(result.prompt, /RATING is how well the video delivers on that promise/);
}

{
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'I tried the 5am club for 30 days',
    summaryLevel: 3,
    classification: {
      type: 'story',
      hook: 'Does waking at 5am actually change anything?',
      hasPromise: true
    }
  });

  assert.equal(result.videoType, 'story');
  // The hook is already known, so asking for it back only invites the model to
  // answer it in the HOOK line and duplicate the lead.
  assert.doesNotMatch(result.prompt, /^HOOK:/m);
  assert.match(result.prompt, /already sees this promise printed above your reply: "Does waking at 5am actually change anything\?"/);
  assert.match(result.prompt, /LEAD states the through-line and how it turns out/);
  assert.match(result.prompt, /Body length: 4-5 bullet points|Body length: One paragraph/);
}

{
  // Nothing specific promised: a lead, but no hook and no rating to grade.
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'The Fed cut rates today',
    classification: { type: 'news', hook: '', hasPromise: false }
  });

  assert.equal(result.hasPromise, false);
  assert.equal(result.temperature, 0.2, 'news profile overrides the variant temperature');
  assert.doesNotMatch(result.prompt, /^HOOK:/m);
  assert.doesNotMatch(result.prompt, /^RATING:/m);
  assert.match(result.prompt, /^LEAD: one or two sentences/m);
  assert.match(result.prompt, /LEAD states what happened and why it matters/);
}

{
  // Entertainment promises nothing, so there is no lead block at all.
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'Try not to laugh',
    classification: { type: 'entertainment', hook: '', hasPromise: false }
  });

  assert.doesNotMatch(result.prompt, /^LEAD:/m);
  assert.doesNotMatch(result.prompt, /Body length:/);
  assert.match(result.prompt, /Output ONLY plain prose paragraphs/);
}

{
  // Level 1 with a promise: the lead is the summary, so no body is requested.
  const result = buildSummaryPrompt({
    transcript,
    videoTitle: 'Is it worth it?',
    summaryLevel: 1,
    classification: { type: 'review', hook: 'Is it worth $40?', hasPromise: true }
  });

  assert.match(result.prompt, /Output nothing after the LEAD line/);
  assert.doesNotMatch(result.prompt, /Body length:/);
  assert.doesNotMatch(result.prompt, /^---$/m);
  // The level budget moves to the lead; without it a level 1 summary runs on.
  assert.match(result.prompt, /- Lead length: Exactly 1 sentence\. Max 20 words\./);
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
