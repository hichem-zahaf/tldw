/**
 * Summarizer Module for TL;DW Extension
 * AI-Only Summarization Engine (Gemini, OpenAI, Groq, Anthropic, OpenRouter)
 */

import { buildSummaryPrompt } from './summary-prompts.js';

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
    summaryFormat = 'paragraph', // 'paragraph', 'bullets', 'key_takeaways'
    promptVariant
  } = options;

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript text is empty.');
  }

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(`Missing API Key for AI provider (${provider}). Please configure your API key in extension options.`);
  }

  const cleanTranscript = transcript.replace(/\s+/g, ' ').trim();
  const { prompt, temperature } = buildSummaryPrompt({
    transcript: cleanTranscript,
    language,
    videoTitle,
    summaryLevel,
    summaryFormat,
    promptVariant
  });

  if (provider === 'gemini') {
    return await summarizeGemini(prompt, apiKey, temperature);
  } else if (provider === 'openai') {
    return await summarizeOpenAI(prompt, apiKey, temperature);
  } else if (provider === 'groq') {
    return await summarizeGroq(prompt, apiKey, temperature);
  } else if (provider === 'anthropic') {
    return await summarizeAnthropic(prompt, apiKey, temperature);
  } else if (provider === 'openrouter') {
    return await summarizeOpenRouter(prompt, apiKey, temperature);
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
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
async function summarizeGemini(prompt, apiKey, temperature) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature }
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
async function summarizeOpenAI(prompt, apiKey, temperature) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature
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
async function summarizeGroq(prompt, apiKey, temperature) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature
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
async function summarizeAnthropic(prompt, apiKey, temperature) {
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
      temperature,
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
async function summarizeOpenRouter(prompt, apiKey, temperature) {
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
      temperature
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
