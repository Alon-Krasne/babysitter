import { describe, expect, it } from "vitest";
import { evaluateIdleLoop } from "../idleLoop";
import { SessionState } from "../../state/sessionState";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    active: true,
    sessionId: "session-1",
    iteration: 1,
    maxIterations: 256,
    runId: "run-1",
    prompt: "Use the babysit skill and continue.",
    startedAt: "2026-02-26T12:00:00.000Z",
    lastIterationAt: "2026-02-26T12:00:00.000Z",
    iterationTimes: [],
    ...overrides,
  };
}

describe("evaluateIdleLoop", () => {
  it("deactivates when max iterations are reached", () => {
    const action = evaluateIdleLoop({
      session: makeSession({ iteration: 256, maxIterations: 256 }),
      runStatus: { state: "waiting", pendingByKind: { node: 1 } },
      now: new Date("2026-02-26T12:05:00.000Z"),
    });

    expect(action.type).toBe("deactivate");
    expect(action.reason).toBe("max-iterations-reached");
    expect(action.state.active).toBe(false);
  });

  it("deactivates when runaway guard triggers", () => {
    const action = evaluateIdleLoop({
      session: makeSession({
        iteration: 8,
        lastIterationAt: "2026-02-26T12:00:00.000Z",
        iterationTimes: [10, 12],
      }),
      runStatus: { state: "waiting", pendingByKind: { node: 1 } },
      now: new Date("2026-02-26T12:00:10.000Z"),
    });

    expect(action.type).toBe("deactivate");
    expect(action.reason).toBe("runaway-detected");
    expect(action.state.iterationTimes).toEqual([10, 12, 10]);
  });

  it("deactivates when run is completed", () => {
    const action = evaluateIdleLoop({
      session: makeSession({ iteration: 7 }),
      runStatus: { state: "completed" },
      now: new Date("2026-02-26T12:04:00.000Z"),
    });

    expect(action.type).toBe("deactivate");
    expect(action.reason).toBe("run-completed");
  });

  it("continues with waiting message when run is waiting", () => {
    const action = evaluateIdleLoop({
      session: makeSession({ iteration: 3 }),
      runStatus: { state: "waiting", pendingByKind: { breakpoint: 1, node: 2 } },
      now: new Date("2026-02-26T12:04:00.000Z"),
    });

    expect(action.type).toBe("prompt");
    if (action.type !== "prompt") {
      throw new Error("Expected prompt action");
    }
    expect(action.state.iteration).toBe(4);
    expect(action.systemMessage).toContain("Waiting on: breakpoint, node");
    expect(action.prompt).toBe("Use the babysit skill and continue.");
  });

  it("continues with generic message when run is not associated yet", () => {
    const action = evaluateIdleLoop({
      session: makeSession({ runId: null, iteration: 2 }),
      now: new Date("2026-02-26T12:04:00.000Z"),
    });

    expect(action.type).toBe("prompt");
    if (action.type !== "prompt") {
      throw new Error("Expected prompt action");
    }
    expect(action.state.iteration).toBe(3);
    expect(action.systemMessage).toContain("Continue orchestration");
  });
});
