import test from "node:test";
import assert from "node:assert/strict";

test("provider billing responses are explained without exposing numeric status codes", async () => {
  const module = await import("../src/lib/provider-status-message.mjs").catch(() => null);
  assert.ok(module, "the shared provider-error message sanitizer is implemented");

  const result = module.sanitizeProviderStatusMessage(
    "AI replies unavailable after HTTP 402 from provider."
  );

  assert.match(result, /billing or usage limit/i);
  assert.doesNotMatch(result, /402/);
});

test("rate limits and outages get plain-language explanations without their status numbers", async () => {
  const module = await import("../src/lib/provider-status-message.mjs").catch(() => null);
  assert.ok(module, "the shared provider-error message sanitizer is implemented");

  assert.match(module.sanitizeProviderStatusMessage("Request failed (status=429)."), /rate limit/i);
  assert.match(module.sanitizeProviderStatusMessage("Provider returned HTTP 503."), /temporarily unavailable/i);
  assert.doesNotMatch(
    ["status=429", "HTTP 503"].map(module.sanitizeProviderStatusMessage).join(" "),
    /429|503/
  );
});
