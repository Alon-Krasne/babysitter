import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStateStore } from "../sessionState";

describe("SessionStateStore persistence", () => {
  let tempDir: string;
  let persistenceFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-state-"));
    persistenceFile = path.join(tempDir, "state", "sessions.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists started sessions and reloads them", async () => {
    const first = new SessionStateStore({ persistenceFile });
    first.start("session-1", {
      prompt: "continue",
      runId: "run-1",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });

    const second = new SessionStateStore({ persistenceFile });
    const restored = second.get("session-1");

    expect(restored).toMatchObject({
      sessionId: "session-1",
      runId: "run-1",
      prompt: "continue",
      iteration: 1,
      active: true,
    });
  });

  it("persists stop operations", async () => {
    const first = new SessionStateStore({ persistenceFile });
    first.start("session-1", {
      prompt: "continue",
      runId: "run-1",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });
    first.stop("session-1");

    const second = new SessionStateStore({ persistenceFile });
    expect(second.get("session-1")).toBeUndefined();
    expect(second.listActive()).toHaveLength(0);
  });
});
