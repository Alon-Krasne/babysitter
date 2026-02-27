---
name: babysit
description: Orchestrate via babysitter. Use this skill when asked to babysit a run, orchestrate a process, or whenever it is called explicitly.
version: 0.4.0
---

# babysit

Orchestrate `.a5c/runs/<runId>/` through iterative execution using the babysitter SDK CLI.

The babysitter plugin provides custom tools (`babysitter_setup`, `babysitter_associate`,
`babysitter_resume`, `babysitter_status`, `babysitter_stop`, `babysitter_ask`, `babysitter_score`)
and a `session.idle` hook that auto-continues the loop. Use the tools and the CLI together.

## CLI

The babysitter CLI is available as `babysitter`. All commands take a `<runDir>` path
(e.g., `.a5c/runs/my-run-id`), **not** a bare run ID.

Available commands:

```
babysitter run:create --process-id <id> --entry <path>#<export> --inputs <file> --runs-dir .a5c/runs --run-id <id> --json
babysitter run:status <runDir> --json
babysitter run:step <runDir> --json
babysitter run:events <runDir> --limit <n> --reverse --json
babysitter run:rebuild-state <runDir> --json
babysitter task:list <runDir> --pending --json
babysitter task:run <runDir> <effectId> --json
babysitter task:show <runDir> <effectId> --json
```

## CRITICAL: Autonomous Loop Behavior

**You MUST keep iterating until the run reaches a terminal state (`completed`
or `failed`). Do NOT stop, pause, or ask for permission between iterations
unless a breakpoint task explicitly requires it.**

The orchestration loop is:
1. `run:step` to advance the process
2. If `waiting`: list pending effects, execute them, commit results
3. Go back to step 1
4. Stop ONLY when status is `completed` or `failed`

**Never exit the loop early. Never ask "should I continue?" — just continue.**

The `session.idle` hook will also prompt you to continue if you stop mid-loop.

## Workflow

### 1. Create or find a process

#### Interview phase

Interview the user for intent, requirements, goal, scope, etc. using the
`babysitter_ask` tool (or ask directly in interactive mode).

This is a multi-step phase:
1. Look at the state of the repo and understand the codebase.
2. Search for existing processes in `.a5c/processes/` that may be relevant.
3. Ask clarifying questions about intent, requirements, scope.
4. Decide one step at a time — do not plan more than 1 step ahead.
5. Continue until intent and scope are clear and the user is satisfied.

#### Process creation phase

Create process files (`.mjs`) in `.a5c/processes/`. A process is an ES module
that exports an async function receiving `(inputs, ctx)`:

```javascript
// .a5c/processes/my-process.mjs
import path from "node:path";

const buildTask = {
  id: "build",
  async build(args) {
    return {
      kind: "node",  // or "agent", "skill", "breakpoint"
      title: "Build the project",
      node: {
        entry: path.resolve(import.meta.dirname, "build-runner.mjs"),
        args: [],
        env: { TARGET_DIR: args.targetDir },
        timeoutMs: 60_000,
      },
    };
  },
};

const verifyTask = {
  id: "verify",
  async build(args) {
    return {
      kind: "agent",
      title: "Verify the build",
      inputs: {
        prompt: `Verify that the project at ${args.targetDir} builds and passes tests.`,
      },
    };
  },
};

export async function process(inputs, ctx) {
  const buildResult = await ctx.task(buildTask, inputs, { label: "build" });
  const verifyResult = await ctx.task(verifyTask, inputs, { label: "verify" });
  return { status: "ok", buildResult, verifyResult };
}
```

After creating the process, describe it at a high level to the user and ask
for confirmation before creating the run.

### 2. Setup session

#### New run

1. Activate the loop:

```
tool: babysitter_setup
args: { "maxIterations": 256 }
```

2. Create the run:

```bash
babysitter run:create \
  --process-id <id> \
  --entry .a5c/processes/<file>.mjs#process \
  --inputs <inputs-file> \
  --runs-dir .a5c/runs \
  --run-id <run-id> \
  --json
```

