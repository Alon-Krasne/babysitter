import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskListEntry, TaskPostOptions } from "../../cli/babysitterCli";
import { runNativeOrchestrator } from "../nativeOrchestrator";

class FakeCli {
  constructor(
    private readonly state: string,
    private readonly tasks: TaskListEntry[]
  ) {}

  public readonly postCalls: Array<{ runId: string; effectId: string; options: TaskPostOptions; cwd?: string }> = [];
  public taskListCalls = 0;

  async runStatus() {
    return { state: this.state };
  }

  async taskListPending() {
    this.taskListCalls += 1;
    return this.tasks;
  }

  async taskPost(runId: string, effectId: string, options: TaskPostOptions, cwd?: string) {
    this.postCalls.push({ runId, effectId, options, cwd });
  }
}

class FakeBreakpointClient {
  public readonly createCalls: Array<{
    question: string;
    title: string;
    runId: string;
  }> = [];

  public readonly waitCalls: Array<{ breakpointId: string; intervalSeconds?: number }> = [];

  constructor(
    private readonly result: { breakpointId: string; wait: unknown } = {
      breakpointId: "bp-1",
      wait: { status: "released" },
    },
    private readonly shouldThrow = false
  ) {}

  async create(input: { question: string; title: string; runId: string }) {
    this.createCalls.push(input);
    if (this.shouldThrow) {
      throw new Error("create failed");
    }
    return {
      breakpointId: this.result.breakpointId,
    };
  }

  async wait(input: { breakpointId: string; intervalSeconds?: number }) {
    this.waitCalls.push(input);
    if (this.shouldThrow) {
      throw new Error("wait failed");
    }
    return this.result.wait;
  }
}

