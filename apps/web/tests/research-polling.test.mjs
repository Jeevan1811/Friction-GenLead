import test from "node:test";
import assert from "node:assert/strict";

import {
  createResearchPollState,
  advanceResearchPollState,
  isTerminalResearchStatus,
  stopResearchPollState,
  MAX_RESEARCH_POLL_DELAY_MS,
} from "../src/lib/research-polling.mjs";

test("terminal research states stop polling and remain terminal", () => {
  for (const status of ["completed", "failed", "cancelled", "interrupted"]) {
    assert.equal(isTerminalResearchStatus(status), true);
    const terminal = advanceResearchPollState(createResearchPollState(), {
      type: "status",
      status,
    });
    assert.equal(terminal.terminal, true);
    assert.equal(terminal.delayMs, 0);
    assert.deepEqual(
      advanceResearchPollState(terminal, { type: "error" }),
      terminal,
    );
  }
});

test("transient failures retain the last status and back off within a bound", () => {
  let state = createResearchPollState();
  for (let failure = 1; failure <= 20; failure += 1) {
    state = advanceResearchPollState(state, { type: "error" });
    assert.equal(state.status, "running");
    assert.equal(state.terminal, false);
    assert.ok(state.delayMs > 0);
    assert.ok(state.delayMs <= MAX_RESEARCH_POLL_DELAY_MS);
  }
  state = advanceResearchPollState(state, { type: "status", status: "running" });
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.delayMs, 3000);
});

test("a missing job stops futile polling without pretending the server completed it", () => {
  const initial = createResearchPollState();
  const stopped = stopResearchPollState(initial);
  assert.equal(stopped.status, "running");
  assert.equal(stopped.terminal, true);
  assert.equal(stopped.delayMs, 0);
  assert.deepEqual(stopResearchPollState(stopped), stopped);
});

test("10,000 deterministic lifecycle simulations never poll terminal jobs or exceed retry bounds", () => {
  let seed = 0x6d7376;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  const terminalStatuses = ["completed", "failed", "cancelled", "interrupted"];
  const activeStatuses = ["running", "running", "running"];

  for (let simulation = 0; simulation < 10_000; simulation += 1) {
    let state = createResearchPollState();
    for (let event = 0; event < 40; event += 1) {
      const before = state;
      if (state.terminal) {
        state = advanceResearchPollState(state, { type: "error" });
        assert.deepEqual(state, before);
        continue;
      }

      const sample = random();
      if (sample < 0.28) {
        state = advanceResearchPollState(state, { type: "error" });
      } else {
        const statuses = sample < 0.33 ? terminalStatuses : activeStatuses;
        const status = statuses[Math.floor(random() * statuses.length)];
        state = advanceResearchPollState(state, { type: "status", status });
      }

      assert.ok(state.delayMs >= 0 && state.delayMs <= MAX_RESEARCH_POLL_DELAY_MS);
      if (!state.terminal) assert.notEqual(state.delayMs, 0);
      if (state.terminal) assert.equal(isTerminalResearchStatus(state.status), true);
    }
  }
});