3. Associate the run:

```
tool: babysitter_associate
args: { "runId": "<runId-from-step-2>" }
```

#### Resume existing run

```
tool: babysitter_resume
args: { "runId": "<runId>", "maxIterations": 256 }
```

### 3. Step the run

```bash
babysitter run:step .a5c/runs/<runId> --json
```

Output includes `status`:
- `waiting` — pending effects to execute. **Continue immediately.**
- `completed` — run finished. Use `babysitter_stop` to deactivate the loop.
- `failed` — run failed. Inspect events, attempt recovery, then continue.

### 4. List pending effects

```bash
babysitter task:list .a5c/runs/<runId> --pending --json
```

Each effect has `effectId`, `kind`, `label`, and `taskDefRef`.

### 5. Execute effects

#### Node tasks (`kind: "node"`)

Let the CLI execute and commit in one step:

```bash
babysitter task:run .a5c/runs/<runId> <effectId> --json
```

#### Agent tasks (`kind: "agent"`)

Read the task definition from `<runDir>/<taskDefRef>`. It contains a prompt
in `inputs.prompt`. **You are the agent — do the work described in the prompt.**
Write code, run tests, fix bugs — whatever the prompt asks.

Then write the result value to a separate file and commit:

```bash
# Write result value
echo '{"status": "ok", "summary": "..."}' > .a5c/runs/<runId>/tasks/<effectId>/output.json
# Commit via task:run
babysitter task:run .a5c/runs/<runId> <effectId> --json
```

When delegating, use the Task tool. Make sure the work was actually performed
(files created, tests passing), not just described.

#### Skill tasks (`kind: "skill"`)

Read the task definition. Invoke the named skill, capture the result, and commit.

#### Breakpoints (`kind: "breakpoint"`)

This is the ONE case where you ask the user. Use `babysitter_ask` to present
the question, wait for the response, then commit.

**Never self-approve breakpoints in non-interactive mode.**

### 6. Repeat

**Go back to step 3 immediately.** Continue until `completed` or `failed`.

If `failed`, inspect and recover:

```bash
babysitter run:events .a5c/runs/<runId> --limit 50 --reverse --json
babysitter run:rebuild-state .a5c/runs/<runId> --json
```

## Task Kinds

| Kind | Description | Executor |
|------|-------------|----------|
| `node` | Node.js script | `task:run` CLI |
| `agent` | LLM task | You do the work (or delegate via Task tool) |
| `skill` | Skill invocation | Invoke the named skill |
| `breakpoint` | Human approval | Ask the user via `babysitter_ask` |
| `sleep` | Time gate | Wait until target time |

## Process Design Guidelines

- Prefer quality-gated iterative development loops.
- Close the widest feedback loop possible (e2e tests, full browser/emulator).
- Include verification and refinement steps for planning, implementation,
  integration, debugging, and refactoring phases.
- Test-driven: quality gates should use executable tools, scripts, and tests.
- Search for existing processes in `.a5c/processes/` before creating new ones.
- Build modular, reusable process parts in `.a5c/processes/` for composition.
- If the user is explicit about the flow, follow it closely.
- For new projects: plan architecture, stack, milestones.
- For existing projects: analyze architecture, plan changes, integration steps.

## Critical Rules

- **NEVER stop the loop unless the run is `completed` or `failed`.**
- All CLI commands take `<runDir>` paths, not bare IDs.
- For node tasks, use `task:run` which executes and commits in one step.
- Never write `tasks/<effectId>/result.json` directly — use `task:run` or
  write to a separate file and let the CLI commit.
- Never build wrapper scripts to orchestrate — use the CLI directly.
- Never use the babysit skill inside delegated tasks. If you are performing
  a delegated task as a subagent, do the actual work — don't orchestrate.
- Never fallback to simpler execution if the user activated this skill.
  You must create a process, create a run, and iterate until completion.
- If the run fails due to SDK issues or corrupted state, analyze the error
  and journal events, recover state, and continue.
- Never self-approve breakpoints in non-interactive mode.
