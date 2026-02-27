import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  describe("taskPost with SDK commitEffectResult", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-cli-taskpost-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    async function setupRunWithPendingEffect(runId: string, effectId: string) {
      const { createRunDir: createRunDirFn } = await import("@a5c-ai/babysitter-sdk/dist/storage/createRunDir.js");
      const { appendEvent } = await import("@a5c-ai/babysitter-sdk/dist/storage/journal.js");

      const runsDir = path.join(tmpDir, ".a5c", "runs");
      const { runDir } = await createRunDirFn({
        runsRoot: runsDir,
        runId,
        request: "test",
        processPath: "/fake/process.js",
        inputs: {},
      });

      // Journal: RUN_CREATED
      await appendEvent({
        runDir,
        eventType: "RUN_CREATED",
        event: { runId, processId: "test" },
      });

      // Journal: EFFECT_REQUESTED (so commitEffectResult can find it)
      await appendEvent({
        runDir,
        eventType: "EFFECT_REQUESTED",
        event: {
          effectId,
          invocationKey: `test:S000001:task-1`,
          invocationHash: "abc123",
          stepId: "S000001",
          taskId: "task-1",
          kind: "node",
          label: "test-task",
          taskDefRef: `tasks/${effectId}/task.json`,
        },
      });

      return { runDir };
    }

    it("commits successful task result via SDK", async () => {
      const runId = "test-run-ok";
      const effectId = "ef-ok-1";
      const { runDir } = await setupRunWithPendingEffect(runId, effectId);

      const executor = createExecutor([]);
      const cli = new BabysitterCli(executor);

      await cli.taskPost(
        runId,
        effectId,
        {
          status: "ok",
          valueRef: `tasks/${effectId}/result.json`,
        },
        tmpDir
      );

      // Verify EFFECT_RESOLVED was written to journal
      const journalDir = path.join(runDir, "journal");
      const journalFiles = await fs.readdir(journalDir);
      const resolvedFiles = journalFiles.filter((f) => f.endsWith(".json"));
      // Should have 3: RUN_CREATED, EFFECT_REQUESTED, EFFECT_RESOLVED
      expect(resolvedFiles.length).toBe(3);

      const lastFile = resolvedFiles.sort().pop()!;
      const lastEvent = JSON.parse(await fs.readFile(path.join(journalDir, lastFile), "utf8"));
      expect(lastEvent.type).toBe("EFFECT_RESOLVED");
      expect(lastEvent.data.effectId).toBe(effectId);
      expect(lastEvent.data.status).toBe("ok");
    });

    it("commits error task result via SDK", async () => {
      const runId = "test-run-err";
      const effectId = "ef-err-1";
      const { runDir } = await setupRunWithPendingEffect(runId, effectId);

      const executor = createExecutor([]);
      const cli = new BabysitterCli(executor);

      await cli.taskPost(
        runId,
        effectId,
        {
          status: "error",
          errorPayload: { name: "Error", message: "boom" },
        },
        tmpDir
      );

      // Verify EFFECT_RESOLVED with error was written
      const journalDir = path.join(runDir, "journal");
      const journalFiles = (await fs.readdir(journalDir)).filter((f) => f.endsWith(".json")).sort();
      const lastFile = journalFiles.pop()!;
      const lastEvent = JSON.parse(await fs.readFile(path.join(journalDir, lastFile), "utf8"));
      expect(lastEvent.type).toBe("EFFECT_RESOLVED");
      expect(lastEvent.data.effectId).toBe(effectId);
      expect(lastEvent.data.status).toBe("error");
    });
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