describe("runNativeOrchestrator", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-orchestrator-"));
  });

  afterEach(async () => {
    await fs.rm(worktree, { recursive: true, force: true });
  });

  it("returns terminal-state action when run is completed", async () => {
    const cli = new FakeCli("completed", []);
    const action = await runNativeOrchestrator({
      runId: "run-1",
      worktree,
      cli,
    });

    expect(action).toEqual({
      action: "none",
      reason: "terminal-state",
      status: "completed",
    });
    expect(cli.taskListCalls).toBe(0);
  });

  it("returns waiting action for pending breakpoints", async () => {
    const cli = new FakeCli("waiting", [{ effectId: "ef-break", kind: "breakpoint" }]);
    const action = await runNativeOrchestrator({
      runId: "run-1",
      worktree,
      cli,
    });

    expect(action).toEqual({
      action: "waiting",
      reason: "breakpoint-waiting",
      count: 1,
    });
  });

  it("processes breakpoints via breakpoint client and posts result", async () => {
    const runId = "run-breakpoint";
    const effectId = "ef-break";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const effectDir = path.join(runDir, "tasks", effectId);
    await fs.mkdir(effectDir, { recursive: true });
    await fs.writeFile(
      path.join(effectDir, "task.json"),
      JSON.stringify(
        {
          kind: "breakpoint",
          title: "Need approval",
          breakpoint: {
            payload: {
              question: "Proceed with migration?",
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const cli = new FakeCli("waiting", [{ effectId, kind: "breakpoint", taskDefRef: `tasks/${effectId}/task.json` }]);
    const breakpoints = new FakeBreakpointClient({
      breakpointId: "bp-123",
      wait: { status: "released", feedback: "yes" },
    });

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
      breakpoints,
      breakpointPollIntervalSeconds: 5,
    });

    expect(action).toEqual({
      action: "executed-breakpoints",
      count: 1,
      reason: "breakpoints-processed",
    });
    expect(breakpoints.createCalls).toEqual([
      {
        question: "Proceed with migration?",
        title: "Need approval",
        runId,
      },
    ]);
    expect(breakpoints.waitCalls).toEqual([{ breakpointId: "bp-123", intervalSeconds: 5 }]);
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0]?.options).toMatchObject({
      status: "ok",
      valueRef: `tasks/${effectId}/result.json`,
    });
  });

  it("posts error when breakpoint client fails", async () => {
    const runId = "run-breakpoint-fail";
    const effectId = "ef-break";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const effectDir = path.join(runDir, "tasks", effectId);
    await fs.mkdir(effectDir, { recursive: true });
    await fs.writeFile(path.join(effectDir, "task.json"), JSON.stringify({ kind: "breakpoint" }, null, 2), "utf8");

    const cli = new FakeCli("waiting", [{ effectId, kind: "breakpoint", taskDefRef: `tasks/${effectId}/task.json` }]);
    const breakpoints = new FakeBreakpointClient(undefined, true);

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
      breakpoints,
    });

    expect(action).toEqual({
      action: "executed-breakpoints",
      count: 1,
      reason: "breakpoints-processed",
    });
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0]?.options.status).toBe("error");
  });

  it("returns invoke-skills action for pending skill tasks", async () => {
    const cli = new FakeCli("waiting", [
      { effectId: "ef-skill-1", kind: "skill", label: "analyze-code" },
      { effectId: "ef-skill-2", kind: "skill" },
    ]);
    const action = await runNativeOrchestrator({
      runId: "run-1",
      worktree,
      cli,
    });

    expect(action).toEqual({
      action: "invoke-skills",
      count: 2,
      reason: "skill-tasks-pending",
      skills: [
        { effectId: "ef-skill-1", label: "analyze-code", skillName: undefined, kind: "skill" },
        { effectId: "ef-skill-2", label: "ef-skill-2", skillName: undefined, kind: "skill" },
      ],
      instructions: "Use the Skill tool to invoke each skill, then post task results via task:post.",
    });
  });

  it("executes skill tasks via skill runner and posts results", async () => {
    const runId = "run-skills";
    const effectId = "ef-skill-1";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const taskDir = path.join(runDir, "tasks", effectId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, "inputs.json"), JSON.stringify({ topic: "hooks" }), "utf8");
    await fs.writeFile(
      path.join(taskDir, "task.json"),
      JSON.stringify(
        {
          kind: "skill",
          skill: { name: "babysitter-score" },
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
        null,
        2
      ),
      "utf8"
    );

    const cli = new FakeCli("waiting", [
      { effectId, kind: "skill", taskDefRef: `tasks/${effectId}/task.json`, inputsRef: `tasks/${effectId}/inputs.json` },
    ]);
    const skillRunner = {
      run: async () => ({
        status: "ok" as const,
        value: { score: 92 },
        stdout: "runner ok",
      }),
    };

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
      skillRunner,
    });

    expect(action).toEqual({
      action: "executed-skills",
      count: 1,
      reason: "skill-tasks-processed",
    });
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0]?.options).toMatchObject({
      status: "ok",
      valueRef: `tasks/${effectId}/result.json`,
      stdoutRef: `tasks/${effectId}/stdout.log`,
    });
  });

  it("returns invoke-agents action for pending agent tasks", async () => {
    const runId = "run-agents";
    const effectId = "ef-agent-1";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const taskDir = path.join(runDir, "tasks", effectId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      path.join(taskDir, "task.json"),
      JSON.stringify(
        {
          kind: "agent",
          agent: { name: "code-reviewer" },
        },
        null,
        2
      ),
      "utf8"
    );

    const cli = new FakeCli("waiting", [{ effectId, kind: "agent", label: "review", taskDefRef: `tasks/${effectId}/task.json` }]);
    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
    });

    expect(action).toEqual({
      action: "invoke-agents",
      count: 1,
      reason: "agent-tasks-pending",
      agents: [{ effectId, label: "review", agentName: "code-reviewer", kind: "agent" }],
      instructions: "Use the Task tool to delegate each agent task, then post task results via task:post.",
    });
  });

  it("executes agent tasks via agent runner and posts error payload", async () => {
    const runId = "run-agent-exec";
    const effectId = "ef-agent-2";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const taskDir = path.join(runDir, "tasks", effectId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, "inputs.json"), JSON.stringify({ scope: "api" }), "utf8");
    await fs.writeFile(
      path.join(taskDir, "task.json"),
      JSON.stringify(
        {
          kind: "agent",
          agent: { name: "api-reviewer" },
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
        null,
        2
      ),
      "utf8"
    );

    const cli = new FakeCli("waiting", [
      { effectId, kind: "agent", taskDefRef: `tasks/${effectId}/task.json`, inputsRef: `tasks/${effectId}/inputs.json` },
    ]);
    const agentRunner = {
      run: async () => ({
        status: "error" as const,
        error: { name: "AgentError", message: "missing approval" },
        stderr: "runner err",
      }),
    };

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
      agentRunner,
    });

    expect(action).toEqual({
      action: "executed-agents",
      count: 1,
      reason: "agent-tasks-processed",
    });
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0]?.options).toMatchObject({
      status: "error",
      stderrRef: `tasks/${effectId}/stderr.log`,
    });
  });

  it("executes pending node tasks and posts successful result", async () => {
    const runId = "run-node-success";
    const effectId = "ef-node";
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const effectDir = path.join(runDir, "tasks", effectId);
    const scriptPath = path.join(runDir, "scripts", "node-task.js");

    await fs.mkdir(effectDir, { recursive: true });
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(
      scriptPath,
      [
        "const fs = require('node:fs');",
        "const input = JSON.parse(fs.readFileSync(process.env.BABYSITTER_INPUT_JSON, 'utf8'));",
        "const output = { sum: (input.a || 0) + (input.b || 0) };",
        "fs.writeFileSync(process.env.BABYSITTER_OUTPUT_JSON, JSON.stringify(output));",
        "process.stdout.write('done');",
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(path.join(effectDir, "inputs.json"), JSON.stringify({ a: 2, b: 3 }), "utf8");
    await fs.writeFile(
      path.join(effectDir, "task.json"),
      JSON.stringify(
        {
          kind: "node",
          node: {
            entry: "scripts/node-task.js",
          },
          inputsRef: `tasks/${effectId}/inputs.json`,
        },
        null,
        2
      ),
      "utf8"
    );

    const cli = new FakeCli("waiting", [
      {
        effectId,
        kind: "node",
        taskDefRef: `tasks/${effectId}/task.json`,
        inputsRef: `tasks/${effectId}/inputs.json`,
      },
    ]);
    const taskEvents: Array<{ phase: string; effectId: string; kind: string; status?: string }> = [];

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
      onTaskEvent: async (event) => {
        taskEvents.push({ phase: event.phase, effectId: event.effectId, kind: event.kind, status: event.status });
      },
    });

    expect(action).toEqual({
      action: "executed-tasks",
      count: 1,
      reason: "auto-runnable-tasks",
    });
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0]).toMatchObject({
      runId,
      effectId,
      options: {
        status: "ok",
        valueRef: `tasks/${effectId}/result.json`,
        stdoutRef: `tasks/${effectId}/stdout.log`,
        stderrRef: `tasks/${effectId}/stderr.log`,
      },
      cwd: worktree,
    });

    const outputRaw = await fs.readFile(path.join(effectDir, "result.json"), "utf8");
    expect(JSON.parse(outputRaw)).toEqual({ sum: 5 });
    expect(taskEvents).toEqual([
      { phase: "start", effectId, kind: "node", status: undefined },
      { phase: "complete", effectId, kind: "node", status: "ok" },
    ]);
  });

  it("posts error when node task definition is missing", async () => {
    const runId = "run-node-missing";
    const effectId = "ef-node";
    await fs.mkdir(path.join(worktree, ".a5c", "runs", runId), { recursive: true });

    const cli = new FakeCli("waiting", [{ effectId, kind: "node", taskDefRef: `tasks/${effectId}/task.json` }]);

    const action = await runNativeOrchestrator({
      runId,
      worktree,
      cli,
    });

    expect(action).toEqual({
      action: "executed-tasks",
      count: 1,
      reason: "auto-runnable-tasks",
    });
    expect(cli.postCalls).toHaveLength(1);
    expect(cli.postCalls[0].options.status).toBe("error");
  });
});
