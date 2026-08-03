/**
 * Video Classifier for TL;DW Extension
 *
 * Labels a video from its thumbnail image + title before the summary runs, so
 * the summary prompt can lead with whatever the video actually promised.
 * Runs in parallel with transcript retrieval and never blocks it: every failure
 * path falls back to a title-only heuristic.
 */

import { isQuestionTitle } from './summary-prompts.js';

/**
 * Cheapest vision-capable model per provider. Versions are pinned on purpose:
 * `-latest` aliases hot-swap onto newer, pricier tiers without warning.
 */
export const CLASSIFIER_MODELS = {
  gemini: 'gemini-2.5-flash-lite',
  openai: 'gpt-5.6-luna',
  groq: 'qwen/qwen3.6-27b',
  anthropic: 'claude-haiku-4-5-20251001',
  openrouter: 'qwen/qwen3-vl-32b-instruct'
};

export const VIDEO_TYPES = [
  'question',
  'howto',
  'review',
  'news',
  'explainer',
  'story',
  'entertainment'
];

const CLASSIFIER_TIMEOUT_MS = 15000;
const CLASSIFIER_MAX_TOKENS = 300;
const CLASSIFICATION_CACHE_VERSION = 'v1';

/**
 * Keyed on the video alone. The thumbnail and title do not change when the
 * reader toggles detail level, format, or language, so those toggles must not
 * trigger another vision call.
 */
export function buildClassificationCacheKey(videoId) {
  return `vclass_${videoId}_${CLASSIFICATION_CACHE_VERSION}`;
}

export function buildThumbnailUrls(videoId) {
  const id = encodeURIComponent(String(videoId || ''));
  return {
    preferred: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    fallback: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  };
}

/**
 * Providers fetch the thumbnail URL server side, so a 404 fails the whole
 * call. maxresdefault only exists for HD uploads, and hqdefault is missing for
 * some videos too, so probe both and report when neither is there.
 */
export async function resolveThumbnailUrl(videoId, fetchImpl = fetch) {
  if (!videoId) return '';

  const { preferred, fallback } = buildThumbnailUrls(videoId);

  for (const url of [preferred, fallback]) {
    try {
      const res = await fetchImpl(url, { method: 'HEAD' });
      if (res && res.ok) return url;
    } catch (err) {
      // Probe failure means we cannot promise the provider a fetchable image.
    }
  }

  return '';
}

export function buildClassifyPrompt(videoTitle, { hasThumbnail = true } = {}) {
  return `You are labeling a YouTube video from its ${hasThumbnail ? 'thumbnail image and its title' : 'title'}.

Title: "${String(videoTitle || '').trim() || 'Untitled'}"

Reply with ONLY a JSON object, no code fence, with exactly these keys in this order:

"thumbnail_text": ${hasThumbnail
    ? 'every word of text visible on the thumbnail, verbatim, in reading order. Empty string if the thumbnail has no text.'
    : 'always an empty string, since no thumbnail is available.'}
"type": one of ${VIDEO_TYPES.join(' | ')}
  question - the title or thumbnail asks something directly
  howto - promises to teach a process, build, or outcome
  review - judges a product, tool, place, or service
  news - reports an event, release, or announcement
  explainer - explains how something works, with no specific promised payoff
  story - personal narrative, vlog, documentary, interview
  entertainment - comedy, music, reaction, no informational payoff
"hook": the one question the video promises to answer, or the one specific payoff it promises, as a single short sentence. Empty string if the title and thumbnail promise nothing specific.
"has_promise": true only when "hook" names something the video can measurably succeed or fail at delivering. false for vlogs, general news, broad explainers, and pure entertainment.
${hasThumbnail ? '\nRead the thumbnail text before deciding: the real promise often lives there rather than in the title.' : ''}`;
}

