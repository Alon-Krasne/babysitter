---
description: Inspect status of active babysitter session and run
---

Check babysitter status for run `$ARGUMENTS`.

1. Use `babysitter_status`.
2. If run id is provided, run:

```bash
babysitter run:status "$ARGUMENTS" --json
```

Report current state, pending effects by kind, and whether loop is active.
