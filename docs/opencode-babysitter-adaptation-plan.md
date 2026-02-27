# Babysitter — OpenCode Plugin

**Version:** 3.1
**Date:** 2026-02-27 (originally 2026-02-02)

---

## Executive Summary

**Babysitter** is an orchestration system for agentic coding. It defines
processes (task graphs in JS), manages runs, and tells an AI coding agent
what to do next. The agent does the actual work — writing code, running
tests, fixing bugs — and babysitter keeps it on track.

Until now, the only agent babysitter could drive was **Claude Code**. The
Claude Code plugin (`plugins/babysitter/`) hooks into Claude Code's
lifecycle, feeds it tasks from babysitter runs, and posts results back.

**This work adds OpenCode as a second agent that babysitter can drive.**

A new plugin package (`packages/opencode-plugin/`) is a babysitter plugin
that tells OpenCode what to do. It:
- Hooks into OpenCode's `session.idle` events to keep it working
- Registers babysitter tools so OpenCode can set up/manage runs
- Executes pending tasks from babysitter processes (node scripts, agent
  prompts, skill invocations, breakpoints)
- Commits task results back to babysitter via the SDK

The babysitter SDK and CLI are unchanged — they don't know or care which
agent is doing the work. The plugin is the adapter layer between babysitter
and the agent runtime.

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│  Babysitter SDK (@a5c-ai/babysitter-sdk)        │
│  Process engine, CLI, run storage               │
│  Agent-agnostic — unchanged by this work        │
└────────────┬────────────────────┬───────────────┘
             │                    │
    ┌────────▼────────┐  ┌───────▼─────────┐
    │ Claude Code     │  │ OpenCode        │
    │ Plugin          │  │ Plugin (NEW)    │
    │ plugins/        │  │ packages/       │
    │ babysitter/     │  │ opencode-plugin/│
    └────────┬────────┘  └───────┬─────────┘
             │                    │
    ┌────────▼────────┐  ┌───────▼─────────┐
    │ Claude Code     │  │ OpenCode        │
    │ (does the work) │  │ (does the work) │
    └─────────────────┘  └─────────────────┘
