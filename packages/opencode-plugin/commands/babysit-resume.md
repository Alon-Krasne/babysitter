---
description: Resume an existing babysitter run
---

Load the `babysit` skill and resume run `$ARGUMENTS`.

Steps:
1. Use `babysitter_resume` with runId `$ARGUMENTS`.
2. Check status: `babysitter run:status .a5c/runs/$ARGUMENTS --json`
3. Continue the autonomous loop: `run:step` -> execute effects -> commit -> repeat.
4. Do NOT stop until the run reaches `completed` or `failed`.
