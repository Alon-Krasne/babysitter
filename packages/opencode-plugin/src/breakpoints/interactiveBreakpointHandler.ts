import type { BreakpointClient, BreakpointCreateInput } from "../orchestrator/nativeOrchestrator";

/**
 * Handles breakpoints interactively by prompting the user in the active session
 * (parity with Claude Code's AskUserQuestion-based interactive breakpoint flow).
 *
 * When `interactive` is true, the handler formats the breakpoint question and
 * calls the provided `askUser` callback instead of creating an external CLI breakpoint.
 * When `interactive` is false, delegates to the wrapped `fallback` client (e.g. CliBreakpointClient).
 */
export interface AskUserFn {
  (request: {
    sessionId: string;
    question: string;
    title?: string;
    choices?: string[];
  }): Promise<{ status: "prompted" | "answered"; answer?: string }>;
}

export interface InteractiveBreakpointHandlerOptions {
  /** The session to prompt when in interactive mode. */
  sessionId: string;
  /** Whether to use interactive (in-session) mode or delegate to fallback. */
  interactive: boolean;
  /** Callback that prompts the user in the active session. */
  askUser: AskUserFn;
  /** Fallback client for non-interactive mode (e.g. CliBreakpointClient). */
  fallback?: BreakpointClient;
}

export class InteractiveBreakpointHandler implements BreakpointClient {
  private readonly sessionId: string;
  private readonly interactive: boolean;
  private readonly askUser: AskUserFn;
  private readonly fallback?: BreakpointClient;

  /** Tracks resolved answers keyed by synthetic breakpointId. */
  private readonly resolved = new Map<string, { answer?: string }>();
  private counter = 0;

  constructor(options: InteractiveBreakpointHandlerOptions) {
    this.sessionId = options.sessionId;
    this.interactive = options.interactive;
    this.askUser = options.askUser;
    this.fallback = options.fallback;
  }

  async create(input: BreakpointCreateInput): Promise<{ breakpointId: string; raw?: unknown }> {
    if (!this.interactive) {
      if (!this.fallback) {
        throw new Error("Non-interactive mode requires a fallback BreakpointClient");
      }
      return this.fallback.create(input);
    }

    this.counter += 1;
    const breakpointId = `interactive-bp-${this.counter}`;

    const response = await this.askUser({
      sessionId: this.sessionId,
      question: input.question,
      title: input.title,
    });

    this.resolved.set(breakpointId, { answer: response.answer });

    return {
      breakpointId,
      raw: {
        interactive: true,
        sessionId: this.sessionId,
        status: response.status,
        answer: response.answer,
      },
    };
  }

  async wait(input: { breakpointId: string; intervalSeconds?: number }): Promise<unknown> {
    const cached = this.resolved.get(input.breakpointId);
    if (cached !== undefined) {
      this.resolved.delete(input.breakpointId);
      return {
        status: "released",
        answer: cached.answer,
        interactive: true,
      };
    }

    if (!this.interactive && this.fallback) {
      return this.fallback.wait(input);
    }

    // Interactive breakpoint was already resolved during create().
    return {
      status: "released",
      interactive: true,
    };
  }
}
