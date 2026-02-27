# Babysitter Plugin Adaptation Plan: Claude Code → OpenCode

**Version:** 3.0
**Date:** 2026-02-02

---

## Executive Summary

This document details the comprehensive plan for adapting the **babysitter** plugin from Claude Code to OpenCode.

**Key Findings:**
- **Total Components:** 25+ core features across hooks, scripts, skills, commands
- **Core Mechanism:** Stop hook → `session.idle` + `client.session.prompt()`
- **Skills/Commands:** OpenCode supports both skills (SKILL.md) and commands, similar to Claude Code

The SDK CLI (`@a5c-ai/babysitter-sdk`) works identically in both environments.

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

**Solution:** Implement hook dispatcher in TypeScript, support shell scripts via Bun.

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

- Logging hooks → Use `client.app.log()`
- State file persistence → Implement YAML frontmatter in TypeScript
- Transcript access → Track via `tool.execute.after`
- Shell script conversion → Use Bun `$` shell API

---

## Plugin Structure Design

### Directory Layout

```
@a5c-ai/babysitter-opencode/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── hooks/
│   │   ├── dispatcher.ts           # Hook discovery & execution
│   │   ├── session.ts              # session.created, session.deleted
│   │   ├── idle.ts                 # session.idle (in-session loop)
│   │   ├── tools.ts                # tool.execute.after
│   │   ├── on-iteration-start.ts   # Native orchestrator
│   │   ├── on-iteration-end.ts     # Finalization
│   │   ├── on-breakpoint.ts        # Breakpoint handler
│   │   └── lifecycle.ts            # run/task lifecycle hooks
│   ├── state/
│   │   ├── session-state.ts        # In-memory state Map
│   │   └── file-state.ts           # YAML frontmatter persistence
│   ├── tools/
│   │   ├── setup.ts                # babysitter_setup
│   │   ├── iterate.ts              # babysitter_iterate
│   │   ├── task-post.ts            # babysitter_task_post
│   │   ├── status.ts               # babysitter_status
│   │   ├── stop.ts                 # babysitter_stop
│   │   ├── ask-user.ts             # babysitter_ask (AskUserQuestion)
│   │   └── score.ts                # babysitter_score
│   ├── tasks/
│   │   ├── node.ts                 # Node/script execution
│   │   ├── agent.ts                # Agent task execution
│   │   ├── skill.ts                # Skill invocation
│   │   └── parallel.ts             # Parallel batching
│   └── utils/
│       ├── cli.ts                  # SDK CLI wrappers (Bun $)
│       ├── frontmatter.ts          # YAML parsing
│       └── prompt-builder.ts       # Continuation prompt builder
├── hooks/                          # Configurable hook scripts
│   ├── on-iteration-start/
│   ├── on-iteration-end/
│   ├── on-breakpoint/
│   └── ...
├── skills/
│   ├── babysit/
│   │   └── SKILL.md                # Main orchestration skill
│   └── babysitter-score/
│       └── SKILL.md                # Scoring skill
├── commands/
│   ├── babysit.md                  # /babysit command
│   └── babysit-resume.md           # /babysit-resume command
└── docs/
    ├── README.md
    └── HOOKS.md
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

**Discovery Order:**
1. `.opencode/hooks/<hook-name>/` (per-repo)
2. `~/.config/opencode/hooks/<hook-name>/` (per-user)
3. Plugin `hooks/<hook-name>/` (built-in)

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
- Call `task:post` to commit results

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
- [x] SDK CLI wrappers (implemented via Node child process executor)
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
| Bash scripts | Bun `$` shell API |
| `#!/bin/bash` | `import { $ } from "bun"` |

---

## Testing Strategy

### Unit Tests
- State management (init, update, delete, persist)
- YAML frontmatter parsing/serialization
- Runaway detection algorithm
- Prompt builder functions
- Hook discovery

### Integration Tests
- Tool execution (all tools)
- Idle hook continuation
- SDK CLI command execution
- Hook dispatcher with shell scripts
- Skill invocation

### End-to-End Tests

1. **Full Orchestration Loop**
   - `/babysit` → interview → create run → iterate → complete

2. **Resume Flow**
   - `/babysit-resume <runId>` → continue → complete

3. **Quality Convergence**
   - Agent scoring → threshold check → improve → repeat

4. **Breakpoint Approval**
   - Trigger breakpoint → user interaction → continue

---

## Conclusion

The babysitter plugin adaptation to OpenCode is feasible using:
- `session.idle` + `client.session.prompt()` for in-session loop
- Same SKILL.md format for skills
- OpenCode command format for slash commands

**Key Success Factors:**
1. Verify idle hook timing matches expected behavior
2. Implement robust hook dispatcher for extensibility
3. Port skills with minimal changes
4. Create intuitive slash commands

**Estimated Effort:** 17-25 days across 7 phases

**Recommended Approach:**
1. Start with Phase 1-2 to validate core mechanism and skills
2. Add interview/setup (Phase 3) for full workflow
3. Implement hook system (Phase 4) for extensibility
4. Add advanced features incrementally

---

*Generated by Babysitter Orchestration Process - v3.0*