export function buildClassifyRequest({
  provider,
  apiKey,
  videoTitle,
  thumbnailUrl
}) {
  const model = CLASSIFIER_MODELS[provider];
  if (!model) {
    throw new Error(`Unsupported AI provider for classification: ${provider}`);
  }

  // Some videos have no reachable thumbnail at all; fall back to the title
  // rather than handing the provider a URL that will 404 on its side.
  const hasThumbnail = !!thumbnailUrl;
  const prompt = buildClassifyPrompt(videoTitle, { hasThumbnail });

  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              ...(hasThumbnail
                ? [{ file_data: { mime_type: 'image/jpeg', file_uri: thumbnailUrl } }]
                : [])
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            // Perception beats deliberation here, and thinking tokens are the
            // only thing that would push this call past a second.
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    };
  }

  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: CLASSIFIER_MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              // `low`/`high` resize before analysis and lose stylized overlay
              // text; `original` is the documented setting for OCR.
              ...(hasThumbnail
                ? [{ type: 'image_url', image_url: { url: thumbnailUrl, detail: 'original' } }]
                : [])
            ]
          }]
        })
      }
    };
  }

  if (provider === 'groq' || provider === 'openrouter') {
    return {
      url: provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions',
      init: {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: CLASSIFIER_MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...(hasThumbnail ? [{ type: 'image_url', image_url: { url: thumbnailUrl } }] : [])
            ]
          }]
        })
      }
    };
  }

  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            // Claude reads images better when they precede the instruction.
            ...(hasThumbnail ? [{ type: 'image', source: { type: 'url', url: thumbnailUrl } }] : []),
            { type: 'text', text: prompt }
          ]
        }]
      })
    }
  };
}

export function extractClassifyResponseText(provider, data) {
  if (provider === 'gemini') {
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  if (provider === 'anthropic') {
    return data?.content?.[0]?.text || '';
  }
  return data?.choices?.[0]?.message?.content || '';
}

function normalizeType(type, hasPromise) {
  const value = String(type || '').trim().toLowerCase();
  if (VIDEO_TYPES.includes(value)) return value;
  return hasPromise ? 'question' : 'explainer';
}

export function parseClassification(rawText, videoTitle = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return null;
  }

  const hook = String(data.hook || '').trim();
  // A promise with nothing named is not a promise we can grade.
  const hasPromise = (data.has_promise === true || data.hasPromise === true) && !!hook;

  return {
    thumbnailText: String(data.thumbnail_text || data.thumbnailText || '').trim(),
    type: normalizeType(data.type, hasPromise),
    hook,
    hasPromise,
    source: 'model',
    videoTitle: String(videoTitle || '').trim()
  };
}

export function heuristicClassification(videoTitle = '') {
  const title = String(videoTitle || '').trim();

  // Checked before isQuestionTitle, which also matches a leading "how".
  if (/^how (?:to|i|we)\b/i.test(title)) {
    return { thumbnailText: '', type: 'howto', hook: title, hasPromise: !!title, source: 'heuristic', videoTitle: title };
  }
  if (isQuestionTitle(title)) {
    return { thumbnailText: '', type: 'question', hook: title, hasPromise: !!title, source: 'heuristic', videoTitle: title };
  }
  if (/\breview\b|\bvs\.?\b|worth it|\bbest\b/i.test(title)) {
    return { thumbnailText: '', type: 'review', hook: title, hasPromise: !!title, source: 'heuristic', videoTitle: title };
  }

  return { thumbnailText: '', type: 'explainer', hook: '', hasPromise: false, source: 'heuristic', videoTitle: title };
}

export async function classifyVideo({
  provider = 'gemini',
  apiKey = '',
  videoId = '',
  videoTitle = '',
  fetchImpl = fetch,
  timeoutMs = CLASSIFIER_TIMEOUT_MS
} = {}) {
  if (!apiKey || !CLASSIFIER_MODELS[provider]) {
    return heuristicClassification(videoTitle);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const thumbnailUrl = await resolveThumbnailUrl(videoId, fetchImpl);
    const { url, init } = buildClassifyRequest({ provider, apiKey, videoTitle, thumbnailUrl });

    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Classifier error (${response.status}): ${errText.slice(0, 200)}`);
    }

    const parsed = parseClassification(
      extractClassifyResponseText(provider, await response.json()),
      videoTitle
    );

    return parsed || heuristicClassification(videoTitle);
  } catch (err) {
    console.warn(`[TL;DW] Video classification failed (${err.message || err}), using title heuristic.`);
    return heuristicClassification(videoTitle);
  } finally {
    clearTimeout(timer);
  }
}
