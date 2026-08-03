export const ACTIVE_SUMMARY_PROMPT_VARIANT = 'busy-reader-v2';

export const SUMMARY_PROMPT_VARIANTS = {
  'busy-reader-v2': {
    label: 'Busy Reader',
    temperature: 0.3,
    extraRules: [
      'Lead with the main point. Facts and conclusions only, no filler.',
      'Do not mention the transcript, the speaker, or that this is a summary.',
      'Reply with the summary text only.'
    ]
  },
  'skeptical-editor-v1': {
    label: 'Skeptical Editor',
    temperature: 0.2,
    extraRules: [
      'Prioritize claims, evidence, caveats, and concrete numbers.',
      'Do not overstate beyond the transcript.',
      'Do not mention the transcript, the speaker, or that this is a summary.',
      'Reply with the summary text only.'
    ]
  }
};

/**
 * Per-type lead instructions. The classifier picks the type from the thumbnail
 * and title; this decides what the summary opens with.
 * `entertainment` has no lead at all — nothing was promised, so there is
 * nothing to answer.
 */
export const VIDEO_TYPE_PROFILES = {
  question: {
    label: 'Question',
    leadRule: 'LEAD answers the question directly, using the specific number, name, or verdict the video gives. No throat-clearing.',
    ratingLabel: 'Answers it'
  },
  howto: {
    label: 'How-to',
    leadRule: 'LEAD states the outcome and what it costs to get there: time, money, tools, or the one step that matters most.',
    ratingLabel: 'Delivers'
  },
  review: {
    label: 'Review',
    leadRule: 'LEAD states the verdict and who it is for. Name the deciding trade-off.',
    ratingLabel: 'Delivers'
  },
  news: {
    label: 'News',
    leadRule: 'LEAD states what happened and why it matters.',
    ratingLabel: 'Delivers',
    temperature: 0.2
  },
  explainer: {
    label: 'Explainer',
    leadRule: 'LEAD states the core mechanism or thesis in one line.',
    ratingLabel: 'Delivers'
  },
  story: {
    label: 'Story',
    leadRule: 'LEAD states the through-line and how it turns out.',
    ratingLabel: 'Delivers'
  },
  entertainment: {
    label: 'Entertainment',
    leadRule: '',
    ratingLabel: 'Delivers'
  }
};

const RATING_RULE = `RATING is how well the video delivers on that promise, judged only from the transcript:
3 = answers it directly and early, with specifics
2 = answers it partially, hedges, or buries it under padding
1 = never actually answers it`;

const SUMMARY_SHAPE_RULES = {
  1: {
    bullets: 'Exactly 1-2 short bullet points. Max 25 words total.',
    key_takeaways: 'Exactly 1 takeaway sentence. Max 20 words.',
    paragraph: 'Exactly 1 sentence. Max 20 words.'
  },
  2: {
    bullets: '2-3 short bullet points. Max 50 words total.',
    key_takeaways: '2-3 short takeaway sentences. Max 50 words total.',
    paragraph: '2-3 short sentences. Max 50 words total.'
  },
  3: {
    bullets: '4-5 bullet points. Max 120 words total.',
    key_takeaways: '3-4 takeaway sentences. Max 120 words total.',
    paragraph: 'One paragraph of 4-6 sentences. Max 120 words.'
  },
  4: {
    bullets: '6-8 bullet points. Max 220 words total.',
    key_takeaways: '5-7 takeaway sentences. Max 220 words total.',
    paragraph: '2-3 short paragraphs. Max 250 words total.'
  },
  5: {
    bullets: '8-12 bullet points. Max 400 words total.',
    key_takeaways: '7-10 takeaway sentences. Max 400 words total.',
    paragraph: '3-5 short paragraphs. Max 450 words total.'
  }
};

const FORMAT_RULES = {
  bullets: `Output ONLY markdown bullet points starting with "- ".
Each bullet is one concrete idea from the video.
No intro, no outro, no headings.`,
  key_takeaways: `Output ONLY markdown bullet points starting with "- ".
Each bullet is one concrete takeaway from the video.
No intro, no outro, no headings.`,
  paragraph: `Output ONLY plain prose paragraphs.
No bullets, no headings, no intro labels.`
};

function normalizeSummaryLevel(summaryLevel) {
  const levelMatch = String(summaryLevel).match(/[1-5]/);
  return levelMatch ? Number(levelMatch[0]) : 3;
}

function normalizeSummaryFormat(summaryFormat) {
  const format = String(summaryFormat).toLowerCase();
  if (format.includes('bullet')) return 'bullets';
  if (format.includes('takeaway')) return 'key_takeaways';
  return 'paragraph';
}

