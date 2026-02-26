import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { BabysitterCli, TaskListEntry } from "../cli/babysitterCli";

const DEFAULT_NODE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_AUTO_RUN_LIMIT = 3;

interface NodeTaskDefinition {
  title?: string;
  description?: string;
  node?: {
    entry?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  };
  io?: {
    inputJsonPath?: string;
    outputJsonPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
  };
  inputsRef?: string;
  inputs?: unknown;
  sleep?: {
    targetEpochMs?: number;
  };
  breakpoint?: {
    payload?: unknown;
    confirmationRequired?: boolean;
  };
  skill?: {
    name?: string;
  };
  agent?: {
    name?: string;
  };
}

export interface BreakpointContextFile {
  path: string;
  format?: string;
  language?: string;
  label?: string;
}

export interface BreakpointCreateInput {
  question: string;
  title: string;
  runId: string;
  files?: BreakpointContextFile[];
}

export interface BreakpointClient {
  create(input: BreakpointCreateInput): Promise<{ breakpointId: string; raw?: unknown }>;
  wait(input: { breakpointId: string; intervalSeconds?: number }): Promise<unknown>;
}

export type NativeOrchestratorAction =
  | {
      action: "none";
      reason: "terminal-state" | "no-pending-effects" | "unknown-effect-kind";
      status?: string;
      kind?: string;
    }
  | {
      action: "executed-tasks";
      count: number;
      reason: "auto-runnable-tasks";
    }
  | {
      action: "executed-breakpoints";
      count: number;
      reason: "breakpoints-processed";
    }
  | {
      action: "executed-skills";
      count: number;
      reason: "skill-tasks-processed";
    }
  | {
      action: "executed-agents";
      count: number;
      reason: "agent-tasks-processed";
    }
  | {
      action: "waiting";
      reason: "breakpoint-waiting" | "sleep-waiting";
      count?: number;
      until?: number;
    }
  | {
      action: "invoke-skills";
      count: number;
      reason: "skill-tasks-pending";
      skills: Array<{
        effectId: string;
        label: string;
        skillName?: string;
        kind: "skill";
      }>;
      instructions: string;
    }
  | {
      action: "invoke-agents";
      count: number;
      reason: "agent-tasks-pending";
      agents: Array<{
        effectId: string;
        label: string;
        agentName?: string;
        kind: "agent";
      }>;
      instructions: string;
    };

interface RunStatusProvider {
  runStatus(runId: string, cwd?: string): Promise<{ state: string }>;
}

interface PendingTaskProvider {
  taskListPending(runId: string, cwd?: string): Promise<TaskListEntry[]>;
}

interface TaskPostProvider {
  taskPost(
    runId: string,
    effectId: string,
    options:
      | { status: "ok"; valueRef: string; stdoutRef?: string; stderrRef?: string }
      | { status: "error"; errorPayload: unknown; stdoutRef?: string; stderrRef?: string },
    cwd?: string
  ): Promise<void>;
}

