import { afterEach, describe, expect, it, vi } from "vitest";
import { AskResponseCoordinator } from "../askResponseCoordinator";

describe("AskResponseCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves waiting ask from user message event", async () => {
    const coordinator = new AskResponseCoordinator();
    const pending = coordinator.waitForAnswer({
      sessionId: "session-1",
      timeoutMs: 1000,
    });

    const resolved = coordinator.resolveFromUserMessage({
      properties: {
        sessionId: "session-1",
        message: {
          role: "user",
          text: "approved",
        },
      },
    });

    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual({ status: "answered", answer: "approved" });
  });

  it("ignores assistant messages", async () => {
    const coordinator = new AskResponseCoordinator();
    const pending = coordinator.waitForAnswer({
      sessionId: "session-1",
      timeoutMs: 1000,
    });

    const resolved = coordinator.resolveFromUserMessage({
      properties: {
        sessionId: "session-1",
        message: {
          role: "assistant",
          text: "I approve",
        },
      },
    });

    expect(resolved).toBe(false);
    coordinator.rejectSession("session-1", "cancelled");
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("times out pending asks", async () => {
    vi.useFakeTimers();
    const coordinator = new AskResponseCoordinator();
    const pending = coordinator.waitForAnswer({
      sessionId: "session-1",
      timeoutMs: 10,
    });

    const assertion = expect(pending).rejects.toThrow("Timed out waiting for ask response");

    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });
});
