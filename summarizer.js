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
 * Helper to determine max token limit per summary level
 */
function getMaxTokens(level) {
  const l = Number(level) || 3;
  if (l === 1) return 120;
  if (l === 2) return 250;
  if (l === 3) return 500;
  if (l === 4) return 1000;
  return 2000;
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

  // Handles values such as 1, "1", or "Level 1: TL;DR" const levelMatch = String(summaryLevel).match(/[1-5]/); const level = levelMatch ? Number(levelMatch[0]) : 3;

  const targetLangInstruction = isArabicTarget
    ? 'Write in fluent, natural Arabic using simple, direct phrasing.'
    : 'Write in clear, natural English. Translate key concepts when necessary.';

  const instructionsByLevel = {
    1: {
      bullets:
        'Return EXACTLY 1 or 2 extremely short bullet points, with no more than 25 words total.',
      key_takeaways:
        'Return EXACTLY 1 key takeaway, with no more than 20 words total.',
      paragraph:
        'Return EXACTLY 1 sharp sentence, with no more than 20 words total.'
    },
    2: {
      bullets:
        'Return 2 to 3 concise bullet points, with no more than 50 words total.',
      key_takeaways:
        'Return 2 to 3 concise takeaways, with no more than 50 words total.',
      paragraph:
        'Return 2 to 3 concise sentences, with no more than 50 words total.'
    },
    3: {
      bullets:
        'Return 4 to 5 concise bullet points, with no more than 120 words total.',
      key_takeaways:
        'Return 3 to 4 key takeaways, with no more than 120 words total.',
      paragraph:
        'Return one structured paragraph of 4 to 6 sentences, with no more than 120 words total.'
    },
    4: {
      bullets:
        'Return 6 to 8 informative bullet points, with no more than 220 words total.',
      key_takeaways:
        'Return 5 to 7 key insights, with no more than 220 words total.',
      paragraph:
        'Return 2 to 3 structured paragraphs, with no more than 250 words total.'
    },
    5: {
      bullets:
        'Return a comprehensive breakdown of 8 to 12 bullet points, with no more than 400 words total.',
      key_takeaways:
        'Return 7 to 10 comprehensive takeaways, with no more than 400 words total.',
      paragraph:
        'Return a comprehensive summary in 3 to 5 structured paragraphs, with no more than 450 words total.'
    }
  };

  const formatInstruction =
    instructionsByLevel[level][summaryFormat] ||
    instructionsByLevel[level].paragraph;

  let scanabilityInstruction;

  if (summaryFormat === 'bullets') {
    scanabilityInstruction = `
- Output bullet points only. Do not add an opening summary, heading, or conclusion.
- Cover one distinct idea per bullet.
- Order the bullets from most important to least important.
- For Levels 2–5, begin each bullet with a short **2–5 word label**, followed by a concise explanation.
- Bold only the short label. Never bold complete sentences or long clauses.
- Keep bullets similar in length and generally under 22 words each.
- Avoid sub-bullets, except when absolutely necessary at Level 5.
`;
  } else if (summaryFormat === 'key_takeaways') {
    scanabilityInstruction = `
- Output takeaways only. Do not add an introduction, heading, or conclusion.
- Begin each takeaway with a short **2–5 word title**.
- Follow the title with one concise sentence explaining the insight.
- Bold only the title, not the explanation.
- Do not repeat the same conclusion across multiple takeaways.
`;
  } else {
    scanabilityInstruction = `
- Use one idea per sentence.
- Lead with the main conclusion.
- Arrange supporting points in descending order of importance.
- Bold no more than two short phrases in the entire summary.
- Do not use a heading or prepend labels such as "TL;DR:".
`;
  }

  return {
    isArabicTarget,
    prompt: `You are an expert video summarizer. Produce a summary that can be understood in a few seconds and read comfortably in full.

Title/context: "${videoTitle || 'YouTube Video'}"

OUTPUT REQUIREMENTS:
1. ${formatInstruction}
2. ${targetLangInstruction} ${scanabilityInstruction}
3. State insights directly. Never write phrases such as "In this video", "The speaker says", or "The transcript explains".
4. Preserve important distinctions, conclusions, numbers, and caveats from the source.
5. Remove repetition, filler, anecdotes, and examples unless they materially support the conclusion.
6. Avoid long parenthetical remarks and unnecessary qualifiers.
7. Do not introduce facts or conclusions that are not supported by the transcript.
8. Return only the requested summary.
9. Check the number of bullets, sentences, and words before answering. Treat all limits as strict.

Transcript:
"""
${transcript.slice(0, 30000)}
"""`.trim()
  };
}

/**
 * Gemini API Summarizer
 */
async function summarizeGemini(transcript, apiKey, language, videoTitle, summaryLevel, summaryFormat) {
  const { prompt } = buildPrompt(transcript, language, videoTitle, summaryLevel, summaryFormat);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: getMaxTokens(summaryLevel)
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
      max_tokens: getMaxTokens(summaryLevel)
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
      max_tokens: getMaxTokens(summaryLevel)
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
      max_tokens: getMaxTokens(summaryLevel),
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

  const modelsToTry = ['~google/gemini-flash-latest', 'google/gemini-flash-latest', 'google/gemini-2.5-flash'];
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
          temperature: 0.3,
          max_tokens: getMaxTokens(summaryLevel)
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
