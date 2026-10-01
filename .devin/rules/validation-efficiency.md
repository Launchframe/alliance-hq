---
description: Efficient, cache-preserving local validation and tip-only stacked PR gates
trigger: always_on
---

# Validation efficiency

Read and follow [PRE_COMMIT_GATE.md](../../PRE_COMMIT_GATE.md) before planning validation, installing dependencies, repairing build artifacts, or updating PRs. It is the canonical policy for Devin and Cursor and overrides older per-PR full-gate instructions in global skills.

- Normal hooks per commit; focused regressions on each owning branch; one full gate at the final stack tip after parent fixes propagate.
- The guarded Playwright build satisfies the build gate. Do not build twice for unchanged content.
- Preserve `.next`, `.next-e2e`, `node_modules`, package/browser/model caches, and owned in-flight work. Destructive cleanup requires a specific diagnosis and approval.
- Use the default parallel browser project plus ordered exclusive projects; never disable their dependency isolation for a full gate.
- Report exact revision coverage, commands, durations, workers, skips/retries, and pending validation honestly. Do not bypass hooks, privacy/security boundaries, human approvals, or workspace ownership.