function resolvePromptVariant(promptVariant) {
  const variantId = SUMMARY_PROMPT_VARIANTS[promptVariant]
    ? promptVariant
    : ACTIVE_SUMMARY_PROMPT_VARIANT;

  return {
    variantId,
    variant: SUMMARY_PROMPT_VARIANTS[variantId]
  };
}

function getLanguageRule(language) {
  return language === 'ar'
    ? 'Write the entire answer in fluent Arabic.'
    : 'Write the entire answer in clear English.';
}

export function isQuestionTitle(videoTitle) {
  const title = String(videoTitle || '').trim();
  return /[?\u061F]$/.test(title) || /^(?:is|are|can|could|should|would|will|do|does|did|what|why|how|who|where|when)\b/i.test(title);
}

function resolveTypeProfile(classification, videoTitle) {
  const type = VIDEO_TYPE_PROFILES[classification?.type]
    ? classification.type
    : (isQuestionTitle(videoTitle) ? 'question' : 'explainer');

  return { type, profile: VIDEO_TYPE_PROFILES[type] };
}

/**
 * Header block the model prepends to the summary. `parseSummaryAnswer` in
 * summary-answer.js reads it back out, so the two must stay in sync.
 */
function buildHeaderRules({ profile, hook, hasPromise, level }) {
  if (!profile.leadRule) return null;

  // At level 1 the lead already is the whole summary; a body would just
  // restate it inside a 20-word budget.
  const bodyOmitted = hasPromise && level === 1;

  const lines = [];
  if (hasPromise) {
    // Only ask for the hook when we could not read one off the thumbnail.
    // Asked to "restate" a known hook, models answer it instead, which then
    // duplicates the lead.
    if (!hook) lines.push('HOOK: the question or promise the title makes, in one short line');
    lines.push('RATING: a single digit, 1, 2, or 3');
  }
  lines.push(bodyOmitted
    ? 'LEAD: the entire summary, no bullets'
    : 'LEAD: one or two sentences, no bullets');
  if (!bodyOmitted) lines.push('---');

  return {
    bodyOmitted,
    block: `Start your reply with this exact block, keeping the labels in English and writing the values in the answer language:

${lines.join('\n')}
${hook ? `\nThe reader already sees this promise printed above your reply: "${hook}". Never restate it; the LEAD resolves it.\n` : ''}
${profile.leadRule}
${hasPromise ? RATING_RULE + '\n' : ''}${bodyOmitted
      ? 'Output nothing after the LEAD line.'
      : 'After the --- line, write the summary body. The body adds supporting detail and evidence; it never restates the LEAD.'}`
  };
}

export function buildSummaryPrompt({
  transcript,
  language = 'en',
  videoTitle = '',
  summaryLevel = 3,
  summaryFormat = 'paragraph',
  promptVariant = ACTIVE_SUMMARY_PROMPT_VARIANT,
  classification = null
} = {}) {
  const level = normalizeSummaryLevel(summaryLevel);
  const format = normalizeSummaryFormat(summaryFormat);
  const { variantId, variant } = resolvePromptVariant(promptVariant);
  const { type, profile } = resolveTypeProfile(classification, videoTitle);

  const hook = String(classification?.hook || '').trim();
  const hasPromise = classification
    ? !!classification.hasPromise && !!hook
    : isQuestionTitle(videoTitle);

  const header = buildHeaderRules({ profile, hook, hasPromise, level });
  const lengthRule = SUMMARY_SHAPE_RULES[level][format] || SUMMARY_SHAPE_RULES[level].paragraph;

  const formatRule = FORMAT_RULES[format] || FORMAT_RULES.paragraph;
  const rules = [
    // With no body, the level's length budget belongs to the lead instead —
    // dropping it lets a level 1 "summary" run to a full paragraph.
    ...(header?.bodyOmitted ? [`Lead length: ${lengthRule}`] : [
      header ? `Body length: ${lengthRule}` : lengthRule,
      header ? `Body format: ${formatRule}` : formatRule
    ]),
    getLanguageRule(language),
    ...variant.extraRules
  ];

  const promptSections = [
    'Summarize this YouTube video for a busy reader.',
    `Video: "${videoTitle || 'YouTube Video'}"`,
    ...(header ? [header.block] : []),
    `Rules:\n${rules.map(rule => `- ${rule}`).join('\n')}`,
    `Transcript:\n"""\n${String(transcript || '').slice(0, 30000)}\n"""`
  ];

  return {
    variantId,
    videoType: type,
    hasPromise,
    temperature: profile.temperature ?? variant.temperature,
    prompt: promptSections.join('\n\n')
  };
}
