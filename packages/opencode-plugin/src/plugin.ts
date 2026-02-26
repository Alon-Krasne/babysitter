import path from "node:path";
import { z } from "zod";
import { CliBreakpointClient } from "./breakpoints/cliBreakpointClient";
import { BabysitterCli, SpawnCommandExecutor } from "./cli/babysitterCli";
import { HookDispatcher } from "./hooks/dispatcher";
import { AgentRunner, SkillRunner } from "./orchestrator/nativeOrchestrator";
import { createSessionAgentRunner, createSessionSkillRunner } from "./runners/sessionRunners";
import { createBabysitterPluginHooks, createBabysitterRuntime } from "./runtime";
import { createBabysitterToolHandlers } from "./tools/handlers";

export type Plugin = (ctx: unknown) => Promise<Record<string, unknown>>;

interface ToolDefinition {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute(args: unknown, context: unknown): Promise<unknown>;
}

function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

interface PluginContextLike {
  client: {
    session: {
      prompt(input: {
        path: { id: string };
        body: { parts: Array<{ type: "text"; text: string }> };
      }): Promise<unknown>;
    };
    app?: {
      log(input: {
        body: {
          service: string;
          level: "debug" | "info" | "warn" | "error";
          message: string;
          extra?: Record<string, unknown>;
        };
      }): Promise<unknown>;
    };
  };
  worktree?: string;
  directory?: string;
}

export interface CreateBabysitterPluginOptions {
  cliCommand?: string;
  breakpointCommand?: string;
  enableBreakpointCli?: boolean;
  breakpointPollIntervalSeconds?: number;
  enableHookDispatcher?: boolean;
  pluginRoot?: string;
  userConfigDir?: string;
  skillRunner?: SkillRunner;
  agentRunner?: AgentRunner;
  now?: () => Date;
}

export function createBabysitterPlugin(options: CreateBabysitterPluginOptions = {}): Plugin {
  return async (ctx: unknown) => {
    const pluginCtx = ctx as PluginContextLike;
    const cli = new BabysitterCli(new SpawnCommandExecutor(), options.cliCommand ?? "babysitter");
    const breakpoints =
      options.enableBreakpointCli === false
        ? undefined
        : new CliBreakpointClient({ command: options.breakpointCommand ?? "breakpoints" });
    const worktree = pluginCtx.worktree ?? pluginCtx.directory ?? process.cwd();
    const hookDispatcher =
      options.enableHookDispatcher === false
        ? undefined
        : new HookDispatcher({
            worktree,
            pluginRoot: options.pluginRoot ?? path.join(__dirname, ".."),
            userConfigDir: options.userConfigDir,
          });
    const skillRunner = options.skillRunner ?? createSessionSkillRunner(pluginCtx.client);
    const agentRunner = options.agentRunner ?? createSessionAgentRunner(pluginCtx.client);
    const runtime = createBabysitterRuntime({
      client: pluginCtx.client,
      cli,
      worktree,
      skillRunner,
      agentRunner,
      breakpoints,
      breakpointPollIntervalSeconds: options.breakpointPollIntervalSeconds,
      hookDispatcher,
      now: options.now,
    });
    const handlers = createBabysitterToolHandlers(runtime, {
      cli,
      askUser: async (request) => {
        const lines = ["Babysitter question:"];
        if (request.title) {
          lines.push(`Title: ${request.title}`);
        }
        lines.push(request.question);
        if (request.choices && request.choices.length > 0) {
          lines.push(`Choices: ${request.choices.join(" | ")}`);
        }
        lines.push("Please answer in your next message.");

        await pluginCtx.client.session.prompt({
          path: { id: request.sessionId },
          body: {
            parts: [{ type: "text", text: lines.join("\n") }],
          },
        });

        return { status: "prompted" as const };
      },
      onRunStart: async (event) => {
        if (!hookDispatcher) {
          return;
        }
        await hookDispatcher.dispatch("on-run-start", {
          runId: event.runId,
          sessionId: event.sessionId,
          source: event.source,
          timestamp: event.timestamp,
        });
      },
      onScore: async (event) => {
        if (!hookDispatcher) {
          return;
        }
        await hookDispatcher.dispatch("on-score", {
          sessionId: event.sessionId ?? null,
          score: event.score,
          threshold: event.threshold,
          passed: event.passed,
          breakdown: event.breakdown,
          timestamp: event.timestamp,
        });
      },
      now: options.now,
    });

    return {
      ...createBabysitterPluginHooks(runtime),
      tool: {
        babysitter_setup: defineTool({
          description: handlers.babysitter_setup.description,
          args: {
            prompt: z.string(),
            maxIterations: z.number().int().nonnegative().optional(),
            runId: z.string().optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_setup.execute(args as never, context as never);
          },
        }),
        babysitter_resume: defineTool({
          description: handlers.babysitter_resume.description,
          args: {
            runId: z.string(),
            maxIterations: z.number().int().nonnegative().optional(),
            prompt: z.string().optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_resume.execute(args as never, context as never);
          },
        }),
        babysitter_associate: defineTool({
          description: handlers.babysitter_associate.description,
          args: {
            runId: z.string(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_associate.execute(args as never, context as never);
          },
        }),
        babysitter_status: defineTool({
          description: handlers.babysitter_status.description,
          args: {
            sessionId: z.string().optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_status.execute(args as never, context as never);
          },
        }),
        babysitter_stop: defineTool({
          description: handlers.babysitter_stop.description,
          args: {
            sessionId: z.string().optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_stop.execute(args as never, context as never);
          },
        }),
        babysitter_ask: defineTool({
          description: handlers.babysitter_ask.description,
          args: {
            question: z.string(),
            title: z.string().optional(),
            choices: z.array(z.string()).optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_ask.execute(args as never, context as never);
          },
        }),
        babysitter_score: defineTool({
          description: handlers.babysitter_score.description,
          args: {
            criteria: z.array(
              z.object({
                name: z.string(),
                score: z.number(),
                weight: z.number().optional(),
              })
            ),
            passThreshold: z.number().optional(),
          },
          async execute(args: unknown, context: unknown) {
            return handlers.babysitter_score.execute(args as never, context as never);
          },
        }),
      },
    };
  };
}

export const BabysitterPlugin: Plugin = createBabysitterPlugin();
