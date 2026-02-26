export interface SessionState {
  active: boolean;
  sessionId: string;
  iteration: number;
  maxIterations: number;
  runId: string | null;
  prompt: string;
  startedAt: string;
  lastIterationAt: string;
  iterationTimes: number[];
}

export interface StartSessionOptions {
  prompt: string;
  maxIterations?: number;
  runId?: string;
  now?: Date;
}

const DEFAULT_MAX_ITERATIONS = 256;

export class SessionStateStore {
  private readonly sessions = new Map<string, SessionState>();

  start(sessionId: string, options: StartSessionOptions): SessionState {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (this.sessions.has(normalizedSessionId)) {
      throw new Error(`Session already has an active babysitter run: ${normalizedSessionId}`);
    }

    const prompt = options.prompt.trim();
    if (!prompt) {
      throw new Error("prompt must be a non-empty string");
    }

    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (!Number.isInteger(maxIterations) || maxIterations < 0) {
      throw new Error("maxIterations must be an integer >= 0");
    }

    const nowIso = (options.now ?? new Date()).toISOString();
    const state: SessionState = {
      active: true,
      sessionId: normalizedSessionId,
      iteration: 1,
      maxIterations,
      runId: options.runId ?? null,
      prompt,
      startedAt: nowIso,
      lastIterationAt: nowIso,
      iterationTimes: [],
    };

    this.sessions.set(normalizedSessionId, cloneState(state));
    return cloneState(state);
  }

  get(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(normalizeSessionId(sessionId));
    return state ? cloneState(state) : undefined;
  }

  set(sessionId: string, next: SessionState): SessionState {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (normalizedSessionId !== next.sessionId) {
      throw new Error("sessionId mismatch between key and state payload");
    }
    this.sessions.set(normalizedSessionId, cloneState(next));
    return cloneState(next);
  }

  associateRun(sessionId: string, runId: string): SessionState {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      throw new Error("runId must be a non-empty string");
    }

    const existing = this.sessions.get(normalizedSessionId);
    if (!existing) {
      throw new Error(`No active babysitter session: ${normalizedSessionId}`);
    }
    if (existing.runId && existing.runId !== normalizedRunId) {
      throw new Error(`Session already associated with run ${existing.runId}`);
    }

    const next: SessionState = {
      ...existing,
      runId: normalizedRunId,
    };
    this.sessions.set(normalizedSessionId, next);
    return cloneState(next);
  }

  stop(sessionId: string): boolean {
    return this.sessions.delete(normalizeSessionId(sessionId));
  }

  listActive(): SessionState[] {
    return Array.from(this.sessions.values()).map((state) => cloneState(state));
  }
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error("sessionId must be a non-empty string");
  }
  return normalized;
}

function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    iterationTimes: [...state.iterationTimes],
  };
}
