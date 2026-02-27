import { describe, expect, it, vi } from "vitest";
import { InteractiveBreakpointHandler, AskUserFn } from "../interactiveBreakpointHandler";
import type { BreakpointClient, BreakpointCreateInput } from "../../orchestrator/nativeOrchestrator";

function makeAskUser(answer?: string): AskUserFn {
  return vi.fn(async () => ({
    status: "answered" as const,
    answer,
  }));
}

function makeFallback(): BreakpointClient & {
  createCalls: BreakpointCreateInput[];
  waitCalls: Array<{ breakpointId: string }>;
} {
  const createCalls: BreakpointCreateInput[] = [];
  const waitCalls: Array<{ breakpointId: string }> = [];
  return {
    createCalls,
    waitCalls,
    async create(input: BreakpointCreateInput) {
      createCalls.push(input);
      return { breakpointId: "cli-bp-1" };
    },
    async wait(input: { breakpointId: string }) {
      waitCalls.push(input);
      return { status: "released" };
    },
  };
}

describe("InteractiveBreakpointHandler", () => {
  it("prompts user interactively and resolves breakpoint immediately", async () => {
    const askUser = makeAskUser("yes, proceed");
    const handler = new InteractiveBreakpointHandler({
      sessionId: "session-1",
      interactive: true,
      askUser,
    });

    const created = await handler.create({
      question: "Proceed with deploy?",
      title: "Deploy Approval",
      runId: "run-1",
    });

    expect(created.breakpointId).toBe("interactive-bp-1");
    expect(created.raw).toMatchObject({
      interactive: true,
      status: "answered",
      answer: "yes, proceed",
    });
    expect(askUser).toHaveBeenCalledWith({
      sessionId: "session-1",
      question: "Proceed with deploy?",
      title: "Deploy Approval",
    });

    const waitResult = await handler.wait({ breakpointId: created.breakpointId });
    expect(waitResult).toMatchObject({
      status: "released",
      answer: "yes, proceed",
      interactive: true,
    });
  });

  it("delegates to fallback client in non-interactive mode", async () => {
    const askUser = makeAskUser();
    const fallback = makeFallback();
    const handler = new InteractiveBreakpointHandler({
      sessionId: "session-2",
      interactive: false,
      askUser,
      fallback,
    });

    const created = await handler.create({
      question: "Approve?",
      title: "Gate",
      runId: "run-2",
    });

    expect(created.breakpointId).toBe("cli-bp-1");
    expect(fallback.createCalls).toHaveLength(1);
    expect(askUser).not.toHaveBeenCalled();

    const waitResult = await handler.wait({ breakpointId: "cli-bp-1" });
    expect(waitResult).toMatchObject({ status: "released" });
    expect(fallback.waitCalls).toHaveLength(1);
  });

  it("throws in non-interactive mode without fallback", async () => {
    const handler = new InteractiveBreakpointHandler({
      sessionId: "session-3",
      interactive: false,
      askUser: makeAskUser(),
    });

    await expect(
      handler.create({ question: "Q", title: "T", runId: "run-3" })
    ).rejects.toThrow("Non-interactive mode requires a fallback BreakpointClient");
  });

  it("generates unique breakpoint IDs across multiple creates", async () => {
    const handler = new InteractiveBreakpointHandler({
      sessionId: "session-4",
      interactive: true,
      askUser: makeAskUser("ok"),
    });

    const first = await handler.create({ question: "Q1", title: "T1", runId: "run-4" });
    const second = await handler.create({ question: "Q2", title: "T2", runId: "run-4" });

    expect(first.breakpointId).toBe("interactive-bp-1");
    expect(second.breakpointId).toBe("interactive-bp-2");
  });

  it("handles prompted-only response (no answer) from askUser", async () => {
    const askUser = vi.fn(async () => ({
      status: "prompted" as const,
      answer: undefined,
    }));
    const handler = new InteractiveBreakpointHandler({
      sessionId: "session-5",
      interactive: true,
      askUser,
    });

    const created = await handler.create({ question: "Q", title: "T", runId: "run-5" });
    expect(created.raw).toMatchObject({ status: "prompted", answer: undefined });

    const waitResult = await handler.wait({ breakpointId: created.breakpointId });
    expect(waitResult).toMatchObject({ status: "released", answer: undefined });
  });
});
