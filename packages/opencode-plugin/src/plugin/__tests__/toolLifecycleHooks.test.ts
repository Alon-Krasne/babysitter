import { describe, expect, it, vi } from "vitest";
import {
  createToolLifecycleHooks,
  extractBashCommand,
  isGitBranchCommand,
  isGitCommitCommand,
} from "../toolLifecycleHooks";

describe("tool lifecycle hooks", () => {
  it("extracts command from input or output args", () => {
    expect(extractBashCommand({ args: { command: "git status" } })).toBe("git status");
    expect(extractBashCommand({ args: {} }, { args: { command: "git commit -m x" } })).toBe("git commit -m x");
    expect(extractBashCommand({}, {})).toBeNull();
  });

  it("detects branch and commit commands", () => {
    expect(isGitBranchCommand("git checkout -b feat/x")).toBe(true);
    expect(isGitBranchCommand("git switch -c feat/x")).toBe(true);
    expect(isGitBranchCommand("git checkout main")).toBe(false);

    expect(isGitCommitCommand("git commit -m \"x\" ")).toBe(true);
    expect(isGitCommitCommand("git commit")).toBe(true);
    expect(isGitCommitCommand("git status")).toBe(false);
  });

  it("dispatches pre-branch and pre-commit hooks from bash tool execution", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const hooks = createToolLifecycleHooks({
      hookDispatcher: { dispatch },
      worktree: "/repo",
      now: () => new Date("2026-02-26T23:40:00.000Z"),
    });

    await hooks["tool.execute.before"](
      {
        tool: "bash",
        args: { command: "git checkout -b feat/x && git commit -m \"msg\"" },
        context: { sessionID: "session-1" },
      },
      {}
    );

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toBe("pre-branch");
    expect(dispatch.mock.calls[1]?.[0]).toBe("pre-commit");
  });

  it("dispatches post-planning hook after todowrite", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const hooks = createToolLifecycleHooks({
      hookDispatcher: { dispatch },
      worktree: "/repo",
      now: () => new Date("2026-02-26T23:40:00.000Z"),
    });

    await hooks["tool.execute.after"](
      {
        tool: "todowrite",
        args: {
          todos: [
            { content: "a", status: "pending" },
            { content: "b", status: "completed" },
            { content: "c", status: "in_progress" },
          ],
        },
        context: { sessionID: "session-1" },
      },
      {}
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toBe("post-planning");
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({
      sessionId: "session-1",
      totalTodos: 3,
      pendingTodos: 1,
      completedTodos: 1,
      inProgressTodos: 1,
      cancelledTodos: 0,
    });
  });
});
