import { z } from "zod";
import { CliBreakpointClient } from "./breakpoints/cliBreakpointClient";
import { BabysitterCli, SpawnCommandExecutor } from "./cli/babysitterCli";
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
    const runtime = createBabysitterRuntime({
      client: pluginCtx.client,
      cli,
      worktree,
      breakpoints,
      breakpointPollIntervalSeconds: options.breakpointPollIntervalSeconds,
      now: options.now,
    });
    const handlers = createBabysitterToolHandlers(runtime, {
      cli,
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
      },
    };
  };
}

export const BabysitterPlugin: Plugin = createBabysitterPlugin();
