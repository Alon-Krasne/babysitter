import type { RunStatusResult } from "../cli/babysitterCli";
import type { BabysitterRuntime } from "../runtime";

export interface ToolContextLike {
  sessionID?: string;
  sessionId?: string;
  directory?: string;
  worktree?: string;
}

export interface SetupArgs {
  prompt: string;
  maxIterations?: number;
  runId?: string;
}

export interface ResumeArgs {
  runId: string;
  maxIterations?: number;
  prompt?: string;
}

export interface AssociateArgs {
  runId: string;
}

export interface StatusArgs {
  sessionId?: string;
}

export interface StopArgs {
  sessionId?: string;
}

type CliStatusProvider = Pick<{
  runStatus(runId: string, cwd?: string): Promise<RunStatusResult>;
}, "runStatus">;

interface ToolDefinition<TArgs, TResult> {
  description: string;
  execute(args: TArgs, context: ToolContextLike): Promise<TResult>;
}

export interface BabysitterToolHandlers {
  babysitter_setup: ToolDefinition<SetupArgs, { sessionId: string; runId: string | null; iteration: number }>;
  babysitter_resume: ToolDefinition<ResumeArgs, { sessionId: string; runId: string; state: string }>;
  babysitter_associate: ToolDefinition<AssociateArgs, { sessionId: string; runId: string }>;
  babysitter_status: ToolDefinition<StatusArgs, Record<string, unknown>>;
  babysitter_stop: ToolDefinition<StopArgs, { sessionId: string; stopped: boolean }>;
}

export function createBabysitterToolHandlers(
  runtime: BabysitterRuntime,
  options: { cli?: CliStatusProvider; now?: () => Date } = {}
): BabysitterToolHandlers {
  return {
    babysitter_setup: {
      description: "Start babysitter loop in current session",
      async execute(args, context) {
        const sessionId = resolveSessionId(context);
        runtime.setupSession(sessionId, {
          prompt: args.prompt,
          maxIterations: args.maxIterations,
          runId: args.runId,
          now: options.now?.(),
        });
        const state = runtime.sessions.get(sessionId);
        if (!state) {
          throw new Error("Failed to initialize babysitter session state");
        }
        return {
          sessionId,
          runId: state.runId,
          iteration: state.iteration,
        };
      },
    },
    babysitter_resume: {
      description: "Resume an existing babysitter run in current session",
      async execute(args, context) {
        const sessionId = resolveSessionId(context);
        const runId = args.runId.trim();
        if (!runId) {
          throw new Error("runId must be a non-empty string");
        }
        const status = options.cli ? await options.cli.runStatus(runId, context.directory) : { state: "unknown" };
        const prompt =
          args.prompt?.trim() ||
          [
            `Resume Babysitter run: ${runId}`,
            "",
            `Current state: ${status.state}`,
            "",
            "Continue orchestration using run:iterate and task:post.",
          ].join("\n");

        runtime.setupSession(sessionId, {
          prompt,
          maxIterations: args.maxIterations,
          runId,
          now: options.now?.(),
        });

        return {
          sessionId,
          runId,
          state: status.state,
        };
      },
    },
    babysitter_associate: {
      description: "Associate active session with run id",
      async execute(args, context) {
        const sessionId = resolveSessionId(context);
        const state = runtime.associateRun(sessionId, args.runId);
        return {
          sessionId,
          runId: state.runId ?? args.runId,
        };
      },
    },
    babysitter_status: {
      description: "Inspect active babysitter session status",
      async execute(args, context) {
        const sessionId = (args.sessionId?.trim() || resolveSessionId(context));
        const state = runtime.sessions.get(sessionId);
        if (!state) {
          return {
            active: false,
            sessionId,
          };
        }

        const result: Record<string, unknown> = {
          active: true,
          sessionId,
          iteration: state.iteration,
          maxIterations: state.maxIterations,
          runId: state.runId,
        };

        if (state.runId && options.cli) {
          const runStatus = await options.cli.runStatus(state.runId, context.directory);
          result.runState = runStatus.state;
          if (runStatus.pendingByKind) {
            result.pendingByKind = runStatus.pendingByKind;
          }
        }

        return result;
      },
    },
    babysitter_stop: {
      description: "Stop babysitter loop for current session",
      async execute(args, context) {
        const sessionId = args.sessionId?.trim() || resolveSessionId(context);
        const stopped = runtime.stopSession(sessionId);
        return {
          sessionId,
          stopped,
        };
      },
    },
  };
}

export function resolveSessionId(context: ToolContextLike): string {
  const value = context.sessionID ?? context.sessionId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Tool context is missing session ID");
  }
  return value.trim();
}