export interface NodeRunner {
  run(input: {
    cwd: string;
    entryPath: string;
    args: string[];
    env: Record<string, string | undefined>;
    timeoutMs: number;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface DelegatedTaskInput {
  sessionId?: string;
  runId: string;
  effectId: string;
  runDir: string;
  task: TaskListEntry;
  taskDefinition: NodeTaskDefinition;
  inputRef: string;
  inputPath: string;
  outputRef: string;
  outputPath: string;
  input: unknown;
}

export interface DelegatedTaskResult {
  status: "ok" | "error";
  value?: unknown;
  error?: unknown;
  stdout?: string;
  stderr?: string;
}

export interface SkillRunner {
  run(input: DelegatedTaskInput): Promise<DelegatedTaskResult>;
}

export interface AgentRunner {
  run(input: DelegatedTaskInput): Promise<DelegatedTaskResult>;
}

export interface NativeOrchestratorOptions {
  sessionId?: string;
  runId: string;
  worktree: string;
  cli: Pick<BabysitterCli, "runStatus" | "taskListPending" | "taskPost">;
  nodeRunner?: NodeRunner;
  breakpoints?: BreakpointClient;
  skillRunner?: SkillRunner;
  agentRunner?: AgentRunner;
  onTaskEvent?: (event: {
    phase: "start" | "complete" | "fail";
    runId: string;
    effectId: string;
    kind: string;
    status?: "ok" | "error";
    message?: string;
  }) => Promise<void>;
  breakpointPollIntervalSeconds?: number;
  maxAutoRunnable?: number;
}

export async function runNativeOrchestrator(options: NativeOrchestratorOptions): Promise<NativeOrchestratorAction> {
  const runId = options.runId.trim();
  if (!runId) {
    throw new Error("runId must be a non-empty string");
  }

  const worktree = options.worktree.trim();
  if (!worktree) {
    throw new Error("worktree must be a non-empty string");
  }

  const runStatus = await options.cli.runStatus(runId, worktree);
  if (runStatus.state === "completed" || runStatus.state === "failed") {
    return {
      action: "none",
      reason: "terminal-state",
      status: runStatus.state,
    };
  }

  const pending = await options.cli.taskListPending(runId, worktree);
  if (pending.length === 0) {
    return {
      action: "none",
      reason: "no-pending-effects",
    };
  }

  const autoRunnableLimit = options.maxAutoRunnable ?? DEFAULT_AUTO_RUN_LIMIT;
  const nodeTasks = pending.filter((task) => task.kind === "node").slice(0, autoRunnableLimit);
  if (nodeTasks.length > 0) {
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const nodeRunner = options.nodeRunner ?? createDefaultNodeRunner();

    for (const task of nodeTasks) {
      await executeNodeTask({
        runId,
        runDir,
        task,
        cli: options.cli,
        worktree,
        nodeRunner,
        onTaskEvent: options.onTaskEvent,
      });
    }

    return {
      action: "executed-tasks",
      count: nodeTasks.length,
      reason: "auto-runnable-tasks",
    };
  }

  const breakpointTasks = pending.filter((task) => task.kind === "breakpoint");
  if (breakpointTasks.length > 0) {
    if (options.breakpoints) {
      const runDir = path.join(worktree, ".a5c", "runs", runId);
      for (const task of breakpointTasks) {
        await executeBreakpointTask({
          runId,
          runDir,
          task,
          cli: options.cli,
          worktree,
          breakpoints: options.breakpoints,
          intervalSeconds: options.breakpointPollIntervalSeconds,
          onTaskEvent: options.onTaskEvent,
        });
      }
      return {
        action: "executed-breakpoints",
        count: breakpointTasks.length,
        reason: "breakpoints-processed",
      };
    }

    return {
      action: "waiting",
      reason: "breakpoint-waiting",
      count: breakpointTasks.length,
    };
  }

  const sleepTask = pending.find((task) => task.kind === "sleep");
  if (sleepTask) {
    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const taskDef = await loadTaskDefinition(runDir, sleepTask);
    return {
      action: "waiting",
      reason: "sleep-waiting",
      until:
        taskDef && taskDef.sleep && typeof taskDef.sleep.targetEpochMs === "number"
          ? taskDef.sleep.targetEpochMs
          : undefined,
    };
  }

  const skillTasks = pending.filter((task) => task.kind === "skill");
  if (skillTasks.length > 0) {
    if (options.skillRunner) {
      const runDir = path.join(worktree, ".a5c", "runs", runId);
      for (const task of skillTasks) {
        await executeDelegatedTask({
          sessionId: options.sessionId,
          runId,
          runDir,
          task,
          cli: options.cli,
          worktree,
          runner: options.skillRunner,
          fallbackErrorMessage: "Skill task execution failed",
          kind: "skill",
          onTaskEvent: options.onTaskEvent,
        });
      }
      return {
        action: "executed-skills",
        count: skillTasks.length,
        reason: "skill-tasks-processed",
      };
    }

    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const skills = await collectSkillInvocations(runDir, skillTasks);
    return {
      action: "invoke-skills",
      count: skillTasks.length,
      reason: "skill-tasks-pending",
      skills,
      instructions: "Use the Skill tool to invoke each skill, then post task results via task:post.",
    };
  }

  const agentTasks = pending.filter((task) => task.kind === "agent");
  if (agentTasks.length > 0) {
    if (options.agentRunner) {
      const runDir = path.join(worktree, ".a5c", "runs", runId);
      for (const task of agentTasks) {
        await executeDelegatedTask({
          sessionId: options.sessionId,
          runId,
          runDir,
          task,
          cli: options.cli,
          worktree,
          runner: options.agentRunner,
          fallbackErrorMessage: "Agent task execution failed",
          kind: "agent",
          onTaskEvent: options.onTaskEvent,
        });
      }
      return {
        action: "executed-agents",
        count: agentTasks.length,
        reason: "agent-tasks-processed",
      };
    }

    const runDir = path.join(worktree, ".a5c", "runs", runId);
    const agents = await collectAgentInvocations(runDir, agentTasks);
    return {
      action: "invoke-agents",
      count: agentTasks.length,
      reason: "agent-tasks-pending",
      agents,
      instructions: "Use the Task tool to delegate each agent task, then post task results via task:post.",
    };
  }

  return {
    action: "none",
    reason: "unknown-effect-kind",
    kind: pending[0].kind ?? "unknown",
  };
}

async function collectSkillInvocations(
  runDir: string,
  tasks: TaskListEntry[]
): Promise<Array<{ effectId: string; label: string; skillName?: string; kind: "skill" }>> {
  const result: Array<{ effectId: string; label: string; skillName?: string; kind: "skill" }> = [];
  for (const task of tasks) {
    const taskDef = await loadTaskDefinition(runDir, task);
    result.push({
      effectId: task.effectId,
      label: task.label ?? task.effectId,
      skillName: taskDef?.skill?.name,
      kind: "skill",
    });
  }
  return result;
}

async function collectAgentInvocations(
  runDir: string,
  tasks: TaskListEntry[]
): Promise<Array<{ effectId: string; label: string; agentName?: string; kind: "agent" }>> {
  const result: Array<{ effectId: string; label: string; agentName?: string; kind: "agent" }> = [];
  for (const task of tasks) {
    const taskDef = await loadTaskDefinition(runDir, task);
    result.push({
      effectId: task.effectId,
      label: task.label ?? task.effectId,
      agentName: taskDef?.agent?.name,
      kind: "agent",
    });
  }
  return result;
}

async function executeNodeTask(input: {
  runId: string;
  runDir: string;
  task: TaskListEntry;
  cli: RunStatusProvider & PendingTaskProvider & TaskPostProvider;
  worktree: string;
  nodeRunner: NodeRunner;
  onTaskEvent?: NativeOrchestratorOptions["onTaskEvent"];
}): Promise<void> {
  await emitTaskEvent(input.onTaskEvent, {
    phase: "start",
    runId: input.runId,
    effectId: input.task.effectId,
    kind: "node",
  });

  const taskDef = await loadTaskDefinition(input.runDir, input.task);
  if (!taskDef) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload: {
          name: "Error",
          message: `Missing task definition for effect ${input.task.effectId}`,
        },
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: "node",
      status: "error",
      message: "Missing task definition",
    });
    return;
  }

