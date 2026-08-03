# TL;DW Privacy Policy

Effective date: August 3, 2026

TL;DW is a Chrome extension that summarizes YouTube videos. This policy explains what data the extension handles and why.

## Data the extension handles

- API credentials: the Clipscript API key and AI-provider API key that you enter in the settings page.
- YouTube content: the current video's URL, ID, title, transcript, and the summary generated from that transcript.
- Preferences: your selected provider, language, detail level, format, automatic-summary setting, feed-button setting, and optional Obsidian export settings (enabled flag and vault name).
- Queue and cache data: queued videos, progress, transcripts, summaries, and errors needed to provide batch summaries and avoid duplicate requests.

## How data is used

The extension uses this data only to provide its video-transcription, summarization, settings, queue, and caching features. It does not use analytics or advertising SDKs, sell data, use data for credit decisions, or transfer data for purposes unrelated to the extension's single purpose.

## Storage

API credentials, preferences, queue items, transcripts, and summaries are stored locally in Chrome extension storage on your device. The extension does not use Chrome Sync. Cached summaries can be removed with **Clear Cache** in the extension popup. Removing the extension deletes its local Chrome extension storage.

## Data shared with service providers

When you request a summary:

- The YouTube video URL and your Clipscript API key are sent to Clipscript so it can obtain the transcript.
- The transcript, video title, summary instructions, and your AI-provider API key are sent to the provider you selected: Google Gemini, OpenAI, Groq, Anthropic, or OpenRouter.
- The extension may request transcript data directly from YouTube when available.

If you enable optional Obsidian export, the video title, URL, summary text, and any selected highlight are passed to the Obsidian desktop app on your device through the local `obsidian://` URI handler so a markdown note can be created or opened. That content is not sent to TL;DW servers.

These services process data under their own terms and privacy policies. TL;DW does not transmit data to advertising, analytics, or data-broker services.

## Data retention and security

Locally stored data remains until you clear it or remove the extension. Data sent to a service provider is retained according to that provider's policies and your account settings. No transmission or storage system can be guaranteed completely secure; protect your API keys and revoke them with the relevant provider if you believe they were exposed.

## Contact

For privacy questions or deletion requests concerning TL;DW, open an issue at <https://github.com/yazinsai/tldw/issues>.

## Changes

Material changes to this policy will be published in this repository with a new effective date.
