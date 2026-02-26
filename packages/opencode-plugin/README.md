# @a5c-ai/babysitter-opencode

OpenCode adapter plugin for Babysitter orchestration workflows.

## What this package provides

- Session loop runtime for `session.idle` continuation.
- Native iteration-start orchestrator parity:
  - Auto-executes pending `node` tasks and posts results via `task:post`.
  - Supports optional CLI-based breakpoint processing (`breakpoints breakpoint create/wait`).
  - Detects `sleep` waiting states.
  - Surfaces `skill` and `agent` pending task instructions back into continuation prompts.
- Hook dispatcher parity:
  - Discovers and executes shell hooks from `.a5c/hooks/<hook>`, `~/.config/babysitter/hooks/<hook>`, and package hooks.
  - Dispatches `pre-branch`, `pre-commit`, `post-planning`, `on-run-start`, `on-iteration-start`, `on-step-dispatch`, `on-breakpoint`, `on-iteration-end`, `on-score`, `on-run-complete`, and `on-run-fail` lifecycle payloads.
- Custom tools:
  - `babysitter_setup`
  - `babysitter_resume`
  - `babysitter_associate`
  - `babysitter_status`
  - `babysitter_stop`
  - `babysitter_ask`
  - `babysitter_score`
- Skill and command templates for OpenCode.

## Development

```bash
npm run test --workspace=@a5c-ai/babysitter-opencode
npm run build --workspace=@a5c-ai/babysitter-opencode
```

See `HOOKS.md` for hook payloads and discovery order.

## Plugin options

`createBabysitterPlugin()` supports:

- `cliCommand` (default: `babysitter`)
- `breakpointCommand` (default: `breakpoints`)
- `enableBreakpointCli` (default: `true`)
- `breakpointPollIntervalSeconds`
- `maxParallelTasks` (default: `3`)
- `enableHookDispatcher` (default: `true`)
- `pluginRoot`
- `userConfigDir`
- `skillRunner`
- `agentRunner`

## Custom runners

By default, the plugin creates session-based runners that execute delegated skill/agent tasks through `client.session.prompt()` with structured JSON output.

`skillRunner` and `agentRunner` let you execute delegated effects and return structured results.

Each runner receives input/output refs and parsed input payload, then must return:

- `{ status: "ok", value: <json> }` to post success
- `{ status: "error", error: <json> }` to post failure

See exported types in `src/index.ts`:

- `DelegatedTaskInput`
- `DelegatedTaskResult`
- `SkillRunner`
- `AgentRunner`
