import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface HookDispatchPayload {
  [key: string]: unknown;
}

export interface HookExecutionResult {
  source: "repo" | "user" | "plugin";
  scriptPath: string;
  scriptName: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HookDispatchResult {
  hookName: string;
  results: HookExecutionResult[];
}

export interface HookCommandRunner {
  run(scriptPath: string, payload: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface HookDispatcherOptions {
  worktree: string;
  pluginRoot?: string;
  userConfigDir?: string;
  commandRunner?: HookCommandRunner;
}

export class HookDispatcher {
  private readonly worktree: string;
  private readonly pluginRoot?: string;
  private readonly userConfigDir: string;
  private readonly commandRunner: HookCommandRunner;

  constructor(options: HookDispatcherOptions) {
    this.worktree = normalizeRequiredPath(options.worktree, "worktree");
    this.pluginRoot = options.pluginRoot?.trim() || undefined;
    this.userConfigDir = options.userConfigDir?.trim() || path.join(os.homedir(), ".config");
    this.commandRunner = options.commandRunner ?? new SpawnHookCommandRunner();
  }

  async dispatch(hookName: string, payload: HookDispatchPayload): Promise<HookDispatchResult> {
    const normalizedHookName = hookName.trim();
    if (!normalizedHookName) {
      throw new Error("hookName must be a non-empty string");
    }

    const payloadText = `${JSON.stringify(payload ?? {})}\n`;
    const sources = this.resolveHookSources(normalizedHookName);
    const results: HookExecutionResult[] = [];

    for (const source of sources) {
      const scripts = await listScripts(source.dir);
      for (const scriptPath of scripts) {
        const scriptName = path.basename(scriptPath);
        try {
          const execution = await this.commandRunner.run(scriptPath, payloadText);
          results.push({
            source: source.source,
            scriptPath,
            scriptName,
            success: execution.exitCode === 0,
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
          });
        } catch (error) {
          results.push({
            source: source.source,
            scriptPath,
            scriptName,
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      hookName: normalizedHookName,
      results,
    };
  }

  private resolveHookSources(hookName: string): Array<{ source: "repo" | "user" | "plugin"; dir: string }> {
    const sources: Array<{ source: "repo" | "user" | "plugin"; dir: string }> = [
      {
        source: "repo",
        dir: path.join(this.worktree, ".a5c", "hooks", hookName),
      },
      {
        source: "user",
        dir: path.join(this.userConfigDir, "babysitter", "hooks", hookName),
      },
    ];

    if (this.pluginRoot) {
      sources.push({
        source: "plugin",
        dir: path.join(this.pluginRoot, "hooks", hookName),
      });
    }

    return sources;
  }
}

class SpawnHookCommandRunner implements HookCommandRunner {
  async run(scriptPath: string, payload: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(scriptPath, {
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
      child.stdin.write(payload);
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

async function listScripts(directory: string): Promise<string[]> {
  let entries: Array<{ name: string; isFile: () => boolean }> = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT" || nodeError.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }

  const scripts = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));

  return scripts;
}

function normalizeRequiredPath(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}
