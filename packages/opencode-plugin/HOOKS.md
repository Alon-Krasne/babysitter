# Hook Dispatcher

The OpenCode adapter supports shell hook discovery and execution.

Discovery order for `<hook-name>`:

1. `.a5c/hooks/<hook-name>/`
2. `~/.config/babysitter/hooks/<hook-name>/`
3. `<pluginRoot>/hooks/<hook-name>/` (if configured)

All `*.sh` files are executed in lexical order and receive JSON payload on stdin.
Hook failures are recorded but do not abort orchestration.

## Hook names currently dispatched

- `pre-branch`
- `pre-commit`
- `post-planning`
- `on-iteration-start`
- `on-iteration-end`
- `on-run-start`
- `on-run-complete`
- `on-run-fail`
- `on-score`
- `on-step-dispatch`
- `on-breakpoint`
- `on-task-start`
- `on-task-complete`
- `on-task-fail`

## Payload shape (common fields)

```json
{
  "runId": "run-...",
  "sessionId": "session-...",
  "iteration": 3,
  "timestamp": "2026-02-26T23:11:00.000Z"
}
```

Task hooks add:

```json
{
  "effectId": "effect-...",
  "kind": "node|skill|agent|breakpoint",
  "status": "ok|error|null",
  "message": "optional detail"
}
```
