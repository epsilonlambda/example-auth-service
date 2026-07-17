# Working conventions

## Comments

Comment only what the code cannot say: invariants, security rationale, data
provenance, standards citations, deliberate deviations. Never narrate what a
line does, restate a name, or explain idiomatic patterns. When in doubt, omit
the comment.

## Async

Use `async`/`await`. Do not chain `.then()`/`.finally()` when an async
function expresses the same flow.
