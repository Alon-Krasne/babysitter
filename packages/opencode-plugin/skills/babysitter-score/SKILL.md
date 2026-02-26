---
name: babysitter-score
description: Score implementation quality and convergence readiness.
allowed-tools: Read, Grep, Bash
version: 0.1.0
---

# babysitter-score

Score a result from 0-100 using explicit criteria:

1. Correctness against user request
2. Test/build validation quality
3. Code quality and maintainability
4. Scope control (no missing required work, no unnecessary expansion)

Return JSON only:

```json
{
  "score": 0,
  "verdict": "insufficient|acceptable|excellent",
  "issues": ["..."],
  "recommendations": ["..."]
}
```
