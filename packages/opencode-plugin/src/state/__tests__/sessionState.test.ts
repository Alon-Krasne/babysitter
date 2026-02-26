import { describe, expect, it } from "vitest";
import { SessionStateStore } from "../sessionState";

describe("SessionStateStore", () => {
  it("starts a new session with defaults", () => {
    const store = new SessionStateStore();
    const now = new Date("2026-02-26T12:00:00.000Z");

    const state = store.start("session-1", {
      prompt: "Build the feature",
      now,
    });

    expect(state).toMatchObject({
      active: true,
      sessionId: "session-1",
      iteration: 1,
      maxIterations: 256,
      runId: null,
      prompt: "Build the feature",
      startedAt: now.toISOString(),
      lastIterationAt: now.toISOString(),
      iterationTimes: [],
    });
  });

  it("prevents duplicate active session start", () => {
    const store = new SessionStateStore();
    store.start("session-1", { prompt: "A" });

    expect(() => store.start("session-1", { prompt: "B" })).toThrow(
      /Session already has an active babysitter run/
    );
  });

  it("associates run id exactly once", () => {
    const store = new SessionStateStore();
    store.start("session-1", { prompt: "A" });

    const state = store.associateRun("session-1", "run-123");
    expect(state.runId).toBe("run-123");

    expect(() => store.associateRun("session-1", "run-999")).toThrow(
      /Session already associated with run run-123/
    );
  });

  it("removes session on stop", () => {
    const store = new SessionStateStore();
    store.start("session-1", { prompt: "A" });

    const removed = store.stop("session-1");
    expect(removed).toBe(true);
    expect(store.get("session-1")).toBeUndefined();
  });
});
