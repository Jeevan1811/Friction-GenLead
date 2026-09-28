const STATUS_REPLACEMENTS = [
  [
    /\b(?:HTTP\s*|status(?:_code)?\s*[:=]\s*|status code\s*[:=]?\s*)402\b/gi,
    "a connected provider has a billing or usage limit",
  ],
  [
    /\b(?:HTTP\s*|status(?:_code)?\s*[:=]\s*|status code\s*[:=]?\s*)(?:401|403)\b/gi,
    "a connected provider denied access",
  ],
  [
    /\b(?:HTTP\s*|status(?:_code)?\s*[:=]\s*|status code\s*[:=]?\s*)429\b/gi,
    "a connected provider is temporarily rate limiting requests",
  ],
  [
    /\b(?:HTTP\s*|status(?:_code)?\s*[:=]\s*|status code\s*[:=]?\s*)5\d\d\b/gi,
    "a connected service is temporarily unavailable",
  ],
];

export function sanitizeProviderStatusMessage(message) {
  return STATUS_REPLACEMENTS.reduce(
    (safeMessage, [pattern, explanation]) => safeMessage.replace(pattern, explanation),
    String(message ?? "")
  );
}
