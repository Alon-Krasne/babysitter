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
  - Dispatches `on-iteration-start`, `on-iteration-end`, `on-run-complete`, and `on-run-fail` lifecycle payloads.
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
- `enableHookDispatcher` (default: `true`)
- `pluginRoot`
- `userConfigDir`
- `skillRunner`
- `agentRunner`
