export const ACTIVE_SUMMARY_PROMPT_VARIANT = 'busy-reader-v1';

export const SUMMARY_PROMPT_VARIANTS = {
  'busy-reader-v1': {
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

export function buildSummaryPrompt({
  transcript,
  language = 'en',
  videoTitle = '',
  summaryLevel = 3,
  summaryFormat = 'paragraph',
  promptVariant = ACTIVE_SUMMARY_PROMPT_VARIANT
} = {}) {
  const level = normalizeSummaryLevel(summaryLevel);
  const format = normalizeSummaryFormat(summaryFormat);
  const { variantId, variant } = resolvePromptVariant(promptVariant);

  const lengthRule = SUMMARY_SHAPE_RULES[level][format] || SUMMARY_SHAPE_RULES[level].paragraph;
  const rules = [
    lengthRule,
    getLanguageRule(language),
    FORMAT_RULES[format] || FORMAT_RULES.paragraph,
    ...variant.extraRules
  ];

  return {
    variantId,
    temperature: variant.temperature,
    prompt: `Summarize this YouTube video for a busy reader.

Video: "${videoTitle || 'YouTube Video'}"

Rules:
${rules.map(rule => `- ${rule}`).join('\n')}

Transcript:
"""
${String(transcript || '').slice(0, 30000)}
"""`
  };
}
