import { SessionState } from "../state/sessionState";
import { evaluateRunawayGuard } from "./runawayGuard";

export interface RunStatusSnapshot {
  state: string;
  pendingByKind?: Record<string, number>;
}

export type IdleLoopAction =
  | {
      type: "noop";
      reason: string;
      state: SessionState;
    }
  | {
      type: "deactivate";
      reason: string;
      state: SessionState;
    }
  | {
      type: "prompt";
      reason: string;
      state: SessionState;
      prompt: string;
      systemMessage: string;
    };

export interface IdleLoopInput {
  session: SessionState;
  runStatus?: RunStatusSnapshot | null;
  now?: Date;
}

export function evaluateIdleLoop(input: IdleLoopInput): IdleLoopAction {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const current = cloneState(input.session);

  if (!current.active) {
    return {
      type: "noop",
      reason: "session-inactive",
      state: current,
    };
  }

  const runaway = evaluateRunawayGuard({
    iteration: current.iteration,
    lastIterationAt: current.lastIterationAt,
    previousDurations: current.iterationTimes,
    now,
  });

  current.iterationTimes = runaway.durations;
  current.lastIterationAt = nowIso;

  if (runaway.shouldStop) {
    current.active = false;
    return {
      type: "deactivate",
      reason: "runaway-detected",
      state: current,
    };
  }

  if (current.maxIterations > 0 && current.iteration >= current.maxIterations) {
    current.active = false;
    return {
      type: "deactivate",
      reason: "max-iterations-reached",
      state: current,
    };
  }

  if (input.runStatus) {
    if (!input.runStatus.state.trim()) {
      current.active = false;
      return {
        type: "deactivate",
        reason: "run-state-missing",
        state: current,
      };
    }

    if (input.runStatus.state === "completed") {
      current.active = false;
      return {
        type: "deactivate",
        reason: "run-completed",
        state: current,
      };
    }
  }

  const nextIteration = current.iteration + 1;
  current.iteration = nextIteration;

  return {
    type: "prompt",
    reason: "continue-loop",
    state: current,
    prompt: current.prompt,
    systemMessage: buildSystemMessage(nextIteration, input.runStatus),
  };
}

function buildSystemMessage(nextIteration: number, runStatus?: RunStatusSnapshot | null): string {
  if (!runStatus) {
    return `Babysitter iteration ${nextIteration} | Continue orchestration (run:iterate).`;
  }

  if (runStatus.state === "waiting") {
    const pendingKinds = Object.keys(runStatus.pendingByKind ?? {})
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    if (pendingKinds) {
      return `Babysitter iteration ${nextIteration} | Waiting on: ${pendingKinds}. Check pending effects, then run run:iterate.`;
    }
    return `Babysitter iteration ${nextIteration} | Waiting. Check pending effects, then run run:iterate.`;
  }

  if (runStatus.state === "failed") {
    return `Babysitter iteration ${nextIteration} | Run failed. Repair run state or process, then continue orchestration.`;
  }

  return `Babysitter iteration ${nextIteration} | Continue orchestration (run:iterate).`;
}

function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    iterationTimes: [...state.iterationTimes],
  };
}
