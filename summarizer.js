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

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript text is empty.');
  }

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(`Missing API Key for AI provider (${provider}). Please configure your API key in extension options.`);
  }

  const cleanTranscript = transcript.replace(/\s+/g, ' ').trim();

  if (provider === 'gemini') {
    return await summarizeGemini(cleanTranscript, apiKey, language, videoTitle, summaryLevel, summaryFormat);
  } else if (provider === 'openai') {
    return await summarizeOpenAI(cleanTranscript, apiKey, language, videoTitle, summaryLevel, summaryFormat);
  } else if (provider === 'groq') {
    return await summarizeGroq(cleanTranscript, apiKey, language, videoTitle, summaryLevel, summaryFormat);
  } else if (provider === 'anthropic') {
    return await summarizeAnthropic(cleanTranscript, apiKey, language, videoTitle, summaryLevel, summaryFormat);
  } else if (provider === 'openrouter') {
    return await summarizeOpenRouter(cleanTranscript, apiKey, language, videoTitle, summaryLevel, summaryFormat);
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Construct system & user prompts for LLM summarization
 */
function buildPrompt(transcript, language, videoTitle, summaryLevel = 3, summaryFormat = 'paragraph') {
  const isArabicTarget = language === 'ar';
  
  let targetLangInstruction = isArabicTarget
    ? 'Write the summary in fluent, natural Arabic.'
    : 'Write the summary in clear, natural, highly readable English (translate key concepts if transcript is in another language).';

  // Length Level 1..5
  const level = Number(summaryLevel) || 3;
  let lengthInstruction = '';
  if (level === 1) {
    lengthInstruction = 'Provide an ultra-concise TL;DR in exactly 1 sharp sentence (max 25 words).';
  } else if (level === 2) {
    lengthInstruction = 'Provide a brief summary in 2 to 3 concise sentences.';
  } else if (level === 3) {
    lengthInstruction = 'Provide a balanced, standard summary in 1 well-structured paragraph (4 to 6 sentences).';
  } else if (level === 4) {
    lengthInstruction = 'Provide a detailed summary in 2 to 3 thorough paragraphs with full context.';
  } else if (level === 5) {
    lengthInstruction = 'Provide a comprehensive deep-dive summary breakdown covering all core topics, nuance, and key details.';
  }

  // Format Instruction
  let formatInstruction = '';
  if (summaryFormat === 'bullets') {
    formatInstruction = 'Format the summary strictly as a clean, bulleted list (`- point`).';
  } else if (summaryFormat === 'key_takeaways') {
    formatInstruction = 'Format the summary as a list of Key Insights & Takeaways with bold lead-in titles for each point.';
  } else {
    formatInstruction = 'Format the summary as clean narrative prose paragraphs.';
  }

  const prompt = `You are an expert video content summarizer. Your task is to summarize the video transcript provided below.

Context/Title: "${videoTitle || 'YouTube Video'}"

Instructions:
1. ${lengthInstruction}
2. ${formatInstruction}
3. ${targetLangInstruction}
4. Use markdown formatting (**bold** important concepts and takeaways for fast scanning).
5. Capture the core ideas, key insights, and primary takeaway.
6. Do NOT use meta-phrases like "In this video", "The speaker says", or "This transcript describes". State the key insights directly.
7. Keep it clear, precise, and highly engaging to read.

Transcript:
"""
${transcript.slice(0, 30000)}
"""`;

  return { prompt, isArabicTarget };
}

/**
 * Gemini API Summarizer
 */
async function summarizeGemini(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Invalid response structure from Gemini API.');

  return text.trim();
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
      temperature: 0.3,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from OpenAI API.');

  return text.trim();
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
      temperature: 0.3,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Groq API.');

  return text.trim();
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
      max_tokens: 1000,
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

  return text.trim();
}

/**
 * OpenRouter API Summarizer
 */
async function summarizeOpenRouter(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);

  const modelsToTry = ['google/gemini-flash-latest', 'google/gemini-2.5-flash'];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
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
      if (text) return text.trim();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('OpenRouter API request failed.');
}

/**
 * Check if text contains Arabic characters
 */
function isArabicText(text) {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return arabicPattern.test(text || '');
}