```

---

## Table of Contents

1. [Complete Feature Inventory](#complete-feature-inventory)
2. [Gap Analysis](#gap-analysis)
3. [Plugin Structure Design](#plugin-structure-design)
4. [Skills Adaptation](#skills-adaptation)
5. [Commands Adaptation](#commands-adaptation)
6. [Component Adaptations](#component-adaptations)
7. [Implementation Phases](#implementation-phases)
8. [API Mapping](#api-mapping)
9. [Testing Strategy](#testing-strategy)

---

## Complete Feature Inventory

### Claude Code Babysitter Plugin Stats

| Category | Count | Notes |
|----------|-------|-------|
| Skills | 2 | babysit (main), babysitter-score |
| Hooks | 22 | System + orchestration + lifecycle |
| Scripts | 3 | Setup, resume, associate |
| Commands | 1 | /call (invokes babysit skill) |

### Skills

| Name | File | Purpose |
|------|------|---------|
| babysit | `skills/babysit/SKILL.md` | Main orchestration skill |
| babysitter-score | `skills/babysitter-score/SKILL.md` | Quality scoring utility |

### Commands

| Name | File | Purpose |
|------|------|---------|
| call | `commands/call.md` | Invoke babysit skill to orchestrate a workflow |

### Hooks (22 Total)

**System Hooks (Claude Code CLI):**

| Hook | File | Purpose |
|------|------|---------|
| SessionStart | `babysitter-session-start-hook.sh` | Capture CLAUDE_SESSION_ID |
| Stop | `babysitter-stop-hook.sh` | In-session loop mechanism |

**Orchestration Hooks (run:iterate):**

| Hook | File | Purpose |
|------|------|---------|
| on-iteration-start | `native-orchestrator.sh` | Execute pending tasks |
| on-iteration-end | `native-finalization.sh` | Finalize iteration |

**Lifecycle Hooks:**

| Hook | File | Purpose |
|------|------|---------|
| on-run-start | `logger.sh` | Run creation logging |
| on-run-complete | `logger.sh` | Success logging |
| on-run-fail | `logger.sh` | Failure logging |
| on-task-start | `logger.sh` | Task start logging |
| on-task-complete | `logger.sh` | Task completion logging |

**Process Hooks (ctx.hook()):**

| Hook | File | Purpose |
|------|------|---------|
| on-breakpoint | `breakpoint-handler.sh` | Human approval handling |
| on-score | `logger.sh` | Quality scoring events |
| pre-commit | `logger.sh` | Pre-commit validation |
| pre-branch | `logger.sh` | Pre-branch validation |
| post-planning | `logger.sh` | Post-planning finalization |
| on-step-dispatch | `logger.sh` | Step dispatch tracking |

**Infrastructure:**

| Hook | File | Purpose |
|------|------|---------|
| hook-dispatcher | `hook-dispatcher.sh` | Discovery & execution engine |
| skill-discovery | `skill-discovery.sh` | Find available skills |
| skill-context-resolver | `skill-context-resolver.sh` | Resolve skill context |

### Scripts

| Script | Purpose |
|--------|---------|
| `setup-babysitter-run.sh` | Create in-session loop state file |
| `setup-babysitter-run-resume.sh` | Resume existing run |
| `associate-session-with-run.sh` | Link session ID to run ID |

### Special Features

| Feature | Description |
|---------|-------------|
| Interview Phase | Gather requirements via AskUserQuestion |
| In-Session Loop | Stop hook blocks exit, injects continuation prompt |
| Breakpoints | Human-in-the-loop approval via AskUserQuestion |
| Quality Convergence | Agent scoring with iterative improvement |
| Parallel Execution | `ctx.parallel.all([tasks])` batching |
| Agent Tasks | LLM-powered task execution (`kind: "agent"`) |
| Skill Tasks | Skill invocation from processes (`kind: "skill"`) |

---

## Gap Analysis

### Summary

| Severity | Count | Description |
|----------|-------|-------------|
| Blocking | 1 | Stop hook → idle hook mechanism |
| Significant | 4 | Hook system, AskUserQuestion, agent tasks, skill tasks |
| Minor | 5+ | Logging, state persistence, skill discovery |

### Blocking Gap

#### 1. In-Session Loop Mechanism (CRITICAL)

| Attribute | Claude Code | OpenCode |
|-----------|-------------|----------|
| Hook | Stop hook with `{decision: 'block', reason: '<prompt>'}` | No equivalent |
| Trigger | Before Claude exits | N/A |
| Prompt Injection | Via hook return value | N/A |

**Solution:** Use `session.idle` event + `client.session.prompt()` API

```typescript
event: async ({ event }) => {
  if (event.type === "session.idle") {
    const state = getSessionState(sessionId);
    if (state?.active && hasPendingTasks(state.runDir)) {
      await client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: continuationPrompt }] }
      });
    }
  }
}
```

### Significant Gaps

#### 2. Hook System

| Attribute | Claude Code | OpenCode |
|-----------|-------------|----------|
| Count | 22 hooks | Limited event hooks |
| Execution | Shell scripts | TypeScript functions |
| Discovery | Multi-directory chain | Plugin-only |

**Solution:** Implement hook dispatcher in TypeScript, execute shell scripts via Node `child_process.spawn`.

#### 3. AskUserQuestion Tool

| Attribute | Claude Code | OpenCode |
|-----------|-------------|----------|
| Tool | Built-in interactive | May not be available |
| UI | Native prompt | N/A |

**Solution:** Custom tool or use `client.tui.appendPrompt()` / `client.tui.submitPrompt()`.

#### 4. Agent Task Execution

| Attribute | Claude Code | OpenCode |
|-----------|-------------|----------|
| Task Kind | `kind: "agent"` | Need implementation |
| Execution | Native orchestrator | Need implementation |

**Solution:** Use `client.session.prompt()` with agent prompt template.

#### 5. Skill Task Invocation

| Attribute | Claude Code | OpenCode |
|-----------|-------------|----------|
| Task Kind | `kind: "skill"` | Need implementation |
| Discovery | `skill-discovery.sh` | Need implementation |

**Solution:** Implement skill discovery and invocation.

### Minor Gaps

- Logging hooks → Callback-based event dispatch
- State file persistence → JSON file at `.a5c/state/opencode-sessions.json`
- Transcript access → Track via `tool.execute.after`
- Shell script execution → Node `child_process.spawn` (not Bun)

---

## Plugin Structure Design

### Directory Layout (actual)

```
@a5c-ai/babysitter-opencode/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── HOOKS.md
├── src/
│   ├── index.ts                    # Public API exports
│   ├── plugin.ts                   # createBabysitterPlugin() entry point
│   ├── runtime.ts                  # createBabysitterRuntime(), session loop
│   ├── cli/
│   │   └── babysitterCli.ts        # SDK CLI wrappers (Node child_process + commitEffectResult)
│   ├── hooks/
│   │   └── dispatcher.ts           # Hook discovery & shell script execution
│   ├── loop/
│   │   ├── idleLoop.ts             # session.idle continuation logic
│   │   └── runawayGuard.ts         # Iteration runaway detection
│   ├── orchestrator/
│   │   └── nativeOrchestrator.ts   # Task execution: node, agent, skill, breakpoint
│   ├── breakpoints/
│   │   ├── cliBreakpointClient.ts  # CLI-based breakpoint create/wait
│   │   └── interactiveBreakpointHandler.ts  # In-session askUser breakpoints
│   ├── convergence/
│   │   └── qualityConvergenceLoop.ts  # score -> threshold -> improve loop
│   ├── state/
│   │   └── sessionState.ts         # In-memory Map + JSON file persistence
│   ├── tools/
│   │   └── handlers.ts             # All 7 tools (setup, resume, associate, status, stop, ask, score)
│   ├── runners/
│   │   └── sessionRunners.ts       # Delegated skill/agent task execution
│   └── plugin/
│       ├── toolLifecycleHooks.ts   # tool.execute.after dispatch
│       └── askResponseCoordinator.ts  # Ask-response blocking wait
├── skills/
│   ├── babysit/
│   │   └── SKILL.md                # Main orchestration skill
│   └── babysitter-score/
│       └── SKILL.md                # Scoring skill
└── commands/
    ├── babysit.md                  # /babysit command
    ├── babysit-resume.md           # /babysit-resume command
    └── babysit-status.md           # /babysit-status command
