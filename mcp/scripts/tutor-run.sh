#!/bin/zsh
# Scheduled runner for the Product Tutor loop (see .claude/skills/proximity-tutor).
# Installed via launchd (com.proximity.tutor.plist) — launchd runs missed jobs
# after wake, unlike cron, so a closed laptop only delays a run.
#
# The run is headless (`claude -p`), where claude.ai connectors (Slack MCP) may
# be unavailable — the skill falls back to the TUTOR_SLACK_WEBHOOK_URL env var
# for delivery. The tutor can only write a local branch, a product_lessons row,
# and a Slack message; accepting/shipping always stays with Ben.

set -euo pipefail

# Local secrets (TUTOR_SLACK_WEBHOOK_URL) live outside the repo, never in git.
[ -f "$HOME/.proximity-tutor.env" ] && source "$HOME/.proximity-tutor.env"

REPO="${TUTOR_REPO:-$HOME/Proximity Repo UI updates/Proximity}"
LOG_DIR="$HOME/Library/Logs/proximity-tutor"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log"

cd "$REPO"

# launchd's PATH is minimal; find claude wherever it's installed.
export PATH="$HOME/.claude/local:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v claude >/dev/null || { echo "claude binary not found" >> "$LOG"; exit 1; }

# TUTOR_SMOKE=1 verifies the launchd plumbing (env sourcing, repo, logging)
# without invoking a real headless run.
if [ "${TUTOR_SMOKE:-0}" = "1" ]; then
  echo "smoke ok: repo=$REPO webhook_set=$([ -n "${TUTOR_SLACK_WEBHOOK_URL:-}" ] && echo yes || echo no) claude=$(command -v claude)" >> "$LOG"
  exit 0
fi

# --permission-mode acceptEdits: file edits and the pre-approved MCP/Bash tools
# run unattended; anything outside the allowlist still fails closed rather than
# waiting forever on a prompt nobody will answer.
claude -p "Run the proximity-tutor skill (scheduled run). If the latest run's findings are still unanswered, send the nudge and stop." \
  --permission-mode acceptEdits \
  >> "$LOG" 2>&1

echo "tutor run finished $(date)" >> "$LOG"
