# @a5c-ai/babysitter-opencode

OpenCode adapter plugin for Babysitter orchestration workflows.

## What this package provides

- Session loop runtime for `session.idle` continuation.
- Native iteration-start orchestrator parity:
  - Auto-executes pending `node` tasks and posts results via `task:post`.
  - Supports optional CLI-based breakpoint processing (`breakpoints breakpoint create/wait`).
  - Detects `sleep` waiting states.
  - Surfaces `skill` and `agent` pending task instructions back into continuation prompts.
- Custom tools:
  - `babysitter_setup`
  - `babysitter_resume`
  - `babysitter_associate`
  - `babysitter_status`
  - `babysitter_stop`
- Skill and command templates for OpenCode.

## Development

```bash
npm run test --workspace=@a5c-ai/babysitter-opencode
npm run build --workspace=@a5c-ai/babysitter-opencode
```

## Plugin options

`createBabysitterPlugin()` supports:

- `cliCommand` (default: `babysitter`)
- `breakpointCommand` (default: `breakpoints`)
- `enableBreakpointCli` (default: `true`)
- `breakpointPollIntervalSeconds`
