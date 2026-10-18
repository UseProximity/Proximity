#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the web app (wired up via ignoreCommand in apps/web/vercel.json).
# Exit 0 skips the build, exit 1 runs it.
#
#   main, staging, sandbox: build only when the push changed the web app or its shared code.
#   any other branch:       build only when the latest commit message contains [preview].

REF="$VERCEL_GIT_COMMIT_REF"
MSG="$VERCEL_GIT_COMMIT_MESSAGE"

case "$REF" in
  main|staging|sandbox)
    cd "$(git rev-parse --show-toplevel)" || exit 1
    BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
    # If the base commit is missing from Vercel's shallow clone, build to be safe.
    git cat-file -e "$BASE^{commit}" 2>/dev/null || { echo "Base $BASE not available, building."; exit 1; }
    if git diff --quiet "$BASE" HEAD -- apps/web packages package.json package-lock.json; then
      echo "No web app changes on $REF since $BASE, skipping build."
      exit 0
    fi
    echo "Web app changed on $REF, building."
    exit 1
    ;;
  *)
    case "$MSG" in
      *"[preview]"*)
        echo "[preview] tag found on $REF, building."
        exit 1
        ;;
    esac
    echo "Branch $REF has no [preview] tag in the latest commit message, skipping build."
    exit 0
    ;;
esac