  const entry = taskDef.node?.entry;
  if (!entry) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload: {
          name: "Error",
          message: "Missing node.entry in task definition",
          data: { effectId: input.task.effectId },
        },
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: "node",
      status: "error",
      message: "Missing node.entry",
    });
    return;
  }

  const io = resolveIoPaths(input.task.effectId, taskDef);

  const inputAbs = path.join(input.runDir, io.inputRef);
  const outputAbs = path.join(input.runDir, io.outputRef);
  const stdoutAbs = path.join(input.runDir, io.stdoutRef);
  const stderrAbs = path.join(input.runDir, io.stderrRef);

  await ensureParentDirs([inputAbs, outputAbs, stdoutAbs, stderrAbs]);
  await stageTaskInput({
    runDir: input.runDir,
    inputAbs,
    taskDef,
    fallbackInputsRef: input.task.inputsRef,
  });

  const entryAbs = resolvePathFromRun(input.runDir, entry);
  const cwdAbs = resolvePathFromRun(input.runDir, taskDef.node?.cwd ?? "");
  const timeoutMs =
    typeof taskDef.node?.timeoutMs === "number" && Number.isFinite(taskDef.node.timeoutMs) && taskDef.node.timeoutMs > 0
      ? taskDef.node.timeoutMs
      : DEFAULT_NODE_TIMEOUT_MS;

  const runResult = await input.nodeRunner.run({
    cwd: cwdAbs || input.runDir,
    entryPath: entryAbs,
    args: Array.isArray(taskDef.node?.args) ? taskDef.node.args.slice() : [],
    env: {
      ...process.env,
      ...(taskDef.node?.env ?? {}),
      BABYSITTER_INPUT_JSON: inputAbs,
      BABYSITTER_OUTPUT_JSON: outputAbs,
      BABYSITTER_STDOUT_PATH: stdoutAbs,
      BABYSITTER_STDERR_PATH: stderrAbs,
      BABYSITTER_EFFECT_ID: input.task.effectId,
    },
    timeoutMs,
  });

  await fs.writeFile(stdoutAbs, runResult.stdout, "utf8");
  await fs.writeFile(stderrAbs, runResult.stderr, "utf8");

  if (runResult.exitCode === 0 && (await pathExists(outputAbs))) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "ok",
        valueRef: io.outputRef,
        stdoutRef: io.stdoutRef,
        stderrRef: io.stderrRef,
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "complete",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: "node",
      status: "ok",
    });
    return;
  }

  const errorMessage =
    runResult.exitCode !== 0
      ? "Node task exited non-zero"
      : "Node task completed without writing expected output file";

  await input.cli.taskPost(
    input.runId,
    input.task.effectId,
    {
      status: "error",
      errorPayload: {
        name: "Error",
        message: errorMessage,
        data: {
          effectId: input.task.effectId,
          exitCode: runResult.exitCode,
          outputRef: io.outputRef,
        },
      },
      stdoutRef: io.stdoutRef,
      stderrRef: io.stderrRef,
    },
    input.worktree
  );
  await emitTaskEvent(input.onTaskEvent, {
    phase: "fail",
    runId: input.runId,
    effectId: input.task.effectId,
    kind: "node",
    status: "error",
    message: errorMessage,
  });
}

