import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

export interface SessionStateStoreOptions {
  persistenceFile?: string;
}

const DEFAULT_MAX_ITERATIONS = 256;

export class SessionStateStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly persistenceFile?: string;

  constructor(options: SessionStateStoreOptions = {}) {
    this.persistenceFile = options.persistenceFile?.trim() || undefined;
    if (this.persistenceFile) {
      this.loadFromDisk();
    }
  }

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
    this.persistToDisk();
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
    this.persistToDisk();
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
    this.persistToDisk();
    return cloneState(next);
  }

  stop(sessionId: string): boolean {
    const deleted = this.sessions.delete(normalizeSessionId(sessionId));
    if (deleted) {
      this.persistToDisk();
    }
    return deleted;
  }

  listActive(): SessionState[] {
    return Array.from(this.sessions.values()).map((state) => cloneState(state));
  }

  private loadFromDisk(): void {
    if (!this.persistenceFile) {
      return;
    }

    let parsed: unknown;
    try {
      const raw = readFileSync(this.persistenceFile, "utf8");
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }

    const sessions = (parsed as Record<string, unknown>).sessions;
    if (!Array.isArray(sessions)) {
      return;
    }

    for (const item of sessions) {
      const normalized = normalizePersistedState(item);
      if (!normalized) {
        continue;
      }
      this.sessions.set(normalized.sessionId, normalized);
    }
  }

  private persistToDisk(): void {
    if (!this.persistenceFile) {
      return;
    }

    const payload = {
      version: 1,
      sessions: Array.from(this.sessions.values()),
    };

    mkdirSync(path.dirname(this.persistenceFile), { recursive: true });
    writeFileSync(this.persistenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function normalizePersistedState(value: unknown): SessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = asNonEmptyString(record.sessionId);
  const prompt = asNonEmptyString(record.prompt);
  const startedAt = asNonEmptyString(record.startedAt);
  const lastIterationAt = asNonEmptyString(record.lastIterationAt);
  if (!sessionId || !prompt || !startedAt || !lastIterationAt) {
    return null;
  }

  const iteration = asInteger(record.iteration);
  const maxIterations = asInteger(record.maxIterations);
  if (iteration === null || maxIterations === null) {
    return null;
  }

  const runId = asNullableString(record.runId);
  const active = typeof record.active === "boolean" ? record.active : true;
  const iterationTimes = Array.isArray(record.iterationTimes)
    ? record.iterationTimes
        .map((value) => asInteger(value))
        .filter((value): value is number => value !== null && value > 0)
    : [];

  return {
    active,
    sessionId,
    iteration,
    maxIterations,
    runId,
    prompt,
    startedAt,
    lastIterationAt,
    iterationTimes,
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNonEmptyString(value);
}

function asInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  if (!Number.isFinite(rounded)) {
    return null;
  }
  return rounded;
}
