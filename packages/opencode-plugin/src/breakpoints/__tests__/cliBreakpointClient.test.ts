import { describe, expect, it } from "vitest";
import { CommandExecutor } from "../../cli/babysitterCli";
import { CliBreakpointClient } from "../cliBreakpointClient";

describe("CliBreakpointClient", () => {
  it("creates breakpoints with expected CLI flags", async () => {
    const executor = createExecutor([
      {
        exitCode: 0,
        stdout: JSON.stringify({ breakpointId: "bp-1" }) + "\n",
        stderr: "",
      },
    ]);
    const client = new CliBreakpointClient({ command: "breakpoints", executor });

    const result = await client.create({
      question: "Proceed?",
      title: "Approval",
      runId: "run-1",
      files: [{ path: "docs/plan.md", format: "markdown" }],
    });

    expect(result).toEqual({ breakpointId: "bp-1", raw: { breakpointId: "bp-1" } });
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual({
      command: "breakpoints",
      args: [
        "breakpoint",
        "create",
        "--question",
        "Proceed?",
        "--title",
        "Approval",
        "--run-id",
        "run-1",
        "--file",
        "docs/plan.md,markdown",
      ],
      options: undefined,
    });
  });

  it("waits for breakpoint release and parses JSON", async () => {
    const executor = createExecutor([
      {
        exitCode: 0,
        stdout: "status:\n" + JSON.stringify({ id: "bp-1", status: "released" }) + "\n",
        stderr: "",
      },
    ]);
    const client = new CliBreakpointClient({ executor });

    const result = await client.wait({ breakpointId: "bp-1", intervalSeconds: 4 });
    expect(result).toEqual({ id: "bp-1", status: "released" });
    expect(executor.calls[0]?.args).toEqual(["breakpoint", "wait", "bp-1", "--interval", "4"]);
  });
});

function createExecutor(results: Array<{ exitCode: number; stdout: string; stderr: string }>) {
  const calls: Array<{ command: string; args: string[]; options?: { cwd?: string; input?: string } }> = [];
  const executor: CommandExecutor & {
    calls: Array<{ command: string; args: string[]; options?: { cwd?: string; input?: string } }>;
  } = {
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options });
      if (!results.length) {
        throw new Error("No mocked command result available");
      }
      return results.shift() as { exitCode: number; stdout: string; stderr: string };
    },
  };
  return executor;
}
