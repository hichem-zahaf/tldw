import assert from 'node:assert/strict';
import {
  formatAnswerMarkdown,
  formatAnswerPlainText,
  getRatingLabel,
  parseSummaryAnswer,
  renderStars
} from './summary-answer.js';

{
  const parsed = parseSummaryAnswer(
    `HOOK: Does creatine actually build muscle?
RATING: 2
LEAD: Yes, but only about 1-2kg over eight weeks.
---
- Study of 40 lifters over 8 weeks.
- Effect fades after loading stops.`
  );

  assert.equal(parsed.hasHeader, true);
  assert.equal(parsed.hook, 'Does creatine actually build muscle?');
  assert.equal(parsed.rating, 2);
  assert.equal(parsed.lead, 'Yes, but only about 1-2kg over eight weeks.');
  assert.equal(parsed.body, '- Study of 40 lifters over 8 weeks.\n- Effect fades after loading stops.');
}

{
  // No promise: lead only, no rating, no hook.
  const parsed = parseSummaryAnswer('LEAD: The Fed sets rates by targeting reserves.\n---\nBody text here.');
  assert.equal(parsed.hasHeader, true);
  assert.equal(parsed.hook, '');
  assert.equal(parsed.rating, 0);
  assert.equal(parsed.lead, 'The Fed sets rates by targeting reserves.');
  assert.equal(parsed.body, 'Body text here.');
}

{
  // Level 1: the lead is the whole summary, so there is no body or separator.
  const parsed = parseSummaryAnswer('HOOK: Is it worth it?\nRATING: 3\nLEAD: Yes, for under $40.');
  assert.equal(parsed.rating, 3);
  assert.equal(parsed.lead, 'Yes, for under $40.');
  assert.equal(parsed.body, '');
}

{
  // Summaries cached before this format existed have no header at all.
  const plain = 'Just a paragraph of summary with no header block.';
  const parsed = parseSummaryAnswer(plain);
  assert.equal(parsed.hasHeader, false);
  assert.equal(parsed.body, plain);
  assert.equal(parsed.lead, '');
  assert.equal(formatAnswerPlainText(parsed), plain);
  assert.equal(formatAnswerMarkdown(parsed), plain);
}

{
  assert.deepEqual(parseSummaryAnswer(''), {
    hook: '', rating: 0, lead: '', body: '', hasHeader: false
  });
}

{
  // Models decorate the labels, split values onto the next line, and swap the
  // separator style. All of that still has to parse.
  const parsed = parseSummaryAnswer(
    `**HOOK:** Can you learn Python in a week?
**RATING:** 1
**LEAD:**
No. The video never gets past installing an editor.
***
Padding about the presenter's setup.`
  );

  assert.equal(parsed.hook, 'Can you learn Python in a week?');
  assert.equal(parsed.rating, 1);
  assert.equal(parsed.lead, 'No. The video never gets past installing an editor.');
  assert.equal(parsed.body, "Padding about the presenter's setup.");
}

{
  // Stars instead of a digit, and a rating outside 1-3.
  assert.equal(parseSummaryAnswer('RATING: ★★☆\nLEAD: Sure.').rating, 2);
  assert.equal(parseSummaryAnswer('RATING: 9\nLEAD: Sure.').rating, 0);
}

{
  // A header with no separator: the body starts at the first non-label line.
  const parsed = parseSummaryAnswer('LEAD: Short answer.\n\nSupporting detail follows.');
  assert.equal(parsed.lead, 'Short answer.');
  assert.equal(parsed.body, 'Supporting detail follows.');
}

{
  assert.equal(renderStars(3), '★★★');
  assert.equal(renderStars(1), '★☆☆');
  assert.equal(renderStars(0), '');
  assert.equal(getRatingLabel(3, 'question'), 'Answers it');
  assert.equal(getRatingLabel(3, 'review'), 'Delivers');
  assert.equal(getRatingLabel(2, 'question'), 'Partly answers it');
  assert.equal(getRatingLabel(0, 'question'), '');
}

{
  const text = formatAnswerPlainText(
    'HOOK: Worth buying?\nRATING: 3\nLEAD: Yes.\n---\nDetail.',
    'review'
  );

  // The prompt labels are an implementation detail; they never reach the clipboard.
  assert.doesNotMatch(text, /HOOK:|RATING:|LEAD:/);
  assert.equal(text, 'Worth buying?\n\n★★★ Delivers\n\nYes.\n\nDetail.');
}

{
  const md = formatAnswerMarkdown(
    'HOOK: Does it work?\nRATING: 2\nLEAD: Partly.\n---\nDetail.',
    'question'
  );

  assert.match(md, /## The question\n\n> Does it work\?/);
  assert.match(md, /\*\*Verdict:\*\* ★★☆ Partly answers it \(2\/3\)/);
  assert.match(md, /## The answer\n\nPartly\./);
  assert.match(md, /## Summary\n\nDetail\.$/);
}

console.log('summary-answer.test.mjs passed');
