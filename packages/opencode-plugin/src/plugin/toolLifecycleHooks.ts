export interface HookDispatcherLike {
  dispatch(hookName: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface ToolLifecycleHookOptions {
  hookDispatcher?: HookDispatcherLike;
  worktree: string;
  now?: () => Date;
}

interface ToolInputLike {
  tool?: unknown;
  args?: Record<string, unknown>;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ToolOutputLike {
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export function createToolLifecycleHooks(options: ToolLifecycleHookOptions): {
  "tool.execute.before": (input: unknown, output: unknown) => Promise<void>;
  "tool.execute.after": (input: unknown, output: unknown) => Promise<void>;
} {
  return {
    "tool.execute.before": async (input: unknown, output: unknown) => {
      const toolInput = asToolInput(input);
      if (!isBashTool(toolInput)) {
        return;
      }

      const command = extractBashCommand(toolInput, asToolOutput(output));
      if (!command) {
        return;
      }

      const timestamp = (options.now?.() ?? new Date()).toISOString();
      const sessionId = extractSessionId(toolInput);

      if (isGitBranchCommand(command)) {
        await safeDispatch(options.hookDispatcher, "pre-branch", {
          sessionId,
          worktree: options.worktree,
          command,
          timestamp,
        });
      }

      if (isGitCommitCommand(command)) {
        await safeDispatch(options.hookDispatcher, "pre-commit", {
          sessionId,
          worktree: options.worktree,
          command,
          timestamp,
        });
      }
    },

    "tool.execute.after": async (input: unknown, output: unknown) => {
      const toolInput = asToolInput(input);
      if (!isTodoWriteTool(toolInput)) {
        return;
      }

      const todos = extractTodos(toolInput, asToolOutput(output));
      const summary = summarizeTodos(todos);
      await safeDispatch(options.hookDispatcher, "post-planning", {
        sessionId: extractSessionId(toolInput),
        timestamp: (options.now?.() ?? new Date()).toISOString(),
        worktree: options.worktree,
        ...summary,
      });
    },
  };
}

export function extractBashCommand(input: ToolInputLike, output?: ToolOutputLike): string | null {
  const inCommand = asString(input.args?.command);
  if (inCommand) {
    return inCommand;
  }
  const outCommand = asString(output?.args?.command);
  if (outCommand) {
    return outCommand;
  }
  return null;
}

export function isGitBranchCommand(command: string): boolean {
  return /(^|\s)git\s+(checkout\s+-b|switch\s+-c)\s+/i.test(command);
}

export function isGitCommitCommand(command: string): boolean {
  return /(^|\s)git\s+commit(\s|$)/i.test(command);
}

function isTodoWriteTool(input: ToolInputLike): boolean {
  return String(input.tool ?? "").toLowerCase() === "todowrite";
}

function isBashTool(input: ToolInputLike): boolean {
  return String(input.tool ?? "").toLowerCase() === "bash";
}

function extractSessionId(input: ToolInputLike): string | null {
  const fromInput = asString((input as Record<string, unknown>).sessionID) ?? asString((input as Record<string, unknown>).sessionId);
  if (fromInput) {
    return fromInput;
  }
  const context = asRecord(input.context);
  if (!context) {
    return null;
  }
  return asString(context.sessionID) ?? asString(context.sessionId) ?? null;
}

function extractTodos(input: ToolInputLike, output?: ToolOutputLike): Array<Record<string, unknown>> {
  const fromInput = asTodos(input.args?.todos);
  if (fromInput.length > 0) {
    return fromInput;
  }
  return asTodos(output?.args?.todos);
}

function summarizeTodos(todos: Array<Record<string, unknown>>): {
  totalTodos: number;
  pendingTodos: number;
  inProgressTodos: number;
  completedTodos: number;
  cancelledTodos: number;
} {
  let pendingTodos = 0;
  let inProgressTodos = 0;
  let completedTodos = 0;
  let cancelledTodos = 0;

  for (const todo of todos) {
    const status = asString(todo.status)?.toLowerCase();
    if (status === "pending") pendingTodos += 1;
    else if (status === "in_progress") inProgressTodos += 1;
    else if (status === "completed") completedTodos += 1;
    else if (status === "cancelled") cancelledTodos += 1;
  }

  return {
    totalTodos: todos.length,
    pendingTodos,
    inProgressTodos,
    completedTodos,
    cancelledTodos,
  };
}

function asTodos(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

async function safeDispatch(
  hookDispatcher: HookDispatcherLike | undefined,
  hookName: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!hookDispatcher) {
    return;
  }
  try {
    await hookDispatcher.dispatch(hookName, payload);
  } catch {
    // Never interrupt session flow because hooks fail.
  }
}

function asToolInput(input: unknown): ToolInputLike {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as ToolInputLike;
}

function asToolOutput(output: unknown): ToolOutputLike | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  return output as ToolOutputLike;
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
