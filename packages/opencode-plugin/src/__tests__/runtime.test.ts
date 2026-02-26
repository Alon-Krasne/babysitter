import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createBabysitterPluginHooks, createBabysitterRuntime } from "../index";

describe("createBabysitterRuntime", () => {
  it("prompts the session on idle when loop should continue", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      cli: {
        runStatus: vi.fn().mockResolvedValue({
          state: "waiting",
          pendingByKind: { node: 1 },
        }),
      },
      now: () => new Date("2026-02-26T12:00:20.000Z"),
    });

    runtime.setupSession("session-1", {
      prompt: "continue",
      runId: "run-1",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });

    const result = await runtime.onSessionIdle("session-1");

    expect(result.type).toBe("prompt");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: {
        parts: [
          {
            type: "text",
            text: expect.stringContaining("continue"),
          },
        ],
      },
    });
  });

  it("stops active session when run reaches completed state", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      cli: {
        runStatus: vi.fn().mockResolvedValue({ state: "completed" }),
      },
      now: () => new Date("2026-02-26T12:00:20.000Z"),
    });

    runtime.setupSession("session-1", {
      prompt: "continue",
      runId: "run-1",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });

    const result = await runtime.onSessionIdle("session-1");

    expect(result.type).toBe("deactivate");
    expect(prompt).not.toHaveBeenCalled();
    expect(runtime.sessions.get("session-1")).toBeUndefined();
  });

  it("returns noop when no active session exists", async () => {
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt: vi.fn().mockResolvedValue(undefined) },
      },
    });

    const result = await runtime.onSessionIdle("missing");
    expect(result.type).toBe("noop");
    expect(result.reason).toBe("no-active-session");
  });

  it("routes session.idle events through plugin hooks", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      now: () => new Date("2026-02-26T12:00:20.000Z"),
    });
    runtime.setupSession("session-7", {
      prompt: "continue",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });
    const hooks = createBabysitterPluginHooks(runtime);

    await hooks.event({
      event: {
        type: "session.idle",
        properties: { session_id: "session-7" },
      },
    });

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("runs native orchestrator before idle prompt when node tasks are pending", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-runtime-"));
    try {
      const runId = "run-runtime-node";
      const effectId = "ef-node";
      const runDir = path.join(worktree, ".a5c", "runs", runId);
      const effectDir = path.join(runDir, "tasks", effectId);
      const scriptPath = path.join(runDir, "scripts", "task.js");

      await fs.mkdir(effectDir, { recursive: true });
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        [
          "const fs = require('node:fs');",
          "const input = JSON.parse(fs.readFileSync(process.env.BABYSITTER_INPUT_JSON, 'utf8'));",
          "fs.writeFileSync(process.env.BABYSITTER_OUTPUT_JSON, JSON.stringify({ echoed: input.value }));",
        ].join("\n"),
        "utf8"
      );
      await fs.writeFile(path.join(effectDir, "inputs.json"), JSON.stringify({ value: "ok" }), "utf8");
      await fs.writeFile(
        path.join(effectDir, "task.json"),
        JSON.stringify(
          {
            kind: "node",
            node: { entry: "scripts/task.js" },
            inputsRef: `tasks/${effectId}/inputs.json`,
          },
          null,
          2
        ),
        "utf8"
      );

      const postCalls: unknown[] = [];
      const prompt = vi.fn().mockResolvedValue(undefined);
      const dispatch = vi.fn().mockResolvedValue({ hookName: "x", results: [] });
      const runStatus = vi
        .fn()
        .mockResolvedValueOnce({ state: "waiting" })
        .mockResolvedValueOnce({ state: "waiting", pendingByKind: { node: 1 } });
      const taskListPending = vi.fn().mockResolvedValue([
        {
          effectId,
          kind: "node",
          taskDefRef: `tasks/${effectId}/task.json`,
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
      ]);
      const taskPost = vi.fn().mockImplementation(async (_runId, _effectId, options) => {
        postCalls.push(options);
      });

      const runtime = createBabysitterRuntime({
        client: {
          session: { prompt },
        },
        cli: {
          runStatus,
          taskListPending,
          taskPost,
        },
        hookDispatcher: {
          dispatch,
        },
        worktree,
        now: () => new Date("2026-02-26T12:00:20.000Z"),
      });

      runtime.setupSession("session-1", {
        prompt: "continue",
        runId,
        now: new Date("2026-02-26T12:00:00.000Z"),
      });

      const result = await runtime.onSessionIdle("session-1");

      expect(result.type).toBe("prompt");
      expect(taskListPending).toHaveBeenCalledTimes(1);
      expect(taskPost).toHaveBeenCalledTimes(1);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(postCalls[0]).toMatchObject({
        status: "ok",
        valueRef: `tasks/${effectId}/result.json`,
      });
      const calledHooks = dispatch.mock.calls.map((call) => call[0]);
      expect(calledHooks).toContain("on-task-start");
      expect(calledHooks).toContain("on-task-complete");
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
    }
  });

  it("injects orchestrator hint for pending skill tasks", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-runtime-skill-"));
    try {
      const runId = "run-runtime-skill";
      const prompt = vi.fn().mockResolvedValue(undefined);
      const dispatch = vi.fn().mockResolvedValue({ hookName: "x", results: [] });
      const runStatus = vi
        .fn()
        .mockResolvedValueOnce({ state: "waiting" })
        .mockResolvedValueOnce({ state: "waiting", pendingByKind: { skill: 1 } });
      const taskListPending = vi.fn().mockResolvedValue([
        {
          effectId: "ef-skill",
          kind: "skill",
          label: "analysis",
        },
      ]);
      const taskPost = vi.fn().mockResolvedValue(undefined);

      const runtime = createBabysitterRuntime({
        client: {
          session: { prompt },
        },
        cli: {
          runStatus,
          taskListPending,
          taskPost,
        },
        worktree,
        now: () => new Date("2026-02-26T12:00:20.000Z"),
      });

      runtime.setupSession("session-1", {
        prompt: "continue",
        runId,
        now: new Date("2026-02-26T12:00:00.000Z"),
      });

      const result = await runtime.onSessionIdle("session-1");

      expect(result.type).toBe("prompt");
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(prompt.mock.calls[0]?.[0]?.body?.parts?.[0]?.text).toContain("Skill tasks pending");
      expect(prompt.mock.calls[0]?.[0]?.body?.parts?.[0]?.text).toContain("Use the Skill tool");
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
    }
  });

  it("injects orchestrator hint after executing skill tasks", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-runtime-skill-exec-"));
    try {
      const runId = "run-runtime-skill-exec";
      const effectId = "ef-skill";
      const runDir = path.join(worktree, ".a5c", "runs", runId);
      const taskDir = path.join(runDir, "tasks", effectId);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, "inputs.json"), JSON.stringify({ value: 1 }), "utf8");
      await fs.writeFile(
        path.join(taskDir, "task.json"),
        JSON.stringify({ kind: "skill", inputsRef: `tasks/${effectId}/inputs.json` }, null, 2),
        "utf8"
      );

      const prompt = vi.fn().mockResolvedValue(undefined);
      const runStatus = vi
        .fn()
        .mockResolvedValueOnce({ state: "waiting" })
        .mockResolvedValueOnce({ state: "waiting", pendingByKind: { skill: 1 } });
      const taskListPending = vi.fn().mockResolvedValue([
        {
          effectId,
          kind: "skill",
          label: "analysis",
          taskDefRef: `tasks/${effectId}/task.json`,
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
      ]);
      const taskPost = vi.fn().mockResolvedValue(undefined);
      const skillRunner = {
        run: vi.fn().mockResolvedValue({ status: "ok", value: { done: true } }),
      };

      const runtime = createBabysitterRuntime({
        client: {
          session: { prompt },
        },
        cli: {
          runStatus,
          taskListPending,
          taskPost,
        },
        worktree,
        skillRunner,
        now: () => new Date("2026-02-26T12:00:20.000Z"),
      });

      runtime.setupSession("session-1", {
        prompt: "continue",
        runId,
        now: new Date("2026-02-26T12:00:00.000Z"),
      });

      const result = await runtime.onSessionIdle("session-1");

      expect(result.type).toBe("prompt");
      expect(skillRunner.run).toHaveBeenCalledTimes(1);
      expect(skillRunner.run.mock.calls[0]?.[0]?.sessionId).toBe("session-1");
      expect(taskPost).toHaveBeenCalledTimes(1);
      expect(prompt.mock.calls[0]?.[0]?.body?.parts?.[0]?.text).toContain("executed 1 skill task");
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
    }
  });

  it("injects orchestrator hint after breakpoint processing", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-runtime-breakpoint-"));
    try {
      const runId = "run-runtime-breakpoint";
      const prompt = vi.fn().mockResolvedValue(undefined);
      const dispatch = vi.fn().mockResolvedValue({ hookName: "x", results: [] });
      const runStatus = vi
        .fn()
        .mockResolvedValueOnce({ state: "waiting" })
        .mockResolvedValueOnce({ state: "waiting", pendingByKind: { breakpoint: 1 } });
      const taskListPending = vi.fn().mockResolvedValue([
        {
          effectId: "ef-break",
          kind: "breakpoint",
          label: "approval",
        },
      ]);
      const taskPost = vi.fn().mockResolvedValue(undefined);
      const breakpoints = {
        create: vi.fn().mockResolvedValue({ breakpointId: "bp-1" }),
        wait: vi.fn().mockResolvedValue({ status: "released", feedback: "approved" }),
      };

      const runtime = createBabysitterRuntime({
        client: {
          session: { prompt },
        },
        cli: {
          runStatus,
          taskListPending,
          taskPost,
        },
        hookDispatcher: {
          dispatch,
        },
        worktree,
        breakpoints,
        now: () => new Date("2026-02-26T12:00:20.000Z"),
      });

      runtime.setupSession("session-1", {
        prompt: "continue",
        runId,
        now: new Date("2026-02-26T12:00:00.000Z"),
      });

      const result = await runtime.onSessionIdle("session-1");

      expect(result.type).toBe("prompt");
      expect(taskPost).toHaveBeenCalledTimes(1);
      expect(breakpoints.create).toHaveBeenCalledTimes(1);
      expect(breakpoints.wait).toHaveBeenCalledTimes(1);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(prompt.mock.calls[0]?.[0]?.body?.parts?.[0]?.text).toContain("processed 1 breakpoint task");
      const hookNames = dispatch.mock.calls.map((call) => call[0]);
      expect(hookNames).toContain("on-breakpoint");
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
    }
  });

  it("dispatches lifecycle hooks around iteration and completion", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue({ hookName: "x", results: [] });
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      cli: {
        runStatus: vi.fn().mockResolvedValue({ state: "completed" }),
      },
      hookDispatcher: {
        dispatch,
      },
      now: () => new Date("2026-02-26T12:00:20.000Z"),
    });

    runtime.setupSession("session-hooks", {
      prompt: "continue",
      runId: "run-hooks",
      now: new Date("2026-02-26T12:00:00.000Z"),
    });

    const result = await runtime.onSessionIdle("session-hooks");

    expect(result.type).toBe("deactivate");
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch.mock.calls[0]?.[0]).toBe("on-iteration-start");
    expect(dispatch.mock.calls[1]?.[0]).toBe("on-iteration-end");
    expect(dispatch.mock.calls[2]?.[0]).toBe("on-run-complete");
  });
});
