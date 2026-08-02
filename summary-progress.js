export const SUMMARY_PROGRESS_MESSAGES = {
  checkingCache: 'Checking cache...',
  retrievingTranscript: 'Retrieving transcript from Clipscript.uk...',
  waitingForTranscript: 'Waiting for transcript...',
  usingNativeCaptions: 'Clipscript unavailable. Trying YouTube captions...',
  summarizing: 'Generating summary...',
  savingSummary: 'Saving summary...'
};

export function getSummaryProgressMessage(step) {
  return SUMMARY_PROGRESS_MESSAGES[step] || SUMMARY_PROGRESS_MESSAGES.checkingCache;
}
