---
name: babysit
description: Orchestrate via babysitter. Use this skill to run complex workflows to completion.
version: 0.2.0
---

# babysit

Orchestrate `.a5c/runs/<runId>/` through iterative execution using `@a5c-ai/babysitter-sdk`.

## Dependencies

Make sure the babysitter CLI is available:

```bash
npm i -g @a5c-ai/babysitter@latest @a5c-ai/babysitter-sdk@latest
```

Use `babysitter` as the CLI command. All CLI commands take a `<runDir>` path
(e.g., `.a5c/runs/my-run-id`), not a bare run ID.

## Core Iteration Workflow

1. Step the run forward (`run:step <runDir> --json`)
2. If status is `waiting`, list pending effects (`task:list <runDir> --pending --json`)
3. Execute pending effects (node scripts, agent tasks, skill tasks, breakpoints)
4. Commit results (`task:run <runDir> <effectId> --json` for node tasks, or write result + use SDK `commitEffectResult` programmatically)
5. Repeat from step 1

## 1) Create or find a process

### Interview phase

- Clarify intent, requirements, scope, and success criteria before setup.
- Research local repo and relevant process references.
- Iterate one step at a time; do not over-plan the interview stage.

### Process creation phase

- Create process files (`.mjs` and companion config where needed) in `.a5c/processes`.
- Follow existing SDK process conventions and references from process library files.
- Explain process goals at high level to the user before executing runs.

## 2) Setup

### Create a run

```bash
babysitter run:create \
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
babysitter run:status .a5c/runs/<runId> --json
```

Then continue the iteration loop from step 3 below.

## 3) Step the run

```bash
babysitter run:step .a5c/runs/<runId> --json
```

Statuses:
- `waiting` — there are pending effects to execute
- `completed` — the run finished successfully
- `failed` — the run failed (inspect events for details)

## 4) List pending effects

```bash
babysitter task:list .a5c/runs/<runId> --pending --json
```

Each effect has an `effectId`, `kind`, and `taskDefRef`.

## 5) Execute effects

### Node tasks (`kind: "node"`)

The simplest path — let the CLI run and commit in one step:

```bash
babysitter task:run .a5c/runs/<runId> <effectId> --json
```

### Agent tasks (`kind: "agent"`)

Read the task definition from the `taskDefRef` path. It contains a prompt
in `inputs.prompt`. Execute the prompt (you are the agent — do the work),
then write the result to `tasks/<effectId>/result.json` in the run directory
and commit it.

### Skill tasks (`kind: "skill"`)

Read the task definition. Invoke the named skill, capture the result,
and commit it.

### Breakpoints (`kind: "breakpoint"`)

Ask the user for approval/input, then commit the response.

## 6) Repeat until terminal state

- Continue step -> list -> execute -> commit until `run:status` returns `completed`.
- If state is `failed`, inspect events and repair:

```bash
babysitter run:events .a5c/runs/<runId> --limit 50 --reverse --json
babysitter run:rebuild-state .a5c/runs/<runId> --json
```

## Task kinds

| Kind | Description | Executor |
|------|-------------|----------|
| `node` | Node script | `task:run` CLI command |
| `agent` | LLM task | You (the agent) do the work |
| `skill` | Skill task | Invoke the named skill |
| `breakpoint` | Human approval | Ask the user |
| `sleep` | Time gate | Wait until target time |

## Critical rules

- All CLI commands take `<runDir>` paths (`.a5c/runs/<runId>`), not bare IDs.
- For node tasks, prefer `task:run` which executes and commits in one step.
- Never write `tasks/<effectId>/result.json` directly without committing via the SDK.
- Never bypass the CLI orchestration loop.
- In non-interactive flows, do not self-approve breakpoints.
- Prefer quality-gated, convergent processes that verify the full user request.
