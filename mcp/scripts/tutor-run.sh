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

REPO="${TUTOR_REPO:-$HOME/Proximity Repo UI updates/Proximity}"
LOG_DIR="$HOME/Library/Logs/proximity-tutor"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log"

cd "$REPO"

# --permission-mode acceptEdits: file edits and the pre-approved MCP/Bash tools
# run unattended; anything outside the allowlist still fails closed rather than
# waiting forever on a prompt nobody will answer.
claude -p "Run the proximity-tutor skill (scheduled run). If the latest run's findings are still unanswered, send the nudge and stop." \
  --permission-mode acceptEdits \
  >> "$LOG" 2>&1

echo "tutor run finished $(date)" >> "$LOG"
