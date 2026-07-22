#!/usr/bin/env bash
set -euo pipefail

draft="${1:-$(dirname "$0")/application-draft.md}"

awk '
  /<!-- BEGIN answer-/ {
    id = $3
    sub(/^answer-/, "", id)
    limit = $4
    sub(/^limit=/, "", limit)
    count = 0
    active = 1
    next
  }
  /<!-- END answer-/ {
    status = count <= (limit + 0) ? "OK" : "OVER"
    printf "answer-%s: %d/%d %s\n", id, count, limit, status
    if (count > (limit + 0)) failed = 1
    active = 0
    next
  }
  active {
    for (i = 1; i <= NF; i++) count++
  }
  END { exit failed }
' "$draft"
