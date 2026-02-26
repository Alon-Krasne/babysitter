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

export interface AskArgs {
  question: string;
  title?: string;
  choices?: string[];
}

export interface AskUserRequest {
  sessionId: string;
  question: string;
  title?: string;
  choices?: string[];
}

export interface AskUserResponse {
  status: "prompted" | "answered";
  answer?: string;
}

export interface ScoreCriterion {
  name: string;
  score: number;
  weight?: number;
}

export interface ScoreArgs {
  criteria: ScoreCriterion[];
  passThreshold?: number;
}

export interface ScoreResult {
  score: number;
  passed: boolean;
  threshold: number;
  breakdown: Array<{ name: string; score: number; weight: number }>;
}

export interface RunStartEvent {
  sessionId: string;
  runId: string;
  source: "setup" | "resume" | "associate";
  timestamp: string;
}

export interface ScoreEvent {
  sessionId?: string;
  score: number;
  threshold: number;
  passed: boolean;
  breakdown: Array<{ name: string; score: number; weight: number }>;
  timestamp: string;
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
  babysitter_ask: ToolDefinition<AskArgs, { sessionId: string; status: string; answer?: string; question: string }>;
  babysitter_score: ToolDefinition<ScoreArgs, ScoreResult>;
}

export function createBabysitterToolHandlers(
  runtime: BabysitterRuntime,
  options: {
    cli?: CliStatusProvider;
    now?: () => Date;
    askUser?: (request: AskUserRequest) => Promise<AskUserResponse>;
    onRunStart?: (event: RunStartEvent) => Promise<void>;
    onScore?: (event: ScoreEvent) => Promise<void>;
  } = {}
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
        if (state.runId) {
          await emitRunStartIfPossible(options.onRunStart, {
            sessionId,
            runId: state.runId,
            source: "setup",
            timestamp: (options.now?.() ?? new Date()).toISOString(),
          });
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

        await emitRunStartIfPossible(options.onRunStart, {
          sessionId,
          runId,
          source: "resume",
          timestamp: (options.now?.() ?? new Date()).toISOString(),
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
        if (state.runId) {
          await emitRunStartIfPossible(options.onRunStart, {
            sessionId,
            runId: state.runId,
            source: "associate",
            timestamp: (options.now?.() ?? new Date()).toISOString(),
          });
        }
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
    babysitter_ask: {
      description: "Ask the user an orchestration question",
      async execute(args, context) {
        const sessionId = resolveSessionId(context);
        const question = args.question.trim();
        if (!question) {
          throw new Error("question must be a non-empty string");
        }

        if (!options.askUser) {
          return {
            sessionId,
            status: "prompted",
            question,
          };
        }

        const response = await options.askUser({
          sessionId,
          question,
          title: args.title?.trim() || undefined,
          choices: Array.isArray(args.choices) ? args.choices.filter((choice) => typeof choice === "string" && choice.trim()) : undefined,
        });

        return {
          sessionId,
          status: response.status,
          answer: response.answer,
          question,
        };
      },
    },
    babysitter_score: {
      description: "Compute weighted quality convergence score",
      async execute(args, context) {
        if (!Array.isArray(args.criteria) || args.criteria.length === 0) {
          throw new Error("criteria must contain at least one item");
        }

        const normalized = args.criteria.map((criterion) => {
          const name = criterion.name.trim();
          if (!name) {
            throw new Error("criterion name must be a non-empty string");
          }
          const score = Number(criterion.score);
          if (!Number.isFinite(score)) {
            throw new Error(`criterion score must be numeric (${name})`);
          }
          const clampedScore = Math.max(0, Math.min(100, score));
          const rawWeight = criterion.weight === undefined ? 1 : Number(criterion.weight);
          if (!Number.isFinite(rawWeight) || rawWeight <= 0) {
            throw new Error(`criterion weight must be > 0 (${name})`);
          }
          return {
            name,
            score: clampedScore,
            weight: rawWeight,
          };
        });

        const totalWeight = normalized.reduce((acc, item) => acc + item.weight, 0);
        const weightedScore = normalized.reduce((acc, item) => acc + item.score * item.weight, 0) / totalWeight;
        const rounded = Math.round(weightedScore);
        const threshold = args.passThreshold === undefined ? 80 : Math.max(0, Math.min(100, Math.round(args.passThreshold)));

        const result = {
          score: rounded,
          passed: rounded >= threshold,
          threshold,
          breakdown: normalized,
        };

        const scoreSessionId =
          typeof context.sessionID === "string" && context.sessionID.trim()
            ? context.sessionID.trim()
            : typeof context.sessionId === "string" && context.sessionId.trim()
              ? context.sessionId.trim()
              : undefined;

        await emitScoreIfPossible(options.onScore, {
          sessionId: scoreSessionId,
          score: result.score,
          threshold: result.threshold,
          passed: result.passed,
          breakdown: result.breakdown,
          timestamp: (options.now?.() ?? new Date()).toISOString(),
        });

        return result;
      },
    },
  };
}

async function emitRunStartIfPossible(
  callback: ((event: RunStartEvent) => Promise<void>) | undefined,
  event: RunStartEvent
): Promise<void> {
  if (!callback) {
    return;
  }
  try {
    await callback(event);
  } catch {
    // Never fail tool execution because telemetry callback failed.
  }
}

async function emitScoreIfPossible(
  callback: ((event: ScoreEvent) => Promise<void>) | undefined,
  event: ScoreEvent
): Promise<void> {
  if (!callback) {
    return;
  }
  try {
    await callback(event);
  } catch {
    // Never fail tool execution because telemetry callback failed.
  }
}

export function resolveSessionId(context: ToolContextLike): string {
  const value = context.sessionID ?? context.sessionId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Tool context is missing session ID");
  }
  return value.trim();
}
