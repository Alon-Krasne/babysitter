import type {
  AgentRunner,
  DelegatedTaskInput,
  DelegatedTaskResult,
  SkillRunner,
} from "../orchestrator/nativeOrchestrator";

interface SessionPromptClientLike {
  session: {
    prompt(input: {
      path: { id: string };
      body: {
        parts: Array<{ type: "text"; text: string }>;
        format?: unknown;
        outputFormat?: unknown;
        model?: unknown;
      };
    }): Promise<unknown>;
  };
}

export interface SessionRunnerOptions {
  sessionId?: string;
  model?: unknown;
}

export function createSessionSkillRunner(
  client: SessionPromptClientLike,
  options: SessionRunnerOptions = {}
): SkillRunner {
  return {
    run(input) {
      return executeDelegatedWithSession(client, "skill", input, options);
    },
  };
}

export function createSessionAgentRunner(
  client: SessionPromptClientLike,
  options: SessionRunnerOptions = {}
): AgentRunner {
  return {
    run(input) {
      return executeDelegatedWithSession(client, "agent", input, options);
    },
  };
}

type DelegatedKind = "skill" | "agent";

async function executeDelegatedWithSession(
  client: SessionPromptClientLike,
  kind: DelegatedKind,
  input: DelegatedTaskInput,
  options: SessionRunnerOptions
): Promise<DelegatedTaskResult> {
  const sessionId = input.sessionId ?? options.sessionId;
  if (!sessionId) {
    return {
      status: "error",
      error: {
        name: "RunnerError",
        message: "Missing sessionId for delegated task execution",
        data: {
          runId: input.runId,
          effectId: input.effectId,
          kind,
        },
      },
    };
  }

  const instruction = buildInstruction(kind, input);
  const schema = {
    type: "object",
    additionalProperties: true,
    properties: {
      status: { type: "string", enum: ["ok", "error"] },
      value: {
        type: ["object", "array", "string", "number", "boolean", "null"],
      },
      error: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          message: { type: "string" },
          data: {},
        },
      },
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
    required: ["status"],
  };

  const body: {
    parts: Array<{ type: "text"; text: string }>;
    format: { type: "json_schema"; schema: unknown };
    outputFormat: { type: "json_schema"; schema: unknown };
    model?: unknown;
  } = {
    parts: [{ type: "text", text: instruction }],
    format: {
      type: "json_schema",
      schema,
    },
    outputFormat: {
      type: "json_schema",
      schema,
    },
  };
  if (options.model) {
    body.model = options.model;
  }

  let response: unknown;
  try {
    response = await client.session.prompt({
      path: { id: sessionId },
      body,
    });
  } catch (error) {
    return {
      status: "error",
      error: {
        name: "RunnerError",
        message: error instanceof Error ? error.message : String(error),
        data: {
          runId: input.runId,
          effectId: input.effectId,
          kind,
        },
      },
    };
  }

  const structured = extractStructuredOutput(response);
  const parsedStructured = normalizeResult(structured);
  if (parsedStructured) {
    return parsedStructured;
  }

  const textPayload = extractJsonPayloadFromResponse(response);
  const parsedText = normalizeResult(textPayload);
  if (parsedText) {
    return parsedText;
  }

  return {
    status: "error",
    error: {
      name: "RunnerError",
      message: "Unable to parse delegated task response",
      data: {
        runId: input.runId,
        effectId: input.effectId,
        kind,
      },
    },
  };
}

function buildInstruction(kind: DelegatedKind, input: DelegatedTaskInput): string {
  const taskDef = asRecord(input.taskDefinition);
  const skillName = asString(taskDef?.skill && asRecord(taskDef.skill)?.name);
  const agentName = asString(taskDef?.agent && asRecord(taskDef.agent)?.name);

  const lines = [
    `Execute babysitter delegated ${kind} task and return JSON only.`,
    "",
    "Task metadata:",
    JSON.stringify(
      {
        runId: input.runId,
        effectId: input.effectId,
        taskLabel: input.task.label ?? null,
        taskKind: input.task.kind ?? kind,
        inputRef: input.inputRef,
        outputRef: input.outputRef,
      },
      null,
      2
    ),
    "",
    "Task input JSON:",
    JSON.stringify(input.input ?? {}, null, 2),
    "",
  ];

  if (kind === "skill") {
    lines.push(
      skillName
        ? `Use the Skill tool and invoke \`${skillName}\` as part of execution if needed.`
        : "Use the Skill tool as needed to execute this task."
    );
  } else {
    lines.push(
      agentName
        ? `Use the Task tool and delegate to agent \`${agentName}\` if needed.`
        : "Use the Task tool to delegate execution if needed."
    );
  }

  lines.push(
    "Return object shape:",
    '{"status":"ok","value":{...}} OR {"status":"error","error":{"name":"Error","message":"...","data":{...}}}'
  );

  return lines.join("\n");
}

function extractStructuredOutput(response: unknown): unknown {
  const root = asRecord(response);
  if (!root) {
    return undefined;
  }

  const direct = root.structured_output;
  if (direct !== undefined) {
    return direct;
  }

  const info = asRecord(root.info);
  if (info && info.structured_output !== undefined) {
    return info.structured_output;
  }

  const data = asRecord(root.data);
  if (!data) {
    return undefined;
  }

  const dataInfo = asRecord(data.info);
  if (dataInfo && dataInfo.structured_output !== undefined) {
    return dataInfo.structured_output;
  }

  return undefined;
}

function extractJsonPayloadFromResponse(response: unknown): unknown {
  const candidates = collectTextCandidates(response);
  for (const text of candidates) {
    const parsed = parseJsonFragment(text);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function collectTextCandidates(value: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        stack.push(child);
      }
      continue;
    }

    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (key === "text" && typeof child === "string") {
        out.push(child);
      }
      stack.push(child);
    }
  }
  return out;
}

function parseJsonFragment(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // continue
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const fragment = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(fragment) as unknown;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function normalizeResult(value: unknown): DelegatedTaskResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const status = asString(record.status);
  if (status !== "ok" && status !== "error") {
    return null;
  }

  if (status === "ok") {
    return {
      status,
      value: record.value,
      stdout: asString(record.stdout) ?? undefined,
      stderr: asString(record.stderr) ?? undefined,
    };
  }

  return {
    status,
    error:
      record.error ?? {
        name: "Error",
        message: "Delegated task returned error status without details",
      },
    stdout: asString(record.stdout) ?? undefined,
    stderr: asString(record.stderr) ?? undefined,
  };
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
