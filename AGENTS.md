# Agent Rules: Proximity

Rules for any AI coding agent working in this repo (Cursor, Codex, Copilot, Windsurf, Claude Code and others). Claude Code also reads `CLAUDE.md`, which holds the full project guide.

## Vercel builds and pushing

Build minutes are our biggest Vercel cost, so builds are filtered by `scripts/vercel-ignore-build.sh` (the `ignoreCommand` in `apps/web/vercel.json`):

- `main`, `staging` and `sandbox` build only when `apps/web/`, `packages/` or the root `package.json` / `package-lock.json` changed.
- Every other branch builds only when the **latest pushed commit message contains `[preview]`**.

When you work:

- Commit locally as often as you like, but push once when the work is ready to test, not after every commit.
- Never push just to back up work.
- Add `[preview]` only when a shareable preview URL is wanted, and put it on the last commit of the push, since only that message is checked.
