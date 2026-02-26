import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  cwd?: string;
  input?: string;
}

export interface CommandExecutor {
  run(command: string, args: string[], options?: CommandRunOptions): Promise<CommandResult>;
}

export interface RunStatusResult {
  state: string;
  pendingByKind?: Record<string, number>;
  completionSecret?: string | null;
}

export interface TaskListEntry {
  effectId: string;
  kind?: string;
  label?: string;
  status?: string;
  taskId?: string;
  taskDefRef?: string | null;
  inputsRef?: string | null;
}

export interface TaskPostOkOptions {
  status: "ok";
  valueRef: string;
  stdoutRef?: string;
  stderrRef?: string;
}

export interface TaskPostErrorOptions {
  status: "error";
  errorPayload: unknown;
  stdoutRef?: string;
  stderrRef?: string;
}

export type TaskPostOptions = TaskPostOkOptions | TaskPostErrorOptions;

type JsonRecord = Record<string, unknown>;

export class BabysitterCli {
  constructor(
    private readonly executor: CommandExecutor,
    private readonly command = "babysitter"
  ) {}

  async runStatus(runId: string, cwd?: string): Promise<RunStatusResult> {
    const normalizedRunId = normalizeNonEmpty(runId, "runId");
    const parsed = await this.execJson(["run:status", normalizedRunId, "--json"], { cwd }, "run:status");
    if (typeof parsed.state !== "string") {
      throw new Error("Unable to parse babysitter run:status JSON output");
    }

    return {
      state: parsed.state,
      pendingByKind:
        parsed.pendingByKind && typeof parsed.pendingByKind === "object" && !Array.isArray(parsed.pendingByKind)
          ? (parsed.pendingByKind as Record<string, number>)
          : undefined,
      completionSecret:
        parsed.completionSecret === null || typeof parsed.completionSecret === "string"
          ? parsed.completionSecret
          : undefined,
    };
  }

  async taskListPending(runId: string, cwd?: string): Promise<TaskListEntry[]> {
    const normalizedRunId = normalizeNonEmpty(runId, "runId");
    const parsed = await this.execJson(["task:list", normalizedRunId, "--pending", "--json"], { cwd }, "task:list");
    if (!Array.isArray(parsed.tasks)) {
      throw new Error("Unable to parse babysitter task:list JSON output");
    }

    return parsed.tasks
      .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        effectId: typeof entry.effectId === "string" ? entry.effectId : "",
        kind: typeof entry.kind === "string" ? entry.kind : undefined,
        label: typeof entry.label === "string" ? entry.label : undefined,
        status: typeof entry.status === "string" ? entry.status : undefined,
        taskId: typeof entry.taskId === "string" ? entry.taskId : undefined,
        taskDefRef: typeof entry.taskDefRef === "string" ? entry.taskDefRef : null,
        inputsRef: typeof entry.inputsRef === "string" ? entry.inputsRef : null,
      }))
      .filter((entry) => entry.effectId.length > 0);
  }

  async taskPost(runId: string, effectId: string, options: TaskPostOptions, cwd?: string): Promise<void> {
    const normalizedRunId = normalizeNonEmpty(runId, "runId");
    const normalizedEffectId = normalizeNonEmpty(effectId, "effectId");

    const args = ["task:post", normalizedRunId, normalizedEffectId, "--status", options.status, "--json"];

    if (options.status === "ok") {
      const valueRef = normalizeNonEmpty(options.valueRef, "valueRef");
      args.push("--value", valueRef);
      if (options.stdoutRef) args.push("--stdout-ref", options.stdoutRef);
      if (options.stderrRef) args.push("--stderr-ref", options.stderrRef);
      await this.execJson(args, { cwd }, "task:post");
      return;
    }

    args.push("--error", "-");
    if (options.stdoutRef) args.push("--stdout-ref", options.stdoutRef);
    if (options.stderrRef) args.push("--stderr-ref", options.stderrRef);

    await this.execJson(
      args,
      {
        cwd,
        input: `${JSON.stringify(options.errorPayload ?? { name: "Error", message: "Task execution failed" })}\n`,
      },
      "task:post"
    );
  }

  private async execJson(args: string[], options: CommandRunOptions, commandName: string): Promise<JsonRecord> {
    const result = await this.executor.run(this.command, args, options);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `babysitter ${commandName} failed with code ${result.exitCode}`);
    }

    const parsed = parseLastJsonLine(result.stdout);
    if (!parsed) {
      throw new Error(`Unable to parse babysitter ${commandName} JSON output`);
    }
    return parsed;
  }
}

export class SpawnCommandExecutor implements CommandExecutor {
  async run(command: string, args: string[], options?: CommandRunOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => reject(error));

      if (options?.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();

      child.on("close", (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }
}

function normalizeNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return normalized;
}

function parseLastJsonLine(stdout: string): JsonRecord | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonRecord;
      }
    } catch {
      // Continue searching previous lines.
    }
  }
  return null;
}
