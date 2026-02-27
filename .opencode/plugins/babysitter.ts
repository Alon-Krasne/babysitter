import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs"

/**
 * Babysitter plugin for OpenCode.
 *
 * Registers custom tools for managing babysitter runs and hooks into
 * session.idle to keep the orchestration loop running autonomously.
 */

const BABYSITTER_CMD = "babysitter"

function babysitterCmd(args: string, cwd: string): string {
  return execSync(`${BABYSITTER_CMD} ${args}`, {
    encoding: "utf8",
    cwd,
    timeout: 60_000,
  }).trim()
}

// In-memory state per session
const sessions = new Map<
  string,
  {
    active: boolean
    runId?: string
    runDir?: string
    iteration: number
    maxIterations: number
  }
>()

export const BabysitterPlugin: Plugin = async ({ client, directory, worktree }) => {
  const cwd = worktree || directory

  return {
    // ── Session idle hook: auto-continue babysitter runs ──
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      // Find any active session
      for (const [sessionId, state] of sessions) {
        if (!state.active || !state.runDir) continue
        if (state.iteration >= state.maxIterations) {
          state.active = false
          continue
        }

        // Check if run is still going
        try {
          const statusRaw = babysitterCmd(
            `run:status ${state.runDir} --json`,
            cwd
          )
          const status = JSON.parse(statusRaw)

          if (status.state === "completed" || status.state === "failed") {
            state.active = false
            continue
          }

          // Run still active — prompt the agent to continue
          state.iteration++
          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [
                {
                  type: "text",
                  text: [
                    `Babysitter run "${state.runId}" is still active (iteration ${state.iteration}/${state.maxIterations}).`,
                    `Continue the orchestration loop: run:step -> execute effects -> commit results.`,
                    `Use the babysit skill for instructions.`,
                  ].join("\n"),
                },
              ],
            },
          })
        } catch {
          // If anything fails, don't crash — just skip this cycle
        }
      }
    },

    // ── Custom tools ──
    tool: {
      babysitter_setup: tool({
        description:
          "Activate the babysitter orchestration loop for this session. Call this before starting a run.",
        args: {
          maxIterations: tool.schema
            .number()
            .optional()
            .describe("Max iterations before auto-stopping (default: 256)"),
        },
        async execute(args, context) {
          const sessionId = context.sessionID
          sessions.set(sessionId, {
            active: true,
            iteration: 0,
            maxIterations: args.maxIterations ?? 256,
          })
          return JSON.stringify({
            status: "ok",
            sessionId,
            maxIterations: args.maxIterations ?? 256,
            message: "Babysitter loop activated. Create a run and associate it.",
          })
        },
      }),

      babysitter_associate: tool({
        description:
          "Associate a babysitter run ID with this session so the idle hook can track it.",
        args: {
          runId: tool.schema.string().describe("The babysitter run ID"),
        },
        async execute(args, context) {
          const sessionId = context.sessionID
          const state = sessions.get(sessionId)
          if (!state) {
            return JSON.stringify({
              status: "error",
              message: "No active babysitter session. Call babysitter_setup first.",
            })
          }
          state.runId = args.runId
          state.runDir = path.join(cwd, ".a5c", "runs", args.runId)
          return JSON.stringify({
            status: "ok",
            runId: args.runId,
            runDir: state.runDir,
          })
        },
      }),

      babysitter_resume: tool({
        description: "Resume an existing babysitter run in this session.",
        args: {
          runId: tool.schema.string().describe("The babysitter run ID to resume"),
          maxIterations: tool.schema
            .number()
            .optional()
            .describe("Max iterations (default: 256)"),
        },
        async execute(args, context) {
          const sessionId = context.sessionID
          const runDir = path.join(cwd, ".a5c", "runs", args.runId)

          if (!fs.existsSync(runDir)) {
            return JSON.stringify({
              status: "error",
              message: `Run directory not found: ${runDir}`,
            })
          }

          sessions.set(sessionId, {
            active: true,
            runId: args.runId,
            runDir,
            iteration: 0,
            maxIterations: args.maxIterations ?? 256,
          })

          const statusRaw = babysitterCmd(`run:status ${runDir} --json`, cwd)
          return JSON.stringify({
            status: "ok",
            runId: args.runId,
            runStatus: JSON.parse(statusRaw),
          })
        },
      }),

      babysitter_status: tool({
        description: "Check the status of the current babysitter session and run.",
        args: {},
        async execute(_args, context) {
          const sessionId = context.sessionID
          const state = sessions.get(sessionId)

          if (!state) {
            return JSON.stringify({
              status: "no-session",
              message: "No active babysitter session.",
            })
          }

          let runStatus = null
          if (state.runDir && fs.existsSync(state.runDir)) {
            try {
              const raw = babysitterCmd(
                `run:status ${state.runDir} --json`,
                cwd
              )
              runStatus = JSON.parse(raw)
            } catch {}
          }

          return JSON.stringify({
            active: state.active,
            runId: state.runId,
            iteration: state.iteration,
            maxIterations: state.maxIterations,
            runStatus,
          })
        },
      }),

      babysitter_stop: tool({
        description: "Stop the babysitter orchestration loop for this session.",
        args: {},
        async execute(_args, context) {
          const sessionId = context.sessionID
          const state = sessions.get(sessionId)
          if (state) {
            state.active = false
          }
          return JSON.stringify({
            status: "ok",
            message: "Babysitter loop stopped.",
          })
        },
      }),

      babysitter_ask: tool({
        description:
          "Ask the user a question during a babysitter run (equivalent to AskUserQuestion).",
        args: {
          question: tool.schema.string().describe("Question to ask the user"),
          title: tool.schema.string().optional().describe("Title for the question"),
          choices: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Optional choices"),
        },
        async execute(args) {
          // This tool's output goes to the agent, which presents it to the user.
          // The agent's next message will contain the user's answer.
          return JSON.stringify({
            status: "waiting",
            question: args.question,
            title: args.title,
            choices: args.choices,
            instructions:
              "Present this question to the user and wait for their response before continuing.",
          })
        },
      }),

      babysitter_score: tool({
        description:
          "Score the quality of completed work against criteria.",
        args: {
          criteria: tool.schema.array(
            tool.schema.object({
              name: tool.schema.string(),
              weight: tool.schema.number().optional(),
              description: tool.schema.string().optional(),
            })
          ).describe("Scoring criteria"),
          passThreshold: tool.schema
            .number()
            .optional()
            .describe("Minimum score to pass (0-100, default: 70)"),
        },
        async execute(args) {
          return JSON.stringify({
            status: "score-requested",
            criteria: args.criteria,
            passThreshold: args.passThreshold ?? 70,
            instructions:
              "Evaluate the work against each criterion. Return a score 0-100 for each, then compute a weighted average. If the average >= passThreshold, the work passes.",
          })
        },
      }),
    },
  }
}
