export const RESEARCH_POLL_INTERVAL_MS = 3000;
export const MAX_RESEARCH_POLL_DELAY_MS = 30_000;

const TERMINAL_RESEARCH_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalResearchStatus(status) {
  return TERMINAL_RESEARCH_STATUSES.has(String(status || "").toLowerCase());
}

export function createResearchPollState(status = "running") {
  const terminal = isTerminalResearchStatus(status);
  return {
    status: String(status || "running").toLowerCase(),
    consecutiveFailures: 0,
    terminal,
    delayMs: terminal ? 0 : RESEARCH_POLL_INTERVAL_MS,
  };
}

export function stopResearchPollState(state) {
  if (state.terminal) return state;
  return { ...state, terminal: true, delayMs: 0 };
}

/**
 * Advance the browser's polling policy without changing the server's job
 * status when a transient request fails. Terminal states are absorbing.
 */
export function advanceResearchPollState(state, outcome) {
  if (state.terminal) return state;

  if (outcome?.type === "error") {
    const consecutiveFailures = state.consecutiveFailures + 1;
    return {
      ...state,
      consecutiveFailures,
      delayMs: Math.min(
        RESEARCH_POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures - 1, 10),
        MAX_RESEARCH_POLL_DELAY_MS,
      ),
    };
  }

  const status = String(outcome?.status || "running").toLowerCase();
  const terminal = isTerminalResearchStatus(status);
  return {
    status,
    consecutiveFailures: 0,
    terminal,
    delayMs: terminal ? 0 : RESEARCH_POLL_INTERVAL_MS,
  };
}
