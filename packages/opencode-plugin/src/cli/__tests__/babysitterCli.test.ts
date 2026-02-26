import { describe, expect, it } from "vitest";
import { BabysitterCli, CommandExecutor, CommandRunOptions } from "../babysitterCli";

describe("BabysitterCli", () => {
  it("parses run:status JSON output", async () => {
    const cli = new BabysitterCli(createExecutor([{ exitCode: 0, stdout: '{"state":"waiting","pendingByKind":{"node":2}}\n', stderr: "" }]));

    const status = await cli.runStatus("run-1");
    expect(status).toEqual({
      state: "waiting",
      pendingByKind: { node: 2 },
      completionSecret: undefined,
    });
  });

  it("parses the last JSON line when stdout includes non-json logs", async () => {
    const cli = new BabysitterCli(
      createExecutor([
        {
          exitCode: 0,
          stdout: "[run:status] state=waiting\n{\"state\":\"completed\",\"completionSecret\":\"abc\"}\n",
          stderr: "",
        },
      ])
    );

    const status = await cli.runStatus("run-1");
    expect(status).toEqual({
      state: "completed",
      completionSecret: "abc",
      pendingByKind: undefined,
    });
  });

  it("throws when command exits with non-zero code", async () => {
    const cli = new BabysitterCli(createExecutor([{ exitCode: 1, stdout: "", stderr: "boom" }]));

    await expect(cli.runStatus("run-1")).rejects.toThrow("boom");
  });

  it("parses pending tasks from task:list", async () => {
    const cli = new BabysitterCli(
      createExecutor([
        {
          exitCode: 0,
          stdout: JSON.stringify({ tasks: [{ effectId: "ef-1", kind: "node", taskDefRef: "tasks/ef-1/task.json" }] }) + "\n",
          stderr: "",
        },
      ])
    );

    const tasks = await cli.taskListPending("run-1");
    expect(tasks).toEqual([
      {
        effectId: "ef-1",
        kind: "node",
        label: undefined,
        status: undefined,
        taskId: undefined,
        taskDefRef: "tasks/ef-1/task.json",
        inputsRef: null,
      },
    ]);
  });

  it("posts successful task results with value ref", async () => {
    const executor = createExecutor([{ exitCode: 0, stdout: '{"status":"ok"}\n', stderr: "" }]);
    const cli = new BabysitterCli(executor);

    await cli.taskPost(
      "run-1",
      "ef-1",
      {
        status: "ok",
        valueRef: "tasks/ef-1/result.json",
        stdoutRef: "tasks/ef-1/stdout.log",
      },
      "/tmp/work"
    );

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual({
      command: "babysitter",
      args: [
        "task:post",
        "run-1",
        "ef-1",
        "--status",
        "ok",
        "--json",
        "--value",
        "tasks/ef-1/result.json",
        "--stdout-ref",
        "tasks/ef-1/stdout.log",
      ],
      options: { cwd: "/tmp/work" },
    });
  });

  it("posts error task results through stdin payload", async () => {
    const executor = createExecutor([{ exitCode: 0, stdout: '{"status":"error"}\n', stderr: "" }]);
    const cli = new BabysitterCli(executor);

    await cli.taskPost(
      "run-1",
      "ef-1",
      {
        status: "error",
        errorPayload: { name: "Error", message: "boom" },
        stderrRef: "tasks/ef-1/stderr.log",
      },
      "/tmp/work"
    );

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].args).toEqual([
      "task:post",
      "run-1",
      "ef-1",
      "--status",
      "error",
      "--json",
      "--error",
      "-",
      "--stderr-ref",
      "tasks/ef-1/stderr.log",
    ]);
    expect(executor.calls[0].options?.cwd).toBe("/tmp/work");
    expect(executor.calls[0].options?.input).toContain('"message":"boom"');
  });
});

function createExecutor(results: Array<{ exitCode: number; stdout: string; stderr: string }>) {
  const calls: Array<{ command: string; args: string[]; options?: CommandRunOptions }> = [];
  const executor: CommandExecutor & {
    calls: Array<{ command: string; args: string[]; options?: CommandRunOptions }>;
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
