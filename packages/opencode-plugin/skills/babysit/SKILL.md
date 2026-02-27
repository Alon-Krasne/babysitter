---
name: babysit
description: Orchestrate via babysitter. Use this skill to run complex workflows to completion.
version: 0.3.0
---

# babysit

Orchestrate `.a5c/runs/<runId>/` through iterative execution using the babysitter SDK CLI.

## CLI Setup

The babysitter CLI is available from the local repo. Use `node` to invoke it:

```bash
BABYSITTER="node /Users/alonkrasne/Documents/Projects/babysitter/packages/babysitter/bin/babysitter.js"
```

Use `$BABYSITTER` as the CLI command throughout. All CLI commands take a
`<runDir>` path (e.g., `.a5c/runs/my-run-id`), not a bare run ID.

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

## Core Iteration Workflow

1. Step the run forward (`$BABYSITTER run:step <runDir> --json`)
2. If status is `waiting`, list pending effects (`$BABYSITTER task:list <runDir> --pending --json`)
3. Execute pending effects (node scripts, agent tasks, skill tasks, breakpoints)
4. Commit results (`$BABYSITTER task:run <runDir> <effectId> --json` for node tasks)
5. **Go back to step 1 immediately — do not stop**

## 1) Create or find a process

### Interview phase

- Clarify intent, requirements, scope, and success criteria before setup.
- Research local repo and relevant process references.
- Iterate one step at a time; do not over-plan the interview stage.

### Process creation phase

- Create process files (`.mjs`) in `.a5c/processes`.
- Follow existing SDK process conventions.
- Explain process goals at high level to the user before executing runs.
- Unless otherwise specified, prefer quality-gated, convergent processes
  that close the widest feedback loop (e.g., e2e tests, full verification).

## 2) Setup

### Create a run

```bash
$BABYSITTER run:create \
  --process-id <id> \
  --entry <path>#<export> \
  --inputs <inputs-file> \
  --runs-dir .a5c/runs \
  --run-id <run-id> \
  --json
```

### Resume an existing run

Check status first:

```bash
$BABYSITTER run:status .a5c/runs/<runId> --json
```

Then continue the iteration loop from step 3 below.

## 3) Step the run

```bash
$BABYSITTER run:step .a5c/runs/<runId> --json
```

Statuses:
- `waiting` — there are pending effects to execute. **Continue immediately.**
- `completed` — the run finished successfully. **You may stop.**
- `failed` — the run failed. Inspect events, attempt recovery, then continue.

## 4) List pending effects

```bash
$BABYSITTER task:list .a5c/runs/<runId> --pending --json
```

Each effect has an `effectId`, `kind`, and `taskDefRef`.

## 5) Execute effects

### Node tasks (`kind: "node"`)

Let the CLI run and commit in one step:

```bash
$BABYSITTER task:run .a5c/runs/<runId> <effectId> --json
```

### Agent tasks (`kind: "agent"`)

Read the task definition from the `taskDefRef` path inside the run directory.
It contains a prompt in `inputs.prompt`. **You are the agent — do the work
described in the prompt.** Write code, run tests, fix bugs — whatever the
prompt asks. Then write the result to `tasks/<effectId>/result.json` in the
run directory and commit using `$BABYSITTER task:run`.

### Skill tasks (`kind: "skill"`)

Read the task definition. Invoke the named skill, capture the result,
and commit it.

### Breakpoints (`kind: "breakpoint"`)

This is the ONE case where you ask the user. Present the breakpoint question
to the user, wait for their response, then commit it.

## 6) Repeat until terminal state

**Go back to step 3 immediately after executing effects.** Continue the
loop until `run:step` returns `completed` or `failed`.

If `failed`, inspect events and attempt recovery:

```bash
$BABYSITTER run:events .a5c/runs/<runId> --limit 50 --reverse --json
$BABYSITTER run:rebuild-state .a5c/runs/<runId> --json
```

Then continue the loop.

## Task kinds

| Kind | Description | Executor |
|------|-------------|----------|
| `node` | Node script | `task:run` CLI command |
| `agent` | LLM task | You (the agent) do the work |
| `skill` | Skill task | Invoke the named skill |
| `breakpoint` | Human approval | Ask the user |
| `sleep` | Time gate | Wait until target time |

## Process design guidance

- Prefer quality-gated iterative development loops.
- Close the widest feedback loop possible (e2e tests, full browser, etc.).
- Include verification and refinement steps for planning, implementation,
  integration, debugging, and refactoring phases.
- Search for available skills and subagents before designing orchestration.

## Critical rules

- **NEVER stop the loop unless the run is `completed` or `failed`.**
- All CLI commands take `<runDir>` paths (`.a5c/runs/<runId>`), not bare IDs.
- For node tasks, prefer `task:run` which executes and commits in one step.
- Never write `tasks/<effectId>/result.json` directly without committing.
- Never build wrapper scripts to orchestrate runs — use the CLI directly.
- In non-interactive flows, do not self-approve breakpoints.
- If the run fails due to SDK issues or corrupted state, analyze the error
  and journal events, recover state, and continue.