```

---

## Skills Adaptation

OpenCode supports skills with the same SKILL.md format as Claude Code.

### Main Skill: babysit

**Claude Code:** `skills/babysit/SKILL.md`
**OpenCode:** `skills/babysit/SKILL.md`

```yaml
---
name: babysit
description: Orchestrate via @babysitter. Use this skill when asked to babysit a run, orchestrate a process or whenever it is called explicitly.
allowed-tools: Read, Grep, Write, Task, Bash, Edit, Glob, WebFetch, WebSearch, AskUserQuestion, TodoWrite, TodoRead, Skill
version: 0.1.1
---

# babysit

Orchestrate `.a5c/runs/<runId>/` through iterative execution...
```

**Adaptations Required:**
1. Update environment variable references (`CLAUDE_PLUGIN_ROOT` → plugin directory)
2. Update script paths for TypeScript equivalents
3. Keep all workflow instructions and rules

### Scoring Skill: babysitter-score

**Claude Code:** `skills/babysitter-score/SKILL.md`
**OpenCode:** `skills/babysitter-score/SKILL.md`

Same format, minimal changes required.

---

## Commands Adaptation

OpenCode supports slash commands via markdown files in `commands/` directory.

### OpenCode Command Format

Commands are markdown files with YAML frontmatter:

```yaml
---
description: Brief explanation shown in TUI
agent: optional agent name
model: optional model override
subtask: boolean for subagent invocation
---

Command template with $ARGUMENTS placeholder...
```

### Command: /babysit

**Claude Code:** `commands/call.md`
```yaml
---
description: Orchestrate a babysitter run. use this command to start babysitting a complex workflow.
argument-hint: Specific instructions for the run.
allowed-tools: Read, Grep, Write, Task, Bash, Edit, ...
---

Invoke the babysitter:babysit skill (using the Skill tool) and follow its instructions (SKILL.md).
```

**OpenCode:** `commands/babysit.md`
```yaml
---
description: Orchestrate a babysitter run to manage complex workflows
---

