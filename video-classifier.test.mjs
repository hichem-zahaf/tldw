import assert from 'node:assert/strict';
import {
  CLASSIFIER_MODELS,
  buildClassificationCacheKey,
  buildClassifyPrompt,
  buildClassifyRequest,
  buildThumbnailUrls,
  classifyVideo,
  extractClassifyResponseText,
  heuristicClassification,
  parseClassification,
  resolveThumbnailUrl
} from './video-classifier.js';

const THUMB = 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg';

{
  const prompt = buildClassifyPrompt('Does creatine actually work?');
  assert.match(prompt, /Does creatine actually work\?/);
  assert.match(prompt, /"thumbnail_text"/);
  assert.match(prompt, /"has_promise"/);
  // thumbnail_text comes first so the model commits to what it read before
  // interpreting the promise.
  assert.ok(prompt.indexOf('"thumbnail_text"') < prompt.indexOf('"hook"'));
}

{
  const { url, init } = buildClassifyRequest({
    provider: 'gemini',
    apiKey: 'key123',
    videoTitle: 'Test',
    thumbnailUrl: THUMB
  });

  assert.match(url, new RegExp(CLASSIFIER_MODELS.gemini));
  assert.match(url, /key=key123/);
  const body = JSON.parse(init.body);
  assert.equal(body.contents[0].parts[1].file_data.file_uri, THUMB);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
}

{
  const { url, init } = buildClassifyRequest({
    provider: 'openai',
    apiKey: 'key123',
    videoTitle: 'Test',
    thumbnailUrl: THUMB
  });

  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  const body = JSON.parse(init.body);
  assert.equal(body.model, CLASSIFIER_MODELS.openai);
  // low/high resize before analysis and lose stylized overlay text.
  assert.equal(body.messages[0].content[1].image_url.detail, 'original');
  assert.equal(init.headers.Authorization, 'Bearer key123');
}

{
  for (const provider of ['groq', 'openrouter']) {
    const { url, init } = buildClassifyRequest({
      provider,
      apiKey: 'key123',
      videoTitle: 'Test',
      thumbnailUrl: THUMB
    });

    assert.match(url, provider === 'groq' ? /api\.groq\.com/ : /openrouter\.ai/);
    const body = JSON.parse(init.body);
    assert.equal(body.model, CLASSIFIER_MODELS[provider]);
    assert.equal(body.messages[0].content[1].image_url.url, THUMB);
    assert.equal(body.temperature, 0);
  }
}

{
  const { url, init } = buildClassifyRequest({
    provider: 'anthropic',
    apiKey: 'key123',
    videoTitle: 'Test',
    thumbnailUrl: THUMB
  });

  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(init.body);
  assert.equal(body.model, CLASSIFIER_MODELS.anthropic);
  // Claude reads images better when they precede the instruction.
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.url, THUMB);
}

{
  assert.throws(
    () => buildClassifyRequest({ provider: 'nope', apiKey: 'k', thumbnailUrl: THUMB }),
    /Unsupported AI provider/
  );
}

{
  assert.equal(extractClassifyResponseText('gemini', {
    candidates: [{ content: { parts: [{ text: 'g' }] } }]
  }), 'g');
  assert.equal(extractClassifyResponseText('anthropic', { content: [{ text: 'a' }] }), 'a');
  assert.equal(extractClassifyResponseText('groq', {
    choices: [{ message: { content: 'c' } }]
  }), 'c');
  assert.equal(extractClassifyResponseText('gemini', {}), '');
}

{
  const parsed = parseClassification(
    '```json\n{"thumbnail_text":"I QUIT","type":"story","hook":"Was quitting worth it?","has_promise":true}\n```',
    'My title'
  );

  assert.equal(parsed.thumbnailText, 'I QUIT');
  assert.equal(parsed.type, 'story');
  assert.equal(parsed.hook, 'Was quitting worth it?');
  assert.equal(parsed.hasPromise, true);
  assert.equal(parsed.source, 'model');
}

{
  // A promise with nothing named is not a promise we can grade.
  const parsed = parseClassification('{"type":"news","hook":"","has_promise":true}');
  assert.equal(parsed.hasPromise, false);

  // Unknown types fall back based on whether anything was promised.
  assert.equal(parseClassification('{"type":"weird","hook":"X?","has_promise":true}').type, 'question');
  assert.equal(parseClassification('{"type":"weird","hook":"","has_promise":false}').type, 'explainer');
}

