# ⚡ TL;DW - YouTube AI Summarizer

**TL;DW** (*Too Long; Didn't Watch*) is a fast, lightweight, and modern Chrome Extension (Manifest V3) that summarizes YouTube videos in seconds. It uses **Clipscript.uk** for high-speed transcription and your choice of **AI Provider** (Google Gemini, OpenAI, Groq, Anthropic, or OpenRouter) to generate beautifully rendered summaries directly on YouTube.

---

## ✨ Features

- 🎯 **Embedded Summary Box**: Injects a clean, native-feeling summary card right above the description on any YouTube video (`youtube.com/watch?v=...`).
- ⭐ **Answer-First Summaries**: Reads the thumbnail and title to work out what the video promised, then leads with the answer and rates how well the video delivers on a 1–3 star scale. Videos that promise nothing specific (vlogs, music, comedy) just get a plain summary. Toggle it off in Settings to skip the image call.
- ⚡ **Batch Feed Summaries**: Adds a `⚡ Summarize` button under thumbnails across YouTube Home, Search, and Recommendations, then tracks queued/running/done summaries in a persistent top-right queue.
- 🎚️ **5-Level Detail Slider**: Tailor summary depth on the fly:
  - **Level 1 (TL;DR)**: 1-sentence executive summary
  - **Level 2 (Short)**: 2–3 concise sentences
  - **Level 3 (Standard)**: 1 balanced paragraph
  - **Level 4 (Detailed)**: 2–3 thorough paragraphs
  - **Level 5 (Deep Dive)**: Full topic breakdown
- 📑 **Multiple Formats**: Switch between **Paragraph Prose** (📝), **Bullet Points** (📑), and **Key Takeaways** (💡).
- 🎨 **Apple SF Pro Aesthetic**: Modern dark/light UI with Apple SF Pro typography, glassmorphism, and markdown formatting (`**bold**`, lists, code blocks).
- 🌐 **Smart Translation & Language Control**: Automatically extracts native video transcripts (Arabic, English, French, etc.) and translates summaries to English or your target language.
- 🤖 **Multiple AI Providers**:
  - **Google Gemini 1.5 Flash** *(Recommended — Free API key from Google AI Studio)*
  - **OpenAI GPT-4o-mini**
  - **Groq (Llama 3.3 70B)**
  - **Anthropic Claude Haiku 4.5**
  - **OpenRouter** *(Gemini 2.5 Flash / Flash Latest)*
- ⚡ **Instant Caching**: Saves generated summaries in extension storage to prevent redundant API calls and save quota.
- 📄 **Full Transcript Inspector**: View the raw transcript in a collapsible inspector pane whenever you want to dig into the source text.
- 📓 **Optional Obsidian Export**: Bookmark a full summary or highlight selected text into `TLDW/{video title}.md` in your Obsidian vault (opens the note for your own comments).

---

## 🚀 Quick Setup & Installation

### 1. Download / Clone Repository
```bash
git clone https://github.com/yazinsai/tldw.git
```

### 2. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `tldw` repository folder.
5. The **TL;DW** icon ⚡ will appear in your Chrome toolbar!

### 3. Configure API Keys
1. Click the ⚡ extension icon in your Chrome toolbar and select **⚙️ Settings** (or go to `chrome://extensions` -> **Details** -> **Extension options**).
2. Enter your **Clipscript API Key** (get one at [clipscript.uk](https://clipscript.uk)). Click **Test Key** to verify.
3. Select your **AI Provider** (e.g., Google Gemini) and paste your API key (get a free Gemini key at [Google AI Studio](https://aistudio.google.com)).
4. Click **Save Settings**.

---

## 💻 Usage

- **Watch Page**: Open any YouTube video. The `⚡ TL;DW` summary container appears automatically. Click **✨ Summarize Video** or adjust format/level controls.
- **Feed Cards**: On the YouTube Home page or search results, click `⚡ Summarize` below any video card to add it to the summary queue. Open the top-right `TL;DW Queue` tray to review running and completed summaries together.
- **Extension Popup**: Click the toolbar extension icon on any active YouTube tab to quickly check cache or generate a summary with custom level/format settings.
- **Obsidian (optional)**: In Settings, enable Save to Obsidian and enter your vault name. On a summary, click ★ to bookmark the full note, or select text and click **Save highlight**. Notes land at `TLDW/{video title}.md` with a `[[YYYY-MM-DD]]` date link; highlights wrap the selected text in-place with `==…==`.

---

## 📁 Repository Structure

```
tldw/
├── manifest.json       # Manifest V3 extension configuration
├── background.js       # Background service worker (Clipscript API, caching)
├── summarizer.js       # AI summarization module (Gemini, OpenAI, Groq, Anthropic, OpenRouter)
├── summary-prompts.js  # Prompt variants, per-video-type profiles, answer block contract
├── video-classifier.js # Thumbnail + title classification (video type, promise, hook)
├── summary-answer.js   # Parses the answer block out of a summary, formats it for copy/export
├── content.js          # Injected content script for YouTube watch page & feed cards
├── content.css         # Styling for embedded YouTube UI elements
├── popup.html          # Toolbar extension popup UI
├── popup.js            # Popup logic
├── popup.css           # Popup styling
├── options.html        # Settings page UI
├── options.js          # Settings logic
├── options.css         # Settings styling
├── icons/              # Extension icons (16px, 48px, 128px)
└── README.md           # Documentation
```

---

## 📄 License

MIT License. Feel free to fork, customize, and contribute!
