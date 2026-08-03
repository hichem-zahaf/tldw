import assert from 'node:assert/strict';
import {
  OBSIDIAN_URI_SAFE_LENGTH,
  applyInlineHighlight,
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
  assert.equal(
    applyInlineHighlight('Hello key insight world', 'key insight'),
    'Hello ==key insight== world'
  );
  // Selection collapses whitespace; match against the source markdown flexibly.
  assert.equal(
    applyInlineHighlight('Hello key\ninsight world', 'key insight'),
    'Hello ==key\ninsight== world'
  );
  assert.equal(
    applyInlineHighlight('already ==key insight== wrapped', 'key insight'),
    'already ==key insight== wrapped'
  );
  assert.equal(
    applyInlineHighlight('no match here', 'missing'),
    'no match here'
  );
}

{
  const md = buildObsidianNoteMarkdown({
    videoTitle: 'Demo Video',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    summary: 'Full summary with the key insight inside.',
    highlight: 'the key insight',
    date: '2026-08-03'
  });

  assert.match(md, /## Summary\n\nFull summary with ==the key insight== inside\.\n$/);
  assert.doesNotMatch(md, /\*\*the key insight\*\*/);
  // Highlight stays in the summary body — never duplicated above it.
  assert.ok(md.indexOf('==the key insight==') > md.indexOf('## Summary'));
}

{
  const md = buildObsidianNoteMarkdown({
    videoTitle: 'Demo Video',
    videoUrl: 'https://youtu.be/abc123',
    summary: 'HOOK: Does it work?\nRATING: 2\nLEAD: Partly, and only above 40C.\n---\n- Detail one.',
    videoType: 'question',
    highlight: 'only above 40C',
    date: '2026-08-03'
  });

  assert.match(md, /## The question\n\n> Does it work\?/);
  assert.match(md, /\*\*Verdict:\*\* ★★☆ Partly answers it \(2\/3\)/);
  // Highlighting happens before the block is split, so a selection in the lead
  // still lands in the right section.
  assert.match(md, /## The answer\n\nPartly, and ==only above 40C==\./);
  assert.match(md, /## Summary\n\n- Detail one\.\n$/);
  assert.doesNotMatch(md, /HOOK:|RATING:|LEAD:/);
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