{
  assert.equal(parseClassification(''), null);
  assert.equal(parseClassification('sorry, I cannot help'), null);
  assert.equal(parseClassification('{not json}'), null);
}

{
  assert.equal(heuristicClassification('Is this worth it?').type, 'question');
  assert.equal(heuristicClassification('How to bake bread').type, 'howto');
  assert.equal(heuristicClassification('iPhone 20 review').type, 'review');

  const plain = heuristicClassification('A day in Tokyo');
  assert.equal(plain.type, 'explainer');
  assert.equal(plain.hasPromise, false);
  assert.equal(plain.source, 'heuristic');
}

{
  // Level, format, language and provider are all absent by design: toggling
  // any of them must reuse the cached classification, not pay for a new one.
  assert.equal(buildClassificationCacheKey('abc123'), 'vclass_abc123_v1');
  assert.notEqual(buildClassificationCacheKey('abc123'), buildClassificationCacheKey('xyz789'));
}

{
  const urls = buildThumbnailUrls('abc123');
  assert.equal(urls.preferred, THUMB);
  assert.equal(urls.fallback, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');

  assert.equal(await resolveThumbnailUrl('abc123', async () => ({ ok: true })), THUMB);

  // maxresdefault only exists for HD uploads, so fall back to hqdefault.
  assert.equal(
    await resolveThumbnailUrl('abc123', async (url) => ({ ok: url.includes('hqdefault') })),
    'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
  );

  // Some videos have neither. Handing the provider a URL that 404s on its side
  // fails the whole call, so report no thumbnail instead.
  assert.equal(await resolveThumbnailUrl('abc123', async () => ({ ok: false })), '');
  assert.equal(
    await resolveThumbnailUrl('abc123', async () => { throw new Error('offline'); }),
    ''
  );
  assert.equal(await resolveThumbnailUrl('', async () => ({ ok: true })), '');
}

{
  // Without a thumbnail the model still classifies, just from the title.
  const prompt = buildClassifyPrompt('Some title', { hasThumbnail: false });
  assert.match(prompt, /always an empty string, since no thumbnail is available/);
  assert.doesNotMatch(prompt, /Read the thumbnail text before deciding/);

  const gemini = JSON.parse(buildClassifyRequest({
    provider: 'gemini', apiKey: 'k', videoTitle: 'Some title', thumbnailUrl: ''
  }).init.body);
  assert.equal(gemini.contents[0].parts.length, 1);

  for (const provider of ['openai', 'groq', 'openrouter']) {
    const body = JSON.parse(buildClassifyRequest({
      provider, apiKey: 'k', videoTitle: 'Some title', thumbnailUrl: ''
    }).init.body);
    assert.equal(body.messages[0].content.length, 1, provider);
  }

  const anthropic = JSON.parse(buildClassifyRequest({
    provider: 'anthropic', apiKey: 'k', videoTitle: 'Some title', thumbnailUrl: ''
  }).init.body);
  assert.equal(anthropic.messages[0].content.length, 1);
  assert.equal(anthropic.messages[0].content[0].type, 'text');
}

{
  // No key: never attempt a network call.
  let called = false;
  const result = await classifyVideo({
    provider: 'gemini',
    apiKey: '',
    videoTitle: 'Should you buy this?',
    fetchImpl: async () => { called = true; }
  });

  assert.equal(called, false);
  assert.equal(result.source, 'heuristic');
  assert.equal(result.type, 'question');
}

{
  const result = await classifyVideo({
    provider: 'gemini',
    apiKey: 'key123',
    videoId: 'abc123',
    videoTitle: 'Does it work?',
    fetchImpl: async (url, init) => {
      if (init?.method === 'HEAD') return { ok: true };
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: '{"thumbnail_text":"IT WORKS","type":"question","hook":"Does it work?","has_promise":true}' }]
            }
          }]
        })
      };
    }
  });

  assert.equal(result.source, 'model');
  assert.equal(result.hook, 'Does it work?');
  assert.equal(result.thumbnailText, 'IT WORKS');
}

{
  // A failing provider must never break summarization.
  const result = await classifyVideo({
    provider: 'gemini',
    apiKey: 'key123',
    videoId: 'abc123',
    videoTitle: 'How to bake bread',
    fetchImpl: async (url, init) => {
      if (init?.method === 'HEAD') return { ok: true };
      return { ok: false, status: 429, text: async () => 'rate limited' };
    }
  });

  assert.equal(result.source, 'heuristic');
  assert.equal(result.type, 'howto');
}

console.log('video-classifier.test.mjs passed');
