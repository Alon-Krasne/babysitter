import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBabysitterPlugin } from "../..";

describe("createBabysitterPlugin", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-plugin-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns expected hooks and tools", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const plugin = createBabysitterPlugin({
      enableBreakpointCli: false,
      enableHookDispatcher: false,
      sessionStateFile: path.join(tempDir, "state", "sessions.json"),
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const hooks = await plugin({
      client: {
        session: { prompt },
      },
      worktree: tempDir,
    });

    expect(typeof hooks.event).toBe("function");
    expect(typeof hooks["tool.execute.before"]).toBe("function");
    expect(typeof hooks["tool.execute.after"]).toBe("function");

    const toolNames = Object.keys((hooks.tool as Record<string, unknown>) ?? {}).sort();
    expect(toolNames).toEqual([
      "babysitter_ask",
      "babysitter_associate",
      "babysitter_resume",
      "babysitter_score",
      "babysitter_setup",
      "babysitter_status",
      "babysitter_stop",
    ]);
  });

  it("uses ask tool to prompt user question", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const plugin = createBabysitterPlugin({
      enableBreakpointCli: false,
      enableHookDispatcher: false,
      sessionStateFile: path.join(tempDir, "state", "sessions.json"),
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const hooks = await plugin({
      client: {
        session: { prompt },
      },
      worktree: tempDir,
    });

    const askTool = (hooks.tool as Record<string, { execute: (args: unknown, ctx: unknown) => Promise<unknown> }>).babysitter_ask;
    const result = await askTool.execute(
      { question: "Proceed?", title: "Approval", choices: ["yes", "no"] },
      { sessionID: "session-1" }
    );

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0]?.body?.parts?.[0]?.text).toContain("Babysitter question:");
    expect(result).toEqual({
      sessionId: "session-1",
      status: "prompted",
      question: "Proceed?",
    });
  });

  it("can wait for ask response from message.updated events", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const plugin = createBabysitterPlugin({
      enableBreakpointCli: false,
      enableHookDispatcher: false,
      waitForAskResponse: true,
      askResponseTimeoutMs: 1000,
      sessionStateFile: path.join(tempDir, "state", "sessions.json"),
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const hooks = await plugin({
      client: {
        session: { prompt },
      },
      worktree: tempDir,
    });

    const askTool = (hooks.tool as Record<string, { execute: (args: unknown, ctx: unknown) => Promise<unknown> }>).babysitter_ask;
    const pending = askTool.execute(
      { question: "Proceed?" },
      { sessionID: "session-1" }
    );

    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });

    setTimeout(() => {
      void hooks.event({
        event: {
          type: "message.updated",
          properties: {
            sessionId: "session-1",
            message: {
              role: "user",
              text: "yes",
            },
          },
        },
      });
    }, 0);

    await expect(pending).resolves.toEqual({
      sessionId: "session-1",
      status: "answered",
      answer: "yes",
      question: "Proceed?",
    });
  });
});
