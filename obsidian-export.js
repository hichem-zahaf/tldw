/** Safe ceiling for obsidian:// URIs before falling back to clipboard content. */
export const OBSIDIAN_URI_SAFE_LENGTH = 12000;

export function sanitizeNoteTitle(title, fallback = 'Untitled') {
  const cleaned = String(title || '')
    .replace(/[\\/?:*"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function buildObsidianNotePath(title, fallbackId = '') {
  return `TLDW/${sanitizeNoteTitle(title, fallbackId || 'Untitled')}`;
}

export function formatObsidianDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildObsidianNoteMarkdown({
  videoTitle,
  videoUrl,
  summary,
  highlight = '',
  date
} = {}) {
  const title = String(videoTitle || '').trim() || 'Untitled';
  const dateStr = date || formatObsidianDate();
  const sourceUrl = String(videoUrl || '').trim();
  const summaryText = String(summary || '').trim();
  const highlightText = String(highlight || '').trim();

  // No H1: the filename is the note title, and Obsidian renders it inline.
  const lines = [
    `Watched: [[${dateStr}]]`,
    sourceUrl ? `Source: [${title}](${sourceUrl})` : `Source: ${title}`,
    ''
  ];

  if (highlightText) {
    lines.push(`**${highlightText}**`, '');
  }

  lines.push('## Summary', '', summaryText, '');
  return lines.join('\n');
}

export function buildObsidianOpenVaultUri(vault) {
  const vaultName = String(vault || '').trim();
  if (!vaultName) {
    throw new Error('Obsidian vault name is required.');
  }
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}`;
}

export function buildObsidianNewUri({
  vault,
  filePath,
  content = '',
  useClipboard = false
} = {}) {
  const vaultName = String(vault || '').trim();
  const file = String(filePath || '').trim();
  if (!vaultName) {
    throw new Error('Obsidian vault name is required.');
  }
  if (!file) {
    throw new Error('Obsidian note path is required.');
  }

  const parts = [
    `vault=${encodeURIComponent(vaultName)}`,
    `file=${encodeURIComponent(file)}`,
    'paneType=tab',
    'overwrite'
  ];

  if (useClipboard) {
    parts.push('clipboard');
  } else {
    parts.push(`content=${encodeURIComponent(String(content || ''))}`);
  }

  return `obsidian://new?${parts.join('&')}`;
}

export function planObsidianExport({
  vault,
  videoTitle,
  videoId = '',
  videoUrl = '',
  summary = '',
  highlight = '',
  date,
  safeUriLength = OBSIDIAN_URI_SAFE_LENGTH
} = {}) {
  const filePath = buildObsidianNotePath(videoTitle, videoId);
  const markdown = buildObsidianNoteMarkdown({
    videoTitle,
    videoUrl,
    summary,
    highlight,
    date
  });

  const uriWithContent = buildObsidianNewUri({
    vault,
    filePath,
    content: markdown
  });

  if (uriWithContent.length <= safeUriLength) {
    return {
      filePath,
      markdown,
      uri: uriWithContent,
      useClipboard: false
    };
  }

  return {
    filePath,
    markdown,
    uri: buildObsidianNewUri({
      vault,
      filePath,
      useClipboard: true
    }),
    useClipboard: true
  };
}
