---
description: Resume an existing babysitter run
---

Invoke the `babysit` skill and resume run `$ARGUMENTS`.

Steps:
1. Use `babysitter_resume` with run id `$ARGUMENTS`.
2. Confirm state with `babysitter_status` and `babysitter run:status`.
3. Continue orchestration loop until completion.
