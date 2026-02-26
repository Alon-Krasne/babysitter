interface PendingAsk {
  resolve: (value: { status: "answered"; answer: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WaitForAnswerOptions {
  sessionId: string;
  timeoutMs: number;
}

export class AskResponseCoordinator {
  private readonly pendingBySession = new Map<string, PendingAsk[]>();

  waitForAnswer(options: WaitForAnswerOptions): Promise<{ status: "answered"; answer: string }> {
    const sessionId = normalizeSessionId(options.sessionId);
    const timeoutMs = normalizeTimeout(options.timeoutMs);

    return new Promise((resolve, reject) => {
      const queue = this.pendingBySession.get(sessionId) ?? [];

      const pending: PendingAsk = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePending(sessionId, pending);
          reject(new Error(`Timed out waiting for ask response after ${timeoutMs}ms`));
        }, timeoutMs),
      };

      queue.push(pending);
      this.pendingBySession.set(sessionId, queue);
    });
  }

  resolveFromUserMessage(event: unknown): boolean {
    const sessionId = extractSessionId(event);
    if (!sessionId) {
      return false;
    }

    const role = extractRole(event);
    if (role !== "user") {
      return false;
    }

    const answer = extractText(event);
    if (!answer) {
      return false;
    }

    const queue = this.pendingBySession.get(sessionId);
    if (!queue || queue.length === 0) {
      return false;
    }

    const pending = queue.shift() as PendingAsk;
    if (queue.length === 0) {
      this.pendingBySession.delete(sessionId);
    }

    clearTimeout(pending.timer);
    pending.resolve({ status: "answered", answer });
    return true;
  }

  rejectSession(sessionId: string, message: string): void {
    const normalized = normalizeSessionId(sessionId);
    const queue = this.pendingBySession.get(normalized);
    if (!queue) {
      return;
    }
    this.pendingBySession.delete(normalized);
    for (const pending of queue) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }

  private removePending(sessionId: string, entry: PendingAsk): void {
    const queue = this.pendingBySession.get(sessionId);
    if (!queue) {
      return;
    }
    const index = queue.indexOf(entry);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.pendingBySession.delete(sessionId);
    }
  }
}

function normalizeSessionId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("sessionId must be a non-empty string");
  }
  return normalized;
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 300000;
  }
  return Math.floor(value);
}

function extractSessionId(event: unknown): string | null {
  const record = asRecord(event);
  if (!record) {
    return null;
  }

  const fromTop = asString(record.sessionID) ?? asString(record.sessionId) ?? asString(record.session_id);
  if (fromTop) {
    return fromTop;
  }

  const properties = asRecord(record.properties);
  if (!properties) {
    return null;
  }
  return asString(properties.sessionID) ?? asString(properties.sessionId) ?? asString(properties.session_id);
}

function extractRole(event: unknown): string | null {
  const record = asRecord(event);
  if (!record) {
    return null;
  }

  const values: unknown[] = [record.role, record.message, record.properties];
  for (const value of values) {
    const role = findRole(value);
    if (role) {
      return role;
    }
  }

  return null;
}

function findRole(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "user" || normalized === "assistant" || normalized === "system") {
      return normalized;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const role = findRole(item);
      if (role) {
        return role;
      }
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (typeof record.role === "string") {
    const normalized = record.role.trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  for (const key of Object.keys(record)) {
    const role = findRole(record[key]);
    if (role) {
      return role;
    }
  }
  return null;
}

function extractText(event: unknown): string | null {
  const candidates = collectStrings(event);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function collectStrings(value: unknown): string[] {
  const result: string[] = [];
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      result.push(current);
      continue;
    }
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (key === "text" && typeof entry === "string") {
        result.push(entry);
      }
      if (key === "question" || key === "prompt") {
        continue;
      }
      stack.push(entry);
    }
  }

  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
