import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskListEntry, TaskPostOptions } from "../cli/babysitterCli";
import { createBabysitterRuntime } from "../runtime";
import { createBabysitterToolHandlers } from "../tools/handlers";

interface QueuedStatus {
  state: string;
  pendingByKind?: Record<string, number>;
}

class SequencedCli {
  constructor(
    private statuses: QueuedStatus[],
    private readonly pendingTasks: TaskListEntry[]
  ) {}

  public readonly statusCalls: string[] = [];
  public readonly taskListCalls: string[] = [];
  public readonly taskPostCalls: Array<{
    runId: string;
    effectId: string;
    options: TaskPostOptions;
    cwd?: string;
  }> = [];

  async runStatus(runId: string): Promise<QueuedStatus> {
    this.statusCalls.push(runId);
    if (this.statuses.length === 0) {
      throw new Error("No queued runStatus response");
    }
    return this.statuses.shift() as QueuedStatus;
  }

  async taskListPending(runId: string): Promise<TaskListEntry[]> {
    this.taskListCalls.push(runId);
    return this.pendingTasks;
  }

  async taskPost(runId: string, effectId: string, options: TaskPostOptions, cwd?: string): Promise<void> {
    this.taskPostCalls.push({ runId, effectId, options, cwd });
  }
}

describe("Babysitter runtime e2e loop", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(worktree, { recursive: true, force: true });
  });

  it("runs iterate -> execute task -> complete flow across idle ticks", async () => {
    const runId = "run-e2e";
    const effectId = "ef-node";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const taskDir = path.join(runDir, "tasks", effectId);
    const scriptPath = path.join(runDir, "scripts", "task.js");

    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(
      scriptPath,
      [
        "const fs = require('node:fs');",
        "const input = JSON.parse(fs.readFileSync(process.env.BABYSITTER_INPUT_JSON, 'utf8'));",
        "fs.writeFileSync(process.env.BABYSITTER_OUTPUT_JSON, JSON.stringify({ done: input.value === 1 }));",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(taskDir, "inputs.json"), JSON.stringify({ value: 1 }), "utf8");
    await fs.writeFile(
      path.join(taskDir, "task.json"),
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

    const prompt = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue({ hookName: "x", results: [] });

    const cli = new SequencedCli(
      [
        { state: "waiting" },
        { state: "waiting", pendingByKind: { node: 1 } },
        { state: "completed" },
        { state: "completed" },
      ],
      [
        {
          effectId,
          kind: "node",
          taskDefRef: `tasks/${effectId}/task.json`,
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
      ]
    );

    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      cli,
      hookDispatcher: {
        dispatch,
      },
      worktree,
      now: () => new Date("2026-02-26T23:18:00.000Z"),
    });

    runtime.setupSession("session-e2e", {
      prompt: "continue orchestration",
      runId,
      now: new Date("2026-02-26T23:17:00.000Z"),
    });

    const first = await runtime.onSessionIdle("session-e2e");
    expect(first.type).toBe("prompt");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(cli.taskPostCalls).toHaveLength(1);
    expect(cli.taskPostCalls[0]?.options).toMatchObject({
      status: "ok",
      valueRef: `tasks/${effectId}/result.json`,
    });

    const second = await runtime.onSessionIdle("session-e2e");
    expect(second.type).toBe("deactivate");
    expect(runtime.sessions.get("session-e2e")).toBeUndefined();

    const hookNames = dispatch.mock.calls.map((call) => call[0]);
    expect(hookNames).toContain("on-task-start");
    expect(hookNames).toContain("on-task-complete");
    expect(hookNames).toContain("on-run-complete");
  });

  it("supports resume + score workflow through plugin tool handlers", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const runtime = createBabysitterRuntime({
      client: {
        session: { prompt },
      },
      now: () => new Date("2026-02-26T23:20:00.000Z"),
    });

    const handlers = createBabysitterToolHandlers(runtime, {
      cli: {
        runStatus: vi.fn().mockResolvedValue({ state: "waiting", pendingByKind: { skill: 1 } }),
      },
      askUser: vi.fn().mockResolvedValue({ status: "answered", answer: "approved" }),
    });

    const resumed = await handlers.babysitter_resume.execute(
      { runId: "run-resume-1" },
      { sessionID: "session-resume", directory: worktree }
    );
    expect(resumed).toEqual({
      sessionId: "session-resume",
      runId: "run-resume-1",
      state: "waiting",
    });

    const asked = await handlers.babysitter_ask.execute(
      { question: "Proceed to next iteration?", title: "Checkpoint" },
      { sessionID: "session-resume" }
    );
    expect(asked).toEqual({
      sessionId: "session-resume",
      status: "answered",
      answer: "approved",
      question: "Proceed to next iteration?",
    });

    const scored = await handlers.babysitter_score.execute(
      {
        criteria: [
          { name: "correctness", score: 88, weight: 2 },
          { name: "tests", score: 92, weight: 1 },
        ],
        passThreshold: 85,
      },
      { sessionID: "session-resume" }
    );
    expect(scored).toEqual({
      score: 89,
      passed: true,
      threshold: 85,
      breakdown: [
        { name: "correctness", score: 88, weight: 2 },
        { name: "tests", score: 92, weight: 1 },
      ],
    });
  });
});
