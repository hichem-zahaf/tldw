# Chrome Web Store Listing

## Product details

**Name:** TL;DW - YouTube AI Summarizer

**Summary:** Summarize YouTube videos with your preferred AI provider, format, language, and level of detail.

**Category:** Productivity

**Language:** English

## Detailed description

Turn long YouTube videos into useful summaries without leaving the page.

TL;DW adds a summary panel to YouTube watch pages and optional Summarize buttons to video feeds. Choose paragraph, bullet, or key-takeaway formats; select one of five detail levels; and generate summaries in English, Arabic, or the video's language. A persistent queue lets you summarize several feed videos while you continue browsing.

You bring your own Clipscript transcription key and your choice of Google Gemini, OpenAI, Groq, Anthropic, or OpenRouter API key. Keys and cached results stay in local Chrome extension storage. Video transcript content is sent only to the services needed to fulfill a summary request.

Highlights:

- Summary panel embedded in YouTube
- Batch summary queue for feed videos
- Five configurable detail levels
- Paragraph, bullet, and key-takeaway formats
- English, Arabic, and automatic language modes
- Choice of five AI providers
- Local summary caching
- No advertising or analytics SDKs

An account and API key from Clipscript and the selected AI provider are required. Provider usage charges may apply.

## Single purpose

TL;DW's single purpose is to transcribe and summarize YouTube videos in the browser.

## Permission justifications

**storage:** Stores user-entered API keys, preferences, summary queues, transcripts, and cached summaries locally so settings persist and repeated requests are avoided.

**activeTab:** Lets the popup identify the active YouTube video after the user invokes the extension, so it can check or generate that video's summary.

**Host access to YouTube:** Injects the summary interface and feed buttons on YouTube pages, identifies the selected video, and retrieves native transcript data when available.

**Host access to Clipscript:** Sends the selected YouTube URL to the transcription service and polls for the resulting transcript.

**Host access to Google Gemini, OpenAI, Groq, Anthropic, and OpenRouter:** Sends transcript text to the AI provider explicitly selected by the user and receives the generated summary.

## Privacy disclosures

**Data handled:**

- Authentication information: user-provided Clipscript and AI-provider API keys.
- Website content: YouTube video URLs, titles, transcripts, and generated summaries.
- User settings and extension activity: summary preferences, queue state, cache state, and operational errors.

**Certified uses:**

- Data is used only for the extension's user-facing functionality.
- Data is not sold to third parties.
- Data is not used or transferred for personalized advertising.
- Data is not used or transferred for purposes unrelated to the extension's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending purposes.

**Privacy policy URL after this file is pushed to the public repository:**

<https://github.com/yazinsai/tldw/blob/main/PRIVACY.md>

## Review notes

1. Install the extension and open its Settings page.
2. Enter valid Clipscript and AI-provider API keys, then save.
3. Open a YouTube watch page and click **Summarize Video**, or click a feed card's **Summarize** button.
4. The extension sends the video URL to Clipscript, then sends the resulting transcript to the selected AI provider.
5. No reviewer credentials are embedded in the extension. If the reviewer requires test credentials, provide temporary keys only in the dashboard's secure reviewer-instructions field.
