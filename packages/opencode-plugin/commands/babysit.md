---
description: Start a babysitter orchestration run
---

Load the `babysit` skill and follow its instructions strictly.

User request: $ARGUMENTS

The babysitter CLI is at: `node /Users/alonkrasne/Documents/Projects/babysitter/packages/babysitter/bin/babysitter.js`

Start with:
1. Interview and clarify requirements.
2. Build or choose a process file.
3. Create the run with the babysitter CLI.
4. Run the autonomous loop: `run:step` -> execute effects -> commit -> repeat.
5. Do NOT stop until the run reaches `completed` or `failed`.
