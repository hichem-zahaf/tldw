import assert from 'node:assert/strict';
import {
  OBSIDIAN_URI_SAFE_LENGTH,
  buildObsidianNewUri,
  buildObsidianOpenVaultUri,
  buildObsidianNoteMarkdown,
  buildObsidianNotePath,
  formatObsidianDate,
  planObsidianExport,
  sanitizeNoteTitle
} from './obsidian-export.js';

{
  assert.equal(sanitizeNoteTitle('Hello: World / Test?'), 'Hello World Test');
  assert.equal(sanitizeNoteTitle(''), 'Untitled');
  assert.equal(sanitizeNoteTitle(':::'), 'Untitled');
  assert.equal(buildObsidianNotePath('Foo: Bar', 'abc123'), 'TLDW/Foo Bar');
  assert.equal(buildObsidianNotePath('', 'abc123'), 'TLDW/abc123');
}

{
  const date = new Date(2026, 7, 3); // local Aug 3, 2026
  assert.equal(formatObsidianDate(date), '2026-08-03');
}

{
  const md = buildObsidianNoteMarkdown({
    videoTitle: 'Demo Video',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    summary: '- Point one\n- Point two',
    date: '2026-08-03'
  });

  assert.match(
    md,
    /^Watched: \[\[2026-08-03\]\]\nSource: \[Demo Video\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123\)\n\n/
  );
  assert.match(md, /## Summary\n\n- Point one\n- Point two\n$/);
  assert.doesNotMatch(md, /\*\*/);
  // The filename is the title; an H1 would duplicate Obsidian's inline title.
  assert.doesNotMatch(md, /^#\s/m);
}

{
  const md = buildObsidianNoteMarkdown({
    videoTitle: 'Demo Video',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    summary: 'Full summary body',
    highlight: 'the key insight',
    date: '2026-08-03'
  });

  assert.match(md, /\*\*the key insight\*\*/);
  assert.match(md, /## Summary\n\nFull summary body\n$/);
  assert.ok(md.indexOf('**the key insight**') < md.indexOf('## Summary'));
}

{
  assert.equal(
    buildObsidianOpenVaultUri('My Vault'),
    'obsidian://open?vault=My%20Vault'
  );
  assert.throws(() => buildObsidianOpenVaultUri(''), /vault name is required/i);
}

{
  const uri = buildObsidianNewUri({
    vault: 'My Vault',
    filePath: 'TLDW/Demo Video',
    content: '# Demo\n'
  });

  assert.ok(uri.startsWith('obsidian://new?'));
  assert.match(uri, /vault=My%20Vault/);
  assert.match(uri, /file=TLDW%2FDemo%20Video/);
  assert.match(uri, /paneType=tab/);
  assert.match(uri, /(?:^|&)overwrite(?:&|$)/);
  assert.match(uri, /content=/);
  assert.doesNotMatch(uri, /(?:^|&)clipboard(?:&|$)/);
}

{
  const uri = buildObsidianNewUri({
    vault: 'Vault',
    filePath: 'TLDW/Note',
    useClipboard: true
  });

  assert.match(uri, /(?:^|&)clipboard(?:&|$)/);
  assert.doesNotMatch(uri, /content=/);
}

{
  const planned = planObsidianExport({
    vault: 'Vault',
    videoTitle: 'Short',
    videoId: 'id1',
    videoUrl: 'https://youtu.be/id1',
    summary: 'Tiny',
    date: '2026-08-03'
  });

  assert.equal(planned.useClipboard, false);
  assert.equal(planned.filePath, 'TLDW/Short');
  assert.ok(planned.uri.includes('content='));
}

{
  const hugeSummary = 'x'.repeat(OBSIDIAN_URI_SAFE_LENGTH);
  const planned = planObsidianExport({
    vault: 'Vault',
    videoTitle: 'Long',
    videoId: 'id2',
    summary: hugeSummary,
    date: '2026-08-03',
    safeUriLength: 500
  });

  assert.equal(planned.useClipboard, true);
  assert.match(planned.uri, /(?:^|&)clipboard(?:&|$)/);
  assert.ok(planned.markdown.includes(hugeSummary));
}

console.log('obsidian-export.test.mjs passed');
