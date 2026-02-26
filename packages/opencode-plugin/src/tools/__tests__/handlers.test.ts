import { describe, expect, it, vi } from "vitest";
import { createBabysitterRuntime } from "../../index";
import { createBabysitterToolHandlers } from "../handlers";

describe("createBabysitterToolHandlers", () => {
  it("starts a session via babysitter_setup", async () => {
    const runtime = createBabysitterRuntime({
      client: { session: { prompt: vi.fn().mockResolvedValue(undefined) } },
      now: () => new Date("2026-02-26T10:00:00.000Z"),
    });
    const handlers = createBabysitterToolHandlers(runtime);

    const result = await handlers.babysitter_setup.execute(
      { prompt: "Implement feature", maxIterations: 5 },
      { sessionID: "session-1" }
    );

    expect(result).toEqual({
      sessionId: "session-1",
      runId: null,
      iteration: 1,
    });
    expect(runtime.sessions.get("session-1")?.maxIterations).toBe(5);
  });

  it("resumes an existing run and uses cli state", async () => {
    const runtime = createBabysitterRuntime({
      client: { session: { prompt: vi.fn().mockResolvedValue(undefined) } },
      now: () => new Date("2026-02-26T10:00:00.000Z"),
    });
    const handlers = createBabysitterToolHandlers(runtime, {
      cli: {
        runStatus: vi.fn().mockResolvedValue({ state: "waiting", pendingByKind: { node: 2 } }),
      },
    });

    const result = await handlers.babysitter_resume.execute(
      { runId: "run-1" },
      { sessionID: "session-1" }
    );

    expect(result).toEqual({
      sessionId: "session-1",
      runId: "run-1",
      state: "waiting",
    });
    expect(runtime.sessions.get("session-1")?.prompt).toContain("Current state: waiting");
  });

  it("associates an active session with a run id", async () => {
    const runtime = createBabysitterRuntime({
      client: { session: { prompt: vi.fn().mockResolvedValue(undefined) } },
    });
    const handlers = createBabysitterToolHandlers(runtime);
    await handlers.babysitter_setup.execute({ prompt: "Implement feature" }, { sessionID: "session-1" });

    const result = await handlers.babysitter_associate.execute({ runId: "run-22" }, { sessionID: "session-1" });

    expect(result).toEqual({ sessionId: "session-1", runId: "run-22" });
    expect(runtime.sessions.get("session-1")?.runId).toBe("run-22");
  });

  it("returns active status including run state when available", async () => {
    const runtime = createBabysitterRuntime({
      client: { session: { prompt: vi.fn().mockResolvedValue(undefined) } },
    });
    const handlers = createBabysitterToolHandlers(runtime, {
      cli: {
        runStatus: vi.fn().mockResolvedValue({ state: "waiting", pendingByKind: { breakpoint: 1 } }),
      },
    });
    await handlers.babysitter_setup.execute(
      { prompt: "Implement feature", runId: "run-55" },
      { sessionID: "session-1" }
    );

    const status = await handlers.babysitter_status.execute({}, { sessionID: "session-1" });

    expect(status).toEqual({
      active: true,
      sessionId: "session-1",
      iteration: 1,
      maxIterations: 256,
      runId: "run-55",
      runState: "waiting",
      pendingByKind: { breakpoint: 1 },
    });
  });

  it("stops a session via babysitter_stop", async () => {
    const runtime = createBabysitterRuntime({
      client: { session: { prompt: vi.fn().mockResolvedValue(undefined) } },
    });
    const handlers = createBabysitterToolHandlers(runtime);
    await handlers.babysitter_setup.execute({ prompt: "Implement feature" }, { sessionID: "session-1" });

    const result = await handlers.babysitter_stop.execute({}, { sessionID: "session-1" });

    expect(result).toEqual({ sessionId: "session-1", stopped: true });
    expect(runtime.sessions.get("session-1")).toBeUndefined();
  });
});
