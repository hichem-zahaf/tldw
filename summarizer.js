/**
 * Summarizer Module for TL;DW Extension
 * AI-Only Summarization Engine (Gemini, OpenAI, Groq, Anthropic, OpenRouter)
 */

/**
 * Main entry point for generating transcript summaries using AI
 */
export async function generateSummary(transcript, options = {}) {
  const {
    provider = 'gemini',
    apiKey = '',
    language = 'en', // 'en', 'ar', 'auto'
    videoTitle = '',
    summaryLevel = 3, // 1 (Ultra Short) to 5 (Deep Dive)
    summaryFormat = 'paragraph' // 'paragraph', 'bullets', 'key_takeaways'
  } = options;

  let fmt = String(summaryFormat).toLowerCase();
  if (fmt.includes('bullet')) fmt = 'bullets';
  else if (fmt.includes('takeaway')) fmt = 'key_takeaways';
  else fmt = 'paragraph';

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript text is empty.');
  }

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(`Missing API Key for AI provider (${provider}). Please configure your API key in extension options.`);
  }

  const cleanTranscript = transcript.replace(/\s+/g, ' ').trim();

  if (provider === 'gemini') {
    return await summarizeGemini(cleanTranscript, apiKey, language, videoTitle, summaryLevel, fmt);
  } else if (provider === 'openai') {
    return await summarizeOpenAI(cleanTranscript, apiKey, language, videoTitle, summaryLevel, fmt);
  } else if (provider === 'groq') {
    return await summarizeGroq(cleanTranscript, apiKey, language, videoTitle, summaryLevel, fmt);
  } else if (provider === 'anthropic') {
    return await summarizeAnthropic(cleanTranscript, apiKey, language, videoTitle, summaryLevel, fmt);
  } else if (provider === 'openrouter') {
    return await summarizeOpenRouter(cleanTranscript, apiKey, language, videoTitle, summaryLevel, fmt);
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Construct system & user prompts for LLM summarization
 */
function buildPrompt(
  transcript,
  language,
  videoTitle,
  summaryLevel = 3,
  summaryFormat = 'paragraph'
) {
  const isArabicTarget = language === 'ar';

  // Handles values such as 1, "1", or "Level 1: TL;DR"
  const levelMatch = String(summaryLevel).match(/[1-5]/);
  const level = levelMatch ? Number(levelMatch[0]) : 3;

  const lang = isArabicTarget
    ? 'Write the entire answer in fluent Arabic.'
    : 'Write the entire answer in clear English.';

  const shape = {
    1: {
      bullets: 'Exactly 1–2 short bullet points. Max 25 words total.',
      key_takeaways: 'Exactly 1 takeaway sentence. Max 20 words.',
      paragraph: 'Exactly 1 sentence. Max 20 words.'
    },
    2: {
      bullets: '2–3 short bullet points. Max 50 words total.',
      key_takeaways: '2–3 short takeaway sentences. Max 50 words total.',
      paragraph: '2–3 short sentences. Max 50 words total.'
    },
    3: {
      bullets: '4–5 bullet points. Max 120 words total.',
      key_takeaways: '3–4 takeaway sentences. Max 120 words total.',
      paragraph: 'One paragraph of 4–6 sentences. Max 120 words.'
    },
    4: {
      bullets: '6–8 bullet points. Max 220 words total.',
      key_takeaways: '5–7 takeaway sentences. Max 220 words total.',
      paragraph: '2–3 short paragraphs. Max 250 words total.'
    },
    5: {
      bullets: '8–12 bullet points. Max 400 words total.',
      key_takeaways: '7–10 takeaway sentences. Max 400 words total.',
      paragraph: '3–5 short paragraphs. Max 450 words total.'
    }
  };

  const lengthRule = shape[level][summaryFormat] || shape[level].paragraph;

  let formatRule;
  if (summaryFormat === 'bullets') {
    formatRule = `Output ONLY markdown bullet points starting with "- ".
Each bullet is one concrete idea from the video.
No intro, no outro, no headings.`;
  } else if (summaryFormat === 'key_takeaways') {
    formatRule = `Output ONLY markdown bullet points starting with "- ".
Each bullet is one concrete takeaway from the video.
No intro, no outro, no headings.`;
  } else {
    formatRule = `Output ONLY plain prose paragraphs.
No bullets, no headings, no intro labels.`;
  }

  return {
    isArabicTarget,
    prompt: `Summarize this YouTube video for a busy reader.

Video: "${videoTitle || 'YouTube Video'}"

Rules:
- ${lengthRule}
- ${lang}
- ${formatRule}
- Lead with the main point. Facts and conclusions only — no filler.
- Do not mention the transcript, the speaker, or that this is a summary.
- Reply with the summary text only.

Transcript:
"""
${transcript.slice(0, 30000)}
"""`
  };
}

/**
 * Strip model meta-preambles that sometimes leak into the answer
 */
function cleanSummaryOutput(text) {
  if (!text) return '';
  let out = text.trim();

  // Drop leading meta lines like "Format: …", "Title: …", "Notes: …", "Summary: …"
  out = out.replace(
    /^(?:(?:\*\*|__|#+\s*)?(?:format|title|notes?|summary|output|type|style)\s*[:\-].*\n)+/gim,
    ''
  );

  // Drop a lone first line that is just meta words
  out = out.replace(
    /^(?:format|title|notes?|summary|bullets?|paragraph|takeaways?)(?:\s*[,:]\s*(?:format|title|notes?|summary|bullets?|paragraph|takeaways?))+\s*[,.]?\s*\n+/i,
    ''
  );

  return out.trim();
}

/**
 * Gemini API Summarizer
 */
async function summarizeGemini(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Invalid response structure from Gemini API.');

  return cleanSummaryOutput(text);
}

/**
 * OpenAI API Summarizer
 */
async function summarizeOpenAI(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from OpenAI API.');

  return cleanSummaryOutput(text);
}

/**
 * Groq API Summarizer
 */
async function summarizeGroq(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Groq API.');

  return cleanSummaryOutput(text);
}

/**
 * Anthropic Claude API Summarizer
 */
async function summarizeAnthropic(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      // Anthropic requires max_tokens; omit level caps elsewhere
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Invalid response structure from Anthropic API.');

  return cleanSummaryOutput(text);
}

/**
 * OpenRouter API Summarizer
 */
async function summarizeOpenRouter(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);
  const model = '~google/gemini-flash-latest';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error for ${model} (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from OpenRouter API.');

  return cleanSummaryOutput(text);
}

/**
 * Check if text contains Arabic characters
 */
function isArabicText(text) {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return arabicPattern.test(text || '');
}
