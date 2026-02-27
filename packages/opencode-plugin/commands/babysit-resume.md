---
description: Resume an existing babysitter run
---

Load the `babysit` skill and resume run `$ARGUMENTS`.

The babysitter CLI is at: `node /Users/alonkrasne/Documents/Projects/babysitter/packages/babysitter/bin/babysitter.js`

Steps:
1. Check status: `$BABYSITTER run:status .a5c/runs/$ARGUMENTS --json`
2. Continue the autonomous loop: `run:step` -> execute effects -> commit -> repeat.
3. Do NOT stop until the run reaches `completed` or `failed`.