Invoke the babysit skill and follow its instructions.

User request: $ARGUMENTS

Start by:
1. Running the interview phase to understand requirements
2. Creating or finding an appropriate process
3. Setting up the in-session loop
4. Iterating until completion
```

### Command: /babysit-resume

**OpenCode:** `commands/babysit-resume.md`
```yaml
---
description: Resume an existing babysitter run
---

Resume the babysitter run with ID: $ARGUMENTS

Use the babysit skill to:
1. Set up the in-session loop for the existing run
2. Continue iterating from the current state
3. Complete the remaining tasks
```

### Command: /babysit-status

**OpenCode:** `commands/babysit-status.md`
```yaml
---
description: Check the status of a babysitter run
---

Check the status of babysitter run: $ARGUMENTS

Run:
```bash
npx -y @a5c-ai/babysitter-sdk@latest run:status "$ARGUMENTS" --json
```

Report the current state, pending tasks, and completion status.
```

---

## Component Adaptations

### 1. Plugin Entry Point

| Original | Adaptation |
|----------|------------|
| `plugin.json` | `export const BabysitterPlugin: Plugin = async (ctx) => {}` |

### 2. In-Session Loop (CRITICAL)

| Original | Adaptation |
|----------|------------|
| `babysitter-stop-hook.sh` | `session.idle` event + `client.session.prompt()` |

```typescript
if (event.type === "session.idle") {
  const state = getSessionState(sessionId);
  if (!state?.active || !state.runDir) return;

  // Safety checks
  if (state.iteration >= state.maxIterations) return;
  if (isRunaway(state.iterationTimes)) return;

  // Check for pending work
  const iterateResult = await runIterate(state.runDir);
  if (iterateResult.status === "completed") {
    updateSessionState(sessionId, { active: false });
    return;
  }

  // Inject continuation prompt
  const tasks = await taskList(state.runDir, { pending: true });
  await client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text: buildPrompt(tasks) }] }
  });
}
```

### 3. Hook Dispatcher

| Original | Adaptation |
|----------|------------|
| `hook-dispatcher.sh` | `src/hooks/dispatcher.ts` |

**Discovery Order (actual):**
1. `{worktree}/.a5c/hooks/<hook-name>/` (per-repo)
2. `~/.config/babysitter/hooks/<hook-name>/` (per-user)
3. `{pluginRoot}/hooks/<hook-name>/` (built-in, if pluginRoot configured)

### 4. Native Orchestrator

| Original | Adaptation |
|----------|------------|
| `native-orchestrator.sh` | `src/hooks/on-iteration-start.ts` |

**Responsibilities:**
- Load run status via SDK CLI
- List pending tasks
- Execute auto-runnable tasks (kind="node")
- Handle agent tasks (kind="agent") via `client.session.prompt()`
- Handle skill tasks (kind="skill") via skill invocation
- Commit results via SDK's `commitEffectResult` (not CLI — there is no `task:post` command)

### 5. Breakpoint Handler

| Original | Adaptation |
|----------|------------|
| `breakpoint-handler.sh` | `src/hooks/on-breakpoint.ts` |

**Implementation:** Use AskUserQuestion equivalent or `client.tui` methods for user interaction.

### 6. Setup Scripts

| Original | Adaptation |
|----------|------------|
| `setup-babysitter-run.sh` | `src/tools/setup.ts` |
| `setup-babysitter-run-resume.sh` | `src/tools/setup.ts` (resume function) |
| `associate-session-with-run.sh` | `src/tools/setup.ts` (associate function) |

---

## Implementation Phases

Status legend: `[x]` completed, `[ ]` remaining.

### Phase 1: Core Infrastructure
**Complexity:** Medium | **Duration:** 3 days

- [x] Plugin entry point with OpenCode API
- [x] Session state management (Map + file)
- [x] Basic tools and loop controls (`setup`, `resume`, `associate`, `status`, `stop`) plus iterate/task post via CLI wrappers
- [x] SDK CLI wrappers (Node `child_process.spawn` for run:status/task:list; SDK `commitEffectResult` for task commit)
- [x] Idle hook for auto-continuation
- [x] Tool lifecycle dispatch via `tool.execute.after`

### Phase 2: Skills & Commands
**Complexity:** Low | **Duration:** 1-2 days

- [x] Port `babysit` skill (SKILL.md)
- [x] Port `babysitter-score` skill
- [x] Create `/babysit` command
- [x] Create `/babysit-resume` command
- [x] Create `/babysit-status` command

### Phase 3: Interview & Setup
**Complexity:** Medium | **Duration:** 2-3 days

- [x] `babysitter_ask` tool (AskUserQuestion equivalent)
- [x] `setupBabysitterRun()` function
- [x] `setupBabysitterRunResume()` function
- [x] `associateSessionWithRun()` function
- [x] Interview phase instructions in skill

### Phase 4: Hook System
**Complexity:** High | **Duration:** 3-5 days

- [x] Hook dispatcher with multi-directory discovery
- [x] `on-iteration-start` (native orchestrator)
- [x] `on-iteration-end` (finalization)
- [x] Lifecycle hooks (run-start, complete, fail)
- [x] Task hooks (task-start, complete)
- [x] Shell script hook execution (via child process runner)

### Phase 5: Advanced Task Types
**Complexity:** High | **Duration:** 3-4 days

- [x] Agent task execution (`kind: "agent"`)
- [x] Skill task invocation (`kind: "skill"`)
- [x] Parallel task batching
- [x] Breakpoint handling via direct in-session user interaction (`InteractiveBreakpointHandler` with `askUser` callback)

### Phase 6: Quality Convergence
**Complexity:** Medium | **Duration:** 2-3 days

- [x] `babysitter_score` tool
- [x] Agent-based quality scoring orchestration loop (`runConvergenceLoop` with pluggable score/improve callbacks)
- [x] Iterative improvement loop automation (stalling detection, abort via review callback, score history tracking)
- [x] Minimal improvement gates (`passThreshold` support in `babysitter_score`)

### Phase 7: Documentation & Testing
**Complexity:** Medium | **Duration:** 3-5 days

- [x] README.md
- [x] HOOKS.md development guide
- [x] Unit tests for state management
- [x] Integration tests for tools
- [x] E2E: Full orchestration loop (automated test coverage)

### Post-Phase Validation

- [x] E2E babysitter run with OpenCode plugin orchestrator (hello-world process: scaffold + verify, full run:step -> orchestrate -> commit loop)
- [ ] Live OpenCode runtime smoke validation (start/resume/breakpoint/ask-response/persistence with real sessions)
- [ ] Final parity checklist sign-off and PR summary

### E2E Validation Results (2026-02-27)

Ran a real babysitter process (`hello-process.mjs`) end-to-end using the
OpenCode plugin's `runNativeOrchestrator` + `BabysitterCli` adapter.

**Process:** 2-task hello-world (scaffold files, verify existence).

**Flow verified:**
1. `babysitter run:create` -> run created
2. `babysitter run:step` -> status `waiting`, scaffold task pending
3. Plugin orchestrator picks up node task, executes runner, commits via SDK `commitEffectResult`
4. `babysitter run:step` -> status `waiting`, verify task pending
5. Plugin orchestrator executes verify runner, commits result
6. `babysitter run:step` -> status `completed`, full output returned

**Bugs found and fixed:**
1. `taskPost` called nonexistent `task:post` CLI command — replaced with direct SDK `commitEffectResult`
2. `runStatus`/`taskListPending` passed bare `runId` but CLI expects full `runDir` path — added `resolveRunDir` helper
3. `commitEffectResult` called with `value: undefined` — now reads result.json from disk before committing

**Output:** `Hello, World! From babysitter + OpenCode.` (project scaffolded at `../test-babysitter/output/`)

### Current Validation Snapshot (2026-02-27)

- `npm run test:opencode-plugin` -> 82 tests passing (17 test files)
- `npm run build --workspace=@a5c-ai/babysitter-opencode` -> passing
- E2E babysitter run -> completed (3 iterations, 2 node tasks executed and committed)
- Branch sync -> `feat/opencode-plugin-migration` aligned with `origin/feat/opencode-plugin-migration`

**Total Estimated:** 17-25 days

---

## API Mapping

### Plugin Context

| Claude Code | OpenCode |
|-------------|----------|
| `plugin.json` manifest | `export const Plugin: Plugin` |
| `CLAUDE_PLUGIN_ROOT` | `ctx.directory` |
| `CLAUDE_SESSION_ID` | `context.sessionId` (in tool) |
| `CLAUDE_ENV_FILE` | N/A (use state Map) |

### Hooks

| Claude Code | OpenCode |
|-------------|----------|
| `SessionStart` | `event: session.created` |
| `Stop` (block + inject) | `event: session.idle` + `client.session.prompt()` |
| `PreToolUse` | `tool.execute.before` |
| `PostToolUse` | `tool.execute.after` |

### Tools

| Claude Code | OpenCode |
|-------------|----------|
| `AskUserQuestion` | Custom `babysitter_ask` tool |
| Built-in tools | Same (Read, Write, Bash, etc.) |

### Skills

| Claude Code | OpenCode |
|-------------|----------|
| `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` (same format) |
| Skill frontmatter | Same frontmatter format |
| Skill invocation | Same via Skill tool |

### Commands

| Claude Code | OpenCode |
|-------------|----------|
| `commands/<name>.md` | `commands/<name>.md` |
| `argument-hint` | N/A (use $ARGUMENTS in template) |
| `allowed-tools` | `agent` field (optional) |

### Shell Execution

| Claude Code | OpenCode |
|-------------|----------|
| Bash scripts | Node `child_process.spawn` |
| `#!/bin/bash` | Shell scripts executed via `spawn("bash", [scriptPath])` |

