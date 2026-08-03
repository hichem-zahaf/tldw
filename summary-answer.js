/**
 * Answer block parsing for TL;DW summaries.
 *
 * Summaries generated with a video type profile start with a small header:
 *
 *   HOOK: Does creatine actually build muscle?
 *   RATING: 2
 *   LEAD: Yes, but only about 1-2kg over eight weeks.
 *   ---
 *   <summary body>
 *
 * Everything here is tolerant of a missing or partial header, so summaries
 * cached before this format existed still render as a plain body.
 */

const LABEL_LINE = /^[\s>*_#]*(HOOK|RATING|LEAD)[\s*_]*[:\-\u2013][\s*_]*(.*)$/i;
const SEPARATOR_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export const EMPTY_SUMMARY_ANSWER = {
  hook: '',
  rating: 0,
  lead: '',
  body: '',
  hasHeader: false
};

function cleanValue(value) {
  return String(value || '')
    .trim()
    .replace(/^\*\*(.*)\*\*$/s, '$1')
    .replace(/^["'\u201c\u201d](.*)["'\u201c\u201d]$/s, '$1')
    .trim();
}

function parseRating(value) {
  const text = String(value || '');
  const stars = (text.match(/[\u2605\u2b50]/g) || []).length;
  if (stars >= 1 && stars <= 3) return stars;

  const digit = text.match(/[1-3]/);
  return digit ? Number(digit[0]) : 0;
}

export function parseSummaryAnswer(rawSummary) {
  const text = String(rawSummary || '').trim();
  if (!text) return { ...EMPTY_SUMMARY_ANSWER };

  const lines = text.split('\n');
  const values = { hook: '', rating: '', lead: '' };
  let lastLabel = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const labelMatch = trimmed.match(LABEL_LINE);

    if (labelMatch) {
      lastLabel = labelMatch[1].toLowerCase();
      values[lastLabel] = labelMatch[2];
      index += 1;
      continue;
    }

    if (SEPARATOR_LINE.test(trimmed)) {
      index += 1;
      break;
    }

    // Only continue a label whose value spilled onto the next line. Anything
    // else means the header ended without a separator and the body starts here.
    if (lastLabel && !values[lastLabel] && trimmed) {
      values[lastLabel] = trimmed;
      index += 1;
      continue;
    }

    if (lastLabel && !trimmed) {
      index += 1;
      if (values.lead) break;
      continue;
    }

    break;
  }

  const hook = cleanValue(values.hook);
  const lead = cleanValue(values.lead);
  const rating = parseRating(values.rating);
  const hasHeader = !!(hook || lead || rating);

  if (!hasHeader) {
    return { ...EMPTY_SUMMARY_ANSWER, body: text };
  }

  const body = lines
    .slice(index)
    .join('\n')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m, '')
    .trim();

  return { hook, rating, lead, body, hasHeader: true };
}

export function renderStars(rating) {
  const value = Math.max(0, Math.min(3, Number(rating) || 0));
  if (!value) return '';
  return '\u2605'.repeat(value) + '\u2606'.repeat(3 - value);
}

export function getRatingLabel(rating, videoType = '') {
  const asksQuestion = videoType === 'question';

  if (rating >= 3) return asksQuestion ? 'Answers it' : 'Delivers';
  if (rating === 2) return asksQuestion ? 'Partly answers it' : 'Partly delivers';
  if (rating === 1) return asksQuestion ? 'Never answers it' : "Doesn't deliver";
  return '';
}

/** Clipboard-friendly text: the header labels are an implementation detail. */
export function formatAnswerPlainText(answer, videoType = '') {
  const parsed = answer && answer.hasHeader !== undefined ? answer : parseSummaryAnswer(answer);
  if (!parsed.hasHeader) return parsed.body || '';

  const verdict = parsed.rating
    ? `${renderStars(parsed.rating)} ${getRatingLabel(parsed.rating, videoType)}`
    : '';

  return [
    parsed.hook,
    verdict,
    parsed.lead,
    parsed.body
  ].filter(Boolean).join('\n\n');
}

export function formatAnswerMarkdown(answer, videoType = '') {
  const parsed = answer && answer.hasHeader !== undefined ? answer : parseSummaryAnswer(answer);
  if (!parsed.hasHeader) return parsed.body || '';

  const sections = [];

  if (parsed.hook) {
    sections.push(videoType === 'question' ? '## The question' : '## The promise');
    sections.push(`> ${parsed.hook}`);
  }

  if (parsed.rating) {
    sections.push(`**Verdict:** ${renderStars(parsed.rating)} ${getRatingLabel(parsed.rating, videoType)} (${parsed.rating}/3)`);
  }

  if (parsed.lead) {
    sections.push(parsed.hook ? '## The answer' : '## The point');
    sections.push(parsed.lead);
  }

  if (parsed.body) {
    sections.push('## Summary');
    sections.push(parsed.body);
  }

  return sections.join('\n\n');
}
