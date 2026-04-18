#!/bin/bash
# Usage: ./scripts/start-issue.sh <issue-number>
# Creates a branch linked to a GitHub issue and checks it out.
#
# Examples:
#   ./scripts/start-issue.sh 21        # uses gh's auto-generated branch name
#   ./scripts/start-issue.sh 21 fix    # creates fix/21-<issue-title-slug>

set -e

ISSUE_NUMBER=$1
PREFIX=${2:-""}

if [ -z "$ISSUE_NUMBER" ]; then
  echo "Usage: $0 <issue-number> [branch-prefix]"
  echo "  branch-prefix: feat, fix, refactor, etc. (optional)"
  exit 1
fi

# Fetch issue title to build branch name
ISSUE_TITLE=$(gh issue view "$ISSUE_NUMBER" --json title --jq '.title' 2>/dev/null)
if [ -z "$ISSUE_TITLE" ]; then
  echo "Could not fetch issue #$ISSUE_NUMBER"
  exit 1
fi

# Slugify the title: lowercase, replace spaces/special chars with hyphens, trim
SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//' | cut -c1-40)

if [ -n "$PREFIX" ]; then
  BRANCH_NAME="${PREFIX}/${ISSUE_NUMBER}-${SLUG}"
else
  BRANCH_NAME="${ISSUE_NUMBER}-${SLUG}"
fi

echo "Creating branch: $BRANCH_NAME"

# Make sure we're up to date
git fetch origin main --quiet
git checkout main --quiet
git rebase origin/main --quiet

# Create the branch linked to the issue and check it out
gh issue develop "$ISSUE_NUMBER" --name "$BRANCH_NAME" --base main --checkout

echo ""
echo "Ready to work on issue #$ISSUE_NUMBER: $ISSUE_TITLE"
echo "Branch: $BRANCH_NAME"
echo ""
echo "When done, run:"
echo "  git push -u origin $BRANCH_NAME"
echo "  gh pr create --fill"
