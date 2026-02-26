import { CommandExecutor, SpawnCommandExecutor } from "../cli/babysitterCli";
import { BreakpointClient, BreakpointContextFile, BreakpointCreateInput } from "../orchestrator/nativeOrchestrator";

export interface CliBreakpointClientOptions {
  command?: string;
  executor?: CommandExecutor;
}

export class CliBreakpointClient implements BreakpointClient {
  private readonly command: string;
  private readonly executor: CommandExecutor;

  constructor(options: CliBreakpointClientOptions = {}) {
    this.command = options.command ?? "breakpoints";
    this.executor = options.executor ?? new SpawnCommandExecutor();
  }

  async create(input: BreakpointCreateInput): Promise<{ breakpointId: string; raw?: unknown }> {
    const args = [
      "breakpoint",
      "create",
      "--question",
      input.question,
      "--title",
      input.title,
      "--run-id",
      input.runId,
    ];

    for (const file of input.files ?? []) {
      args.push("--file", serializeFileArg(file));
    }

    const output = await this.execJson(args);
    const breakpointId =
      asString(output.breakpointId) ?? asString(output.id) ?? asString(output.breakpoint_id);
    if (!breakpointId) {
      throw new Error("Breakpoint create did not return a breakpointId");
    }

    return {
      breakpointId,
      raw: output,
    };
  }

  async wait(input: { breakpointId: string; intervalSeconds?: number }): Promise<unknown> {
    const breakpointId = input.breakpointId.trim();
    if (!breakpointId) {
      throw new Error("breakpointId must be a non-empty string");
    }

    const args = ["breakpoint", "wait", breakpointId];
    if (typeof input.intervalSeconds === "number" && Number.isFinite(input.intervalSeconds) && input.intervalSeconds > 0) {
      args.push("--interval", String(input.intervalSeconds));
    }

    return this.execJson(args);
  }

  private async execJson(args: string[]): Promise<Record<string, unknown>> {
    const result = await this.executor.run(this.command, args);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `${this.command} ${args.join(" ")} failed with code ${result.exitCode}`);
    }

    const parsed = parseJsonFromOutput(result.stdout);
    if (!parsed) {
      throw new Error(`Unable to parse JSON output from ${this.command} ${args.join(" ")}`);
    }
    return parsed;
  }
}

function serializeFileArg(file: BreakpointContextFile): string {
  const parts = [file.path, file.format ?? "", file.language ?? "", file.label ?? ""];
  while (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts.join(",");
}

function parseJsonFromOutput(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    return tryParseJson(slice);
  }

  return null;
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
