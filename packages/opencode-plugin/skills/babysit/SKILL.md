---
name: babysit
description: Orchestrate via babysitter. Use this skill to run complex workflows to completion.
allowed-tools: Read, Grep, Write, Task, Bash, Edit, Glob, WebFetch, TodoWrite, Skill, babysitter_setup, babysitter_resume, babysitter_associate, babysitter_status, babysitter_stop
version: 0.1.0
---

# babysit

Orchestrate `.a5c/runs/<runId>/` through iterative execution using `@a5c-ai/babysitter-sdk`.

## Dependencies

Make sure the SDK CLI is available:

```bash
npm i -g @a5c-ai/babysitter@latest @a5c-ai/babysitter-sdk@latest @a5c-ai/babysitter-breakpoints@latest
```

Use `babysitter` as the CLI command.

## Core Iteration Workflow

1. Run iteration (`run:iterate`)
2. Get effects (`task:list --pending --json`)
3. Perform effects (node/agent/skill/breakpoint handlers)
4. Post results (`task:post`)

## 1) Create or find a process

### Interview phase

- Clarify intent, requirements, scope, and success criteria before setup.
- Research local repo and relevant process references.
- Iterate one step at a time; do not over-plan the interview stage.

### Process creation phase

- Create process files (`.js` and companion config where needed) in `.a5c/processes`.
- Follow existing SDK process conventions and references from process library files.
- Explain process goals at high level to the user before executing runs.

## 2) Setup session

### New run

1. Activate loop in current session:

```json
tool: babysitter_setup
args: { "prompt": "<orchestration prompt>", "maxIterations": 256 }
```

2. Create run:

```bash
babysitter run:create --process-id <id> --entry <path>#<export> --inputs <file> --json
```

3. Associate run id to session:

```json
tool: babysitter_associate
args: { "runId": "<runId>" }
```

### Resume run

```json
tool: babysitter_resume
args: { "runId": "<runId>", "maxIterations": 256 }
```

## 3) Run iteration

```bash
babysitter run:iterate <runId> --json --iteration <n>
```

Typical statuses:
- `waiting`
- `completed`
- `failed`

## 4) Get effects

```bash
babysitter task:list <runId> --pending --json
```

## 5) Perform effects

- Prefer delegating non-trivial effects with `Task` when possible.
- Verify delegated work actually happened (files/tests/results), not just described.

### Breakpoints

- Interactive: ask user directly in the session.
- Non-interactive: create breakpoints with `@a5c-ai/babysitter-breakpoints` and wait for external resolution.

## 6) Post results

Never write `tasks/<effectId>/result.json` directly.

Correct pattern:

1. Write a separate value file.
2. Post via CLI.

```bash
babysitter task:post <runId> <effectId> --status ok --value tasks/<effectId>/output.json --json
```

Error pattern:

```bash
babysitter task:post <runId> <effectId> --status error --error tasks/<effectId>/error.json --json
```

## 7) Repeat until terminal state

- Continue iterate -> list -> execute -> post until `run:status` is `completed`.
- If state is `failed`, repair process/state/journal and continue.

## Task kinds

| Kind | Description | Executor |
|------|-------------|----------|
| `node` | Node script | Local node runtime |
| `agent` | LLM task | Agent runtime |
| `skill` | Skill task | Skill system |
| `breakpoint` | Human approval | Breakpoints API or user prompt |
| `sleep` | Time gate | Scheduler |

## Recovery guidance

- If run state is inconsistent, inspect events first:

```bash
babysitter run:events <runId> --limit 50 --reverse
```

- Rebuild state cache when needed:

```bash
babysitter run:rebuild-state <runId>
```

## Critical rules

- Never bypass the CLI orchestration loop with custom wrapper scripts.
- Never use this skill to execute delegated tasks directly; delegated workers should do implementation work.
- In non-interactive flows, do not self-approve breakpoints.
- Prefer quality-gated, convergent processes that verify the full user request.
