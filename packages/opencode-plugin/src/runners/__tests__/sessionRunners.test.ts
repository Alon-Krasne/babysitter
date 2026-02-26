import { describe, expect, it, vi } from "vitest";
import { createSessionAgentRunner, createSessionSkillRunner } from "../sessionRunners";

describe("session runners", () => {
  it("returns structured output from session prompt for skill runner", async () => {
    const prompt = vi.fn().mockResolvedValue({
      data: {
        info: {
          structured_output: {
            status: "ok",
            value: { score: 91 },
            stdout: "done",
          },
        },
      },
    });

    const runner = createSessionSkillRunner({ session: { prompt } });
    const result = await runner.run(makeInput({ sessionId: "session-1" }));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "ok",
      value: { score: 91 },
      stdout: "done",
      stderr: undefined,
    });
  });

  it("falls back to parsing JSON text when structured output is absent", async () => {
    const prompt = vi.fn().mockResolvedValue({
      data: {
        parts: [
          {
            type: "text",
            text: "Result:\n{\"status\":\"error\",\"error\":{\"name\":\"Error\",\"message\":\"boom\"}}",
          },
        ],
      },
    });

    const runner = createSessionAgentRunner({ session: { prompt } });
    const result = await runner.run(makeInput({ sessionId: "session-1" }));

    expect(result).toEqual({
      status: "error",
      error: {
        name: "Error",
        message: "boom",
      },
      stdout: undefined,
      stderr: undefined,
    });
  });

  it("returns runner error when session id is unavailable", async () => {
    const prompt = vi.fn().mockResolvedValue({});
    const runner = createSessionSkillRunner({ session: { prompt } });

    const result = await runner.run(makeInput({ sessionId: undefined }));

    expect(prompt).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect((result.error as { message?: string }).message).toContain("Missing sessionId");
  });
});

function makeInput(overrides: Partial<Record<string, unknown>>) {
  return {
    sessionId: "session-1",
    runId: "run-1",
    effectId: "ef-1",
    runDir: "/tmp/run",
    task: {
      effectId: "ef-1",
      kind: "skill",
      label: "evaluate",
    },
    taskDefinition: {
      kind: "skill",
      skill: { name: "babysitter-score" },
    },
    inputRef: "tasks/ef-1/inputs.json",
    inputPath: "/tmp/run/tasks/ef-1/inputs.json",
    outputRef: "tasks/ef-1/result.json",
    outputPath: "/tmp/run/tasks/ef-1/result.json",
    input: { code: "x" },
    ...overrides,
  };
}