---

## Testing Strategy (actual — 82 tests, 17 files)

### Unit Tests
- State management: init, update, delete, JSON file persistence (`sessionState.test.ts`, `sessionState.persistence.test.ts`)
- Runaway detection algorithm (`runawayGuard.test.ts`)
- Idle loop evaluation (`idleLoop.test.ts`)
- CLI breakpoint client (`cliBreakpointClient.test.ts`)
- Interactive breakpoint handler (`interactiveBreakpointHandler.test.ts`)
- Quality convergence loop (`qualityConvergenceLoop.test.ts`)

### Integration Tests
- Tool execution — all 7 tools (`handlers.test.ts`)
- CLI adapter — run:status, task:list, task:post via SDK commitEffectResult (`babysitterCli.test.ts`)
- Hook dispatcher with shell scripts (`dispatcher.test.ts`)
- Tool lifecycle hooks (`toolLifecycleHooks.test.ts`)
- Ask-response coordinator (`askResponseCoordinator.test.ts`)
- Session runners (`sessionRunners.test.ts`)
- Plugin integration (`plugin.integration.test.ts`)

### End-to-End Tests
- Native orchestrator full loop — pending tasks → node execution → commit → iterate (`nativeOrchestrator.test.ts`)
- Runtime session loop (`runtime.test.ts`)
- Multi-iteration loop (`e2eLoop.test.ts`)
- **Real babysitter run** — hello-world process with scaffold + verify tasks, run to completion (`../test-babysitter/run-e2e.mjs`)

---

## Conclusion

The OpenCode plugin is implemented and E2E validated. Babysitter can now
drive OpenCode as its agent runtime using the same process definitions
that work with Claude Code.

**What was built:**
- `session.idle` + `client.session.prompt()` for in-session loop
- 7 custom tools matching the Claude Code plugin's tool surface
- Hook dispatcher with shell script execution (same discovery order)
- Native orchestrator executing node/agent/skill/breakpoint tasks
- Quality convergence loop with pluggable scoring
- Same SKILL.md and command format as Claude Code

**Validation:**
- 82 unit/integration tests passing across 17 test files
- E2E babysitter run completed (hello-world process, 2 node tasks, 3 iterations)
- SDK `commitEffectResult` used directly for reliable task result commits

**Remaining:**
- Live OpenCode session smoke validation (interactive breakpoints, ask-response, persistence across restarts)
- PR and merge

---

*OpenCode plugin — packages/opencode-plugin/ — v0.0.169*
