import { BabysitterCli, RunStatusResult } from "./cli/babysitterCli";
import { evaluateIdleLoop, IdleLoopAction } from "./loop/idleLoop";
import {
  BreakpointClient,
  NativeOrchestratorAction,
  NodeRunner,
  runNativeOrchestrator,
} from "./orchestrator/nativeOrchestrator";
import { SessionState, SessionStateStore, StartSessionOptions } from "./state/sessionState";

export interface SessionPromptClient {
  session: {
    prompt(input: {
      path: { id: string };
      body: { parts: Array<{ type: "text"; text: string }> };
    }): Promise<unknown>;
  };
  app?: {
    log(input: {
      body: {
        service: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        extra?: Record<string, unknown>;
      };
    }): Promise<unknown>;
  };
}

export interface BabysitterRuntimeOptions {
  client: SessionPromptClient;
  sessions?: SessionStateStore;
  cli?: Pick<BabysitterCli, "runStatus"> &
    Partial<Pick<BabysitterCli, "taskListPending" | "taskPost">>;
  worktree?: string;
  maxAutoRunnable?: number;
  nodeRunner?: NodeRunner;
  breakpoints?: BreakpointClient;
  breakpointPollIntervalSeconds?: number;
  now?: () => Date;
}

export interface PluginLikeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface PluginLikeHooks {
  event(input: { event: PluginLikeEvent }): Promise<void>;
}

export interface BabysitterRuntime {
  setupSession(sessionId: string, options: StartSessionOptions): SessionState;
  associateRun(sessionId: string, runId: string): SessionState;
  stopSession(sessionId: string): boolean;
  onSessionIdle(sessionId: string): Promise<IdleLoopAction>;
  sessions: SessionStateStore;
}

export function createBabysitterRuntime(options: BabysitterRuntimeOptions): BabysitterRuntime {
  const sessions = options.sessions ?? new SessionStateStore();

  return {
    sessions,
    setupSession(sessionId, setupOptions) {
      return sessions.start(sessionId, setupOptions);
    },
    associateRun(sessionId, runId) {
      return sessions.associateRun(sessionId, runId);
    },
    stopSession(sessionId) {
      return sessions.stop(sessionId);
    },
    async onSessionIdle(sessionId) {
      const current = sessions.get(sessionId);
      if (!current) {
        return {
          type: "noop",
          reason: "no-active-session",
          state: createInactiveState(sessionId),
        };
      }

      let runStatus: RunStatusResult | undefined;
      let nativeDecision: NativeOrchestratorAction | undefined;
      if (current.runId && options.cli) {
        if (supportsNativeOrchestrator(options.cli) && options.worktree) {
          nativeDecision = await runNativeOrchestrator({
            runId: current.runId,
            worktree: options.worktree,
            cli: options.cli,
            maxAutoRunnable: options.maxAutoRunnable,
            nodeRunner: options.nodeRunner,
            breakpoints: options.breakpoints,
            breakpointPollIntervalSeconds: options.breakpointPollIntervalSeconds,
          });
          await logIfAvailable(options.client, "debug", "Native orchestrator decision", {
            sessionId,
            runId: current.runId,
            ...nativeDecision,
          });
        }

        runStatus = await options.cli.runStatus(current.runId, options.worktree);
      }

      const action = evaluateIdleLoop({
        session: current,
        runStatus,
        now: options.now?.(),
      });

      if (action.type === "deactivate") {
        sessions.stop(sessionId);
        await logIfAvailable(options.client, "info", "Babysitter loop deactivated", {
          sessionId,
          reason: action.reason,
        });
        return action;
      }

      sessions.set(sessionId, action.state);

      if (action.type === "prompt") {
        const hint = buildOrchestratorHint(nativeDecision);
        const text = hint
          ? `${action.systemMessage}\n${hint}\n\n${action.prompt}`
          : `${action.systemMessage}\n\n${action.prompt}`;
        await options.client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text }],
          },
        });
      }

      return action;
    },
  };
}

function buildOrchestratorHint(decision?: NativeOrchestratorAction): string | null {
  if (!decision) {
    return null;
  }

  if (decision.action === "executed-tasks") {
    return `Native orchestrator executed ${decision.count} node task(s). Continue with run:iterate.`;
  }

  if (decision.action === "executed-breakpoints") {
    return `Native orchestrator processed ${decision.count} breakpoint task(s) and posted results.`;
  }

  if (decision.action === "waiting") {
    if (decision.reason === "breakpoint-waiting") {
      return "Pending breakpoint tasks require user or external approval before progression.";
    }
    if (decision.reason === "sleep-waiting") {
      const until = typeof decision.until === "number" ? ` until ${decision.until}` : "";
      return `Pending sleep task blocks iteration${until}.`;
    }
  }

  if (decision.action === "invoke-skills") {
    const labels = decision.skills
      .map((entry) => (entry.skillName ? `${entry.label}:${entry.skillName}` : entry.label))
      .join(", ");
    return `Skill tasks pending (${labels}). ${decision.instructions}`;
  }

  if (decision.action === "invoke-agents") {
    const labels = decision.agents
      .map((entry) => (entry.agentName ? `${entry.label}:${entry.agentName}` : entry.label))
      .join(", ");
    return `Agent tasks pending (${labels}). ${decision.instructions}`;
  }

  return null;
}

function supportsNativeOrchestrator(
  cli: Pick<BabysitterCli, "runStatus"> & Partial<Pick<BabysitterCli, "taskListPending" | "taskPost">>
): cli is Pick<BabysitterCli, "runStatus" | "taskListPending" | "taskPost"> {
  return typeof cli.taskListPending === "function" && typeof cli.taskPost === "function";
}

export function createBabysitterPluginHooks(runtime: BabysitterRuntime): PluginLikeHooks {
  return {
    async event(input: { event: PluginLikeEvent }) {
      if (input.event.type !== "session.idle") {
        return;
      }
      const sessionId = extractSessionId(input.event);
      if (!sessionId) {
        return;
      }
      await runtime.onSessionIdle(sessionId);
    },
  };
}

function extractSessionId(event: PluginLikeEvent): string | null {
  const properties = event.properties ?? {};
  const keys = ["sessionId", "sessionID", "session_id", "id"];
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function createInactiveState(sessionId: string): SessionState {
  return {
    active: false,
    sessionId,
    iteration: 0,
    maxIterations: 0,
    runId: null,
    prompt: "",
    startedAt: new Date(0).toISOString(),
    lastIterationAt: new Date(0).toISOString(),
    iterationTimes: [],
  };
}

async function logIfAvailable(
  client: SessionPromptClient,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra: Record<string, unknown>
) {
  if (!client.app?.log) {
    return;
  }
  await client.app.log({
    body: {
      service: "babysitter-opencode",
      level,
      message,
      extra,
    },
  });
}
