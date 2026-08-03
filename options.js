const DEFAULT_SETTINGS = {
  clipscriptApiKey: '',
  aiProvider: 'gemini',
  aiApiKey: '',
  summaryLanguage: 'en',
  summaryLevel: 3,
  summaryFormat: 'paragraph',
  autoSummarizeWatch: false,
  showFeedButtons: true,
  obsidianEnabled: false,
  obsidianVault: ''
};

const LEVEL_LABELS = {
  1: '⚡ Level 1: Ultra Short (TL;DR Sentence)',
  2: '📝 Level 2: Short (2-3 Sentences)',
  3: '🎯 Level 3: Standard (1 Paragraph)',
  4: '📚 Level 4: Detailed (2-3 Paragraphs)',
  5: '🔬 Level 5: Deep Dive (In-depth Breakdown)'
};

let currentSelectedFormat = 'paragraph';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  document.getElementById('clipscript-key').value = settings.clipscriptApiKey || '';
  document.getElementById('ai-provider').value = settings.aiProvider || 'gemini';
  document.getElementById('ai-key').value = settings.aiApiKey || '';
  document.getElementById('summary-lang').value = settings.summaryLanguage || 'en';

  const slider = document.getElementById('summary-level-slider');
  slider.value = settings.summaryLevel || 3;
  updateLevelBadge(slider.value);

  currentSelectedFormat = settings.summaryFormat || 'paragraph';
  updateFormatPickerButtons(currentSelectedFormat);

  document.getElementById('auto-summarize-watch').checked = !!settings.autoSummarizeWatch;
  document.getElementById('show-feed-buttons').checked = settings.showFeedButtons !== false;
  document.getElementById('obsidian-enabled').checked = !!settings.obsidianEnabled;
  document.getElementById('obsidian-vault').value = settings.obsidianVault || '';

  updateAiKeyVisibility();
  updateObsidianVaultVisibility();

  // Event Listeners
  document.getElementById('ai-provider').addEventListener('change', updateAiKeyVisibility);
  document.getElementById('obsidian-enabled').addEventListener('change', updateObsidianVaultVisibility);
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('test-clipscript-btn').addEventListener('click', testClipscriptKey);
  document.getElementById('test-obsidian-btn').addEventListener('click', testObsidianVault);

  slider.addEventListener('input', (e) => {
    updateLevelBadge(e.target.value);
  });

  const formatBtns = document.querySelectorAll('.format-btn');
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentSelectedFormat = btn.dataset.format;
      updateFormatPickerButtons(currentSelectedFormat);
    });
  });
});

function updateFormatPickerButtons(selectedFormat) {
  const formatBtns = document.querySelectorAll('.format-btn');
  formatBtns.forEach(btn => {
    if (btn.dataset.format === selectedFormat) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateLevelBadge(val) {
  const badge = document.getElementById('level-badge');
  if (badge) {
    badge.textContent = LEVEL_LABELS[val] || `Level ${val}`;
  }
}

function updateAiKeyVisibility() {
  const provider = document.getElementById('ai-provider').value;
  const keyGroup = document.getElementById('ai-key-group');
  const helpText = document.getElementById('ai-key-help');

  keyGroup.style.display = 'flex';
  if (provider === 'gemini') {
    helpText.innerHTML = 'Get a free Gemini API key from <a href="https://aistudio.google.com" target="_blank">Google AI Studio</a>.';
  } else if (provider === 'openai') {
    helpText.innerHTML = 'Get an OpenAI API key from <a href="https://platform.openai.com" target="_blank">OpenAI Platform</a>.';
  } else if (provider === 'groq') {
    helpText.innerHTML = 'Get a Groq API key from <a href="https://console.groq.com" target="_blank">Groq Console</a>.';
  } else if (provider === 'anthropic') {
    helpText.innerHTML = 'Get an Anthropic key from <a href="https://console.anthropic.com" target="_blank">Anthropic Console</a>.';
  } else if (provider === 'openrouter') {
    helpText.innerHTML = 'Get an OpenRouter key from <a href="https://openrouter.ai" target="_blank">OpenRouter</a>.';
  }
}

function updateObsidianVaultVisibility() {
  const enabled = document.getElementById('obsidian-enabled').checked;
  const vaultGroup = document.getElementById('obsidian-vault-group');
  if (vaultGroup) {
    vaultGroup.style.display = enabled ? 'flex' : 'none';
  }
}

async function saveSettings() {
  const slider = document.getElementById('summary-level-slider');
  const obsidianEnabled = document.getElementById('obsidian-enabled').checked;
  const obsidianVault = document.getElementById('obsidian-vault').value.trim();

  if (obsidianEnabled && !obsidianVault) {
    alert('Enter your Obsidian vault name, or turn off Save to Obsidian.');
    return;
  }

  const newSettings = {
    clipscriptApiKey: document.getElementById('clipscript-key').value.trim(),
    aiProvider: document.getElementById('ai-provider').value,
    aiApiKey: document.getElementById('ai-key').value.trim(),
    summaryLanguage: document.getElementById('summary-lang').value,
    summaryLevel: Number(slider.value) || 3,
    summaryFormat: currentSelectedFormat,
    autoSummarizeWatch: document.getElementById('auto-summarize-watch').checked,
    showFeedButtons: document.getElementById('show-feed-buttons').checked,
    obsidianEnabled,
    obsidianVault
  };

  await chrome.storage.local.set(newSettings);
  showToast('Settings saved successfully!');
}

async function testClipscriptKey() {
  const apiKey = document.getElementById('clipscript-key').value.trim();
  const btn = document.getElementById('test-clipscript-btn');

  if (!apiKey) {
    alert('Please enter a Clipscript API key first.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const res = await fetch('https://clipscript.uk/api/v1/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
      })
    });

    if (res.status === 200 || res.status === 202) {
      alert('✅ Clipscript API key is VALID and working!');
    } else {
      const text = await res.text();
      alert(`❌ Clipscript API Key test failed (HTTP ${res.status}): ${text}`);
    }
  } catch (err) {
    alert(`❌ Connection error: ${err.message || String(err)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Key';
  }
}

function testObsidianVault() {
  const vault = document.getElementById('obsidian-vault').value.trim();

  if (!vault) {
    alert('Enter your Obsidian vault name first.');
    return;
  }

  // Build + launch synchronously inside the click handler so Chrome keeps the
  // user gesture (needed for the first OS "Open Obsidian?" prompt).
  const uri = `obsidian://open?vault=${encodeURIComponent(vault)}`;

  try {
    launchObsidianUri(uri);
  } catch (err) {
    alert(`❌ Could not open Obsidian: ${err.message || String(err)}`);
    return;
  }

  alert(
    'Sent the vault open request to Obsidian.\n\n' +
    '✅ If Obsidian switches to that vault, the name is correct.\n' +
    '❌ If nothing happens / no prompt, paste this into Chrome\'s address bar and hit Enter:\n\n' +
    uri +
    '\n\nThat also registers the handler if macOS never asked. If Obsidian says the vault was not found, fix the name (vault switcher, bottom-left).'
  );
}

function launchObsidianUri(uri) {
  const target = String(uri || '').trim();
  if (!target.startsWith('obsidian://')) {
    throw new Error('Invalid Obsidian URI.');
  }

  const anchor = document.createElement('a');
  anchor.href = target;
  anchor.rel = 'noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}
