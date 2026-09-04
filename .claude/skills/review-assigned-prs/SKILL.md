---
name: review-assigned-prs
description: Workflow for acting as the reviewer on PRs where the user is requested as a reviewer (e.g. "check what I need to review", "any PRs waiting on me?", "review PR #7", "did Erez fix what I asked for?"). Reads the diff, decides between approve/request-changes/comment, explains the findings and verdict before posting anything, and on a later pass re-checks whether previously flagged issues were actually fixed. This is the reviewer-side counterpart to pr-review-response (which handles feedback *received* on your own PRs) — use this one when the user is the one doing the reviewing.
---

# Skill: Review Assigned PRs

## Use when

The user wants to act as a code reviewer on someone else's PR — either a specific PR they name, or "what's waiting on me to review" with no PR named. Also covers coming back to a PR they already left "changes requested" on, to check whether the fixes landed.

## Why "always confirm before posting"

Posting a GitHub review — especially clicking Approve — is an endorsement made under the user's real GitHub identity, visible to the whole team, and not something to take back casually. Unlike fixing your own code, this skill never posts a review without showing the user the draft (findings + proposed verdict) first and getting a go-ahead. Draft and decide freely; only the actual `gh api ... reviews` POST needs the pause.

## Step 1 — Find the target PR(s)

If the user names a PR, use that directly. Otherwise, find what's actually waiting on them:

```bash
# PRs in the current repo requesting the user's review, not yet reviewed by them
"$GH" pr list --search "review-requested:@me" --json number,title,url,updatedAt

# Across all repos (only if the user wants the wider sweep)
"$GH" search prs --review-requested=@me --state=open --json number,title,repository,url
```

Separately, check for PRs the user previously reviewed with "changes requested" — these need a *recheck* pass rather than a first review:

```bash
"$GH" pr list --json number,title,reviewDecision --jq '.[] | select(.reviewDecision=="CHANGES_REQUESTED")'
```

Cross-reference against `gh api repos/OWNER/REPO/pulls/NUMBER/reviews` to confirm the most recent review with `state: CHANGES_REQUESTED` was authored by the user (not someone else) — only those are "waiting on a recheck from you."

## Step 2 — Fresh review

Pull the diff and description:

```bash
"$GH" pr diff NUMBER
"$GH" pr view NUMBER --json title,body,commits
```

Read for actual correctness bugs first — trace concrete failure scenarios (specific input/state → wrong output/crash), not vague code-smell. Then note reuse/simplification/efficiency opportunities, same bar as this project's own `/code-review` skill, but remember the output here is different: this skill produces something to *post*, not just a report.

Sort findings into:
- **Blocking** (real bugs, correctness issues) → verdict will be Request Changes.
- **Non-blocking** (style, minor efficiency, nice-to-haves) → verdict can still be Approve, noted as suggestions.

If nothing blocking turns up, the verdict is Approve, optionally with non-blocking comments attached.

## Step 3 — Recheck pass (PR already has your "changes requested")

Fetch your own prior review's comments (`gh api repos/OWNER/REPO/pulls/NUMBER/comments` filtered to comments you authored, or the review body from Step 1's reviews list) and the commits pushed since that review (`gh pr view NUMBER --json commits`, filter by date after your review). For each previously flagged issue, check specifically whether the new commits actually address it — not just "did anything change nearby." Explain to the user, issue by issue: what was fixed and whether the fix is actually correct, or still incomplete/wrong. If everything checks out, the verdict becomes Approve; if something's still off, it stays Request Changes with updated comments on what's still missing.

## Step 4 — Explain, then confirm

Before posting anything: tell the user what you found (in plain language — the failure scenario for each blocking issue, not just a label), and state the proposed verdict (Approve / Request Changes / Comment) with the draft comment text. Wait for a clear go-ahead. This applies on both the fresh-review and recheck paths.

## Step 5 — Post the review

A single review with a verdict and inline comments is one API call — build the payload as a file, same reasoning as in `pr-review-response` (don't hand-roll multiline JSON on the command line, and never use `-f field=@file` — see that skill's environment notes for why):

```bash
node -e "
const fs = require('fs');
fs.writeFileSync('review.json', JSON.stringify({
  commit_id: 'HEAD_SHA_OF_THE_PR_BRANCH',
  body: 'Overall summary text.',
  event: 'APPROVE', // or 'REQUEST_CHANGES' or 'COMMENT'
  comments: [
    { path: 'path/to/file.ts', line: 42, body: 'Inline comment text.' }
  ]
}));
"
"$GH" api repos/OWNER/REPO/pulls/NUMBER/reviews --input review.json
```

Get `commit_id` from `gh pr view NUMBER --json headRefOid --jq .headRefOid` — the review must be anchored to the exact commit being reviewed.

Read the posted review back (`gh api repos/OWNER/REPO/pulls/NUMBER/reviews --jq '.[-1]'`) to confirm the verdict and comment count match what was intended, for the same reason `pr-review-response` insists on reading back replies: a 200 response only proves the POST landed, not that its content is right.

## Environment notes

Same gh-CLI environment gotchas as `pr-review-response` apply here (full path to `gh.exe`, prefer Bash over PowerShell for multi-line/`graphql` calls, build JSON via file + `--input` rather than `-f field=@file`). See that skill's "Environment notes" section rather than duplicating it here.