async function executeBreakpointTask(input: {
  runId: string;
  runDir: string;
  task: TaskListEntry;
  cli: RunStatusProvider & PendingTaskProvider & TaskPostProvider;
  worktree: string;
  breakpoints: BreakpointClient;
  intervalSeconds?: number;
  onTaskEvent?: NativeOrchestratorOptions["onTaskEvent"];
}): Promise<void> {
  await emitTaskEvent(input.onTaskEvent, {
    phase: "start",
    runId: input.runId,
    effectId: input.task.effectId,
    kind: "breakpoint",
  });

  const taskDef = await loadTaskDefinition(input.runDir, input.task);
  const io = resolveIoPaths(input.task.effectId, taskDef ?? {});
  const outputAbs = path.join(input.runDir, io.outputRef);
  await ensureParentDirs([outputAbs]);

  try {
    const createInput = buildBreakpointCreateInput(input.runId, input.task, taskDef);
    const created = await input.breakpoints.create(createInput);
    const waitResult = await input.breakpoints.wait({
      breakpointId: created.breakpointId,
      intervalSeconds: input.intervalSeconds,
    });

    const resultPayload = {
      breakpointId: created.breakpointId,
      released: true,
      feedback: waitResult,
    };
    await fs.writeFile(outputAbs, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf8");

    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "ok",
        valueRef: io.outputRef,
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "complete",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: "breakpoint",
      status: "ok",
    });
  } catch (error) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload: {
          name: "Error",
          message: "Breakpoint resolution failed",
          data: {
            effectId: input.task.effectId,
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: "breakpoint",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeDelegatedTask(input: {
  sessionId?: string;
  runId: string;
  runDir: string;
  task: TaskListEntry;
  cli: RunStatusProvider & PendingTaskProvider & TaskPostProvider;
  worktree: string;
  runner: SkillRunner | AgentRunner;
  fallbackErrorMessage: string;
  kind: "skill" | "agent";
  onTaskEvent?: NativeOrchestratorOptions["onTaskEvent"];
}): Promise<void> {
  await emitTaskEvent(input.onTaskEvent, {
    phase: "start",
    runId: input.runId,
    effectId: input.task.effectId,
    kind: input.kind,
  });

  const taskDef = await loadTaskDefinition(input.runDir, input.task);
  if (!taskDef) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload: {
          name: "Error",
          message: `Missing task definition for effect ${input.task.effectId}`,
        },
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: input.kind,
      status: "error",
      message: "Missing task definition",
    });
    return;
  }

  const io = resolveIoPaths(input.task.effectId, taskDef);
  const inputAbs = path.join(input.runDir, io.inputRef);
  const outputAbs = path.join(input.runDir, io.outputRef);
  const stdoutAbs = path.join(input.runDir, io.stdoutRef);
  const stderrAbs = path.join(input.runDir, io.stderrRef);

  await ensureParentDirs([inputAbs, outputAbs, stdoutAbs, stderrAbs]);
  await stageTaskInput({
    runDir: input.runDir,
    inputAbs,
    taskDef,
    fallbackInputsRef: input.task.inputsRef,
  });

  const stagedInput = await readJsonFile(inputAbs);

  try {
    const runResult = await input.runner.run({
      sessionId: input.sessionId,
      runId: input.runId,
      effectId: input.task.effectId,
      runDir: input.runDir,
      task: input.task,
      taskDefinition: taskDef,
      inputRef: io.inputRef,
      inputPath: inputAbs,
      outputRef: io.outputRef,
      outputPath: outputAbs,
      input: stagedInput,
    });

    const stdoutRef = runResult.stdout !== undefined ? io.stdoutRef : undefined;
    const stderrRef = runResult.stderr !== undefined ? io.stderrRef : undefined;
    if (runResult.stdout !== undefined) {
      await fs.writeFile(stdoutAbs, runResult.stdout, "utf8");
    }
    if (runResult.stderr !== undefined) {
      await fs.writeFile(stderrAbs, runResult.stderr, "utf8");
    }

    if (runResult.status === "ok") {
      await fs.writeFile(outputAbs, `${JSON.stringify(runResult.value ?? {}, null, 2)}\n`, "utf8");
      await input.cli.taskPost(
        input.runId,
        input.task.effectId,
        {
          status: "ok",
          valueRef: io.outputRef,
          stdoutRef,
          stderrRef,
        },
        input.worktree
      );
      await emitTaskEvent(input.onTaskEvent, {
        phase: "complete",
        runId: input.runId,
        effectId: input.task.effectId,
        kind: input.kind,
        status: "ok",
      });
      return;
    }

    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload:
          runResult.error ?? {
            name: "Error",
            message: input.fallbackErrorMessage,
            data: { effectId: input.task.effectId },
          },
        stdoutRef,
        stderrRef,
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: input.kind,
      status: "error",
      message: input.fallbackErrorMessage,
    });
  } catch (error) {
    await input.cli.taskPost(
      input.runId,
      input.task.effectId,
      {
        status: "error",
        errorPayload: {
          name: "Error",
          message: input.fallbackErrorMessage,
          data: {
            effectId: input.task.effectId,
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      input.worktree
    );
    await emitTaskEvent(input.onTaskEvent, {
      phase: "fail",
      runId: input.runId,
      effectId: input.task.effectId,
      kind: input.kind,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildBreakpointCreateInput(
  runId: string,
  task: TaskListEntry,
  taskDef: NodeTaskDefinition | null
): BreakpointCreateInput {
  const payload = toRecord(taskDef?.breakpoint?.payload);
  const context = toRecord(payload?.context);
  const files = normalizeBreakpointFiles(context?.files);

  const question =
    asString(payload?.question) ??
    asString(payload?.prompt) ??
    taskDef?.description?.trim() ??
    task.label?.trim() ??
    "Breakpoint reached";

  const title = taskDef?.title?.trim() || task.label?.trim() || "Breakpoint";

  return {
    question,
    title,
    runId,
    files: files.length ? files : undefined,
  };
}

function normalizeBreakpointFiles(value: unknown): BreakpointContextFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const file: BreakpointContextFile = {
        path: asString(entry.path) ?? "",
      };
      const format = asString(entry.format);
      const language = asString(entry.language);
      const label = asString(entry.label);
      if (format) file.format = format;
      if (language) file.language = language;
      if (label) file.label = label;
      return file;
    })
    .filter((file) => file.path.length > 0);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveIoPaths(effectId: string, taskDef: NodeTaskDefinition): {
  inputRef: string;
  outputRef: string;
  stdoutRef: string;
  stderrRef: string;
} {
  const base = `tasks/${effectId}`;
  return {
    inputRef: taskDef.io?.inputJsonPath ?? `${base}/inputs.json`,
    outputRef: taskDef.io?.outputJsonPath ?? `${base}/result.json`,
    stdoutRef: taskDef.io?.stdoutPath ?? `${base}/stdout.log`,
    stderrRef: taskDef.io?.stderrPath ?? `${base}/stderr.log`,
  };
}

async function stageTaskInput(input: {
  runDir: string;
  inputAbs: string;
  taskDef: NodeTaskDefinition;
  fallbackInputsRef?: string | null;
}): Promise<void> {
  const candidateRefs = [input.taskDef.inputsRef, input.fallbackInputsRef].filter(
    (ref): ref is string => typeof ref === "string" && ref.trim().length > 0
  );

  for (const ref of candidateRefs) {
    const source = path.join(input.runDir, ref);
    if (await pathExists(source)) {
      await fs.copyFile(source, input.inputAbs);
      return;
    }
  }

  const payload = input.taskDef.inputs ?? {};
  await fs.writeFile(input.inputAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolvePathFromRun(runDir: string, value: string): string {
  if (!value) {
    return "";
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return value;
  }
  return path.join(runDir, value);
}

async function ensureParentDirs(paths: string[]): Promise<void> {
  await Promise.all(paths.map((filePath) => fs.mkdir(path.dirname(filePath), { recursive: true })));
}

async function loadTaskDefinition(runDir: string, task: TaskListEntry): Promise<NodeTaskDefinition | null> {
  const taskDefRef = task.taskDefRef ?? `tasks/${task.effectId}/task.json`;
  const taskDefPath = path.join(runDir, taskDefRef);
  if (!(await pathExists(taskDefPath))) {
    return null;
  }

  const raw = await fs.readFile(taskDefPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as NodeTaskDefinition;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function emitTaskEvent(
  callback: NativeOrchestratorOptions["onTaskEvent"] | undefined,
  event: {
    phase: "start" | "complete" | "fail";
    runId: string;
    effectId: string;
    kind: string;
    status?: "ok" | "error";
    message?: string;
  }
): Promise<void> {
  if (!callback) {
    return;
  }
  try {
    await callback(event);
  } catch {
    // Ignore lifecycle callback failures.
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createDefaultNodeRunner(): NodeRunner {
  return {
    async run(input) {
      return new Promise((resolve, reject) => {
        const child = spawn("node", [input.entryPath, ...input.args], {
          cwd: input.cwd,
          env: input.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, input.timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (timedOut) {
            resolve({
              exitCode: 124,
              stdout,
              stderr: `${stderr}\nTask timed out after ${input.timeoutMs}ms`.trim(),
            });
            return;
          }
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
          });
        });
      });
    },
  };
}
