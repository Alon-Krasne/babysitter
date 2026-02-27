---
description: Start a babysitter orchestration run
---

Load the `babysit` skill and follow its instructions strictly.

User request: $ARGUMENTS

Start with:
1. Interview and clarify requirements using `babysitter_ask`.
2. Build or choose a process file in `.a5c/processes/`.
3. Use `babysitter_setup` to activate the loop.
4. Create the run with `babysitter run:create`.
5. Use `babysitter_associate` to link the run.
6. Run the autonomous loop: `run:step` -> execute effects -> commit -> repeat.
7. Do NOT stop until the run reaches `completed` or `failed`.
