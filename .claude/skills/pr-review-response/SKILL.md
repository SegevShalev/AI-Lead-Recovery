---
name: pr-review-response
description: Workflow for responding to a human reviewer's feedback on an open PR in this repo (e.g. "check PR #3 for Segev's comments", "answer the review and fix it", "resolve Segev's feedback", or with no PR named — "fix the rejections on my PRs", "did anyone request changes on my stuff?"). Covers finding which of your PRs need this (when none is named), reading the review (inline threads + general comments), explaining each item in plain language before touching code, implementing fixes, committing/pushing, replying to each comment, and resolving addressed threads via gh CLI. This is the opposite direction of /code-review (which generates a review) — use this one when a review already exists and needs to be acted on. See review-assigned-prs for the reverse role — acting as the reviewer on someone else's PR.
---

# Skill: PR Review Response

## Use when

Someone (a human reviewer, or a bot) has already left feedback on a PR in this repo, and the task is to understand it and act on it — not to generate a new review. Trigger phrases: "check the PR comments", "Segev reviewed this", "answer/address the review", "fix what the reviewer flagged", "resolve the comments".

## Why this shape

Review feedback splits into two GitHub-API shapes that behave differently, and mixing them up is the easiest way to go wrong:

- **Inline review comments** — attached to a specific file+line in the diff. These live in _threads_ that can be marked resolved.
- **General/issue comments** (including the top-level body of a review) — not attached to a line. A reviewer ends up here when their concern is about a file the PR _doesn't_ touch, or when they're leaving overall commentary. **These have no "resolve" action in GitHub at all** — don't try to resolve them, just reply.

Getting this distinction right up front avoids the two failure modes that actually happened building this skill: trying to resolve something unresolvable, and posting a reply to the wrong endpoint.

## Step 1 — Find the review

If a PR is named, use it. If not, find which of the user's own open PRs actually need this — don't assume the current branch's PR is the only one waiting:

```bash
"$GH" pr list --author "@me" --json number,title,reviewDecision,url --jq '.[] | select(.reviewDecision=="CHANGES_REQUESTED")'
```

If more than one comes back, list them for the user rather than picking one — which to tackle (or whether to do all of them) is their call. If exactly one PR matches and it's also the current branch's PR, that's a reasonable default to proceed with, but say so explicitly rather than silently assuming it.

Once the PR is identified, pull three things:

**The review body and inline threads (with resolve state) — GraphQL, parameterized to avoid quoting issues:**

```bash
"$GH" api graphql -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 5) { nodes { databaseId path body } } } } } } }' \
  -f owner='OWNER' -f name='REPO' -F number=NUMBER
```

Note the two different IDs each thread carries: `id` is the GraphQL node ID (`PRRT_...`), needed later to resolve the thread. `comments.nodes[].databaseId` is the plain numeric REST comment ID, needed to reply to it. They are not interchangeable.

**General issue-level comments (where body-level review concerns end up):**

```bash
"$GH" api repos/OWNER/REPO/issues/NUMBER/comments
```

**The reviews list, for the top-level summary text and overall state (APPROVED / CHANGES_REQUESTED):**

```bash
"$GH" api repos/OWNER/REPO/pulls/NUMBER/reviews
```

## Step 2 — Explain before fixing

Walk through each distinct concern the reviewer raised (a thread, or a paragraph in a general comment) and explain it in plain language before writing any code: what the reviewer is pointing at, why it matters — trace the actual failure scenario if it's a bug, not just "this could be an issue" — and what they suggested. Get confirmation this lands before moving to implementation. Reviewers often bundle multiple distinct issues into one comment (a "solid overall, but here's one thing" style review) — split them out rather than treating the whole review as one lump.

If a reviewer's comment implies something should also change in project documentation (a checklist, an architecture doc) because the doc's claim is what made the bug worth flagging, catch that too — leaving a doc that describes the old, wrong behavior as correct is a loose end even after the code is fixed.

## Step 3 — Fix, verify, commit, push

Standard implementation loop: make the change, run whatever tests/typecheck/lint apply to the touched packages, then commit. Match the repo's existing commit style (check `git log` — this repo uses `type(scope): summary` subjects and a `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer). Create a new commit rather than amending, same as any other change. Pushing to the PR branch is what makes the reply-and-resolve step in Step 4 meaningful — a reply claiming something is fixed should point at a commit the reviewer can actually see, so push before replying.

## Step 4 — Reply to each comment

Match the reply to where the concern was raised:

- **Inline thread** → reply via the REST endpoint, using the thread's `databaseId` from Step 1:
  ```bash
  "$GH" api repos/OWNER/REPO/pulls/NUMBER/comments/COMMENT_ID/replies --input reply.json
  ```
- **General comment / body-level concern with no thread** → post a new issue comment:
  ```bash
  "$GH" api repos/OWNER/REPO/issues/NUMBER/comments --input reply.json
  ```

Each reply should name the commit that addressed it and briefly state what actually changed — enough that the reviewer can verify without re-reading the whole diff. See **Building request bodies reliably** below for how to build `reply.json` — do not use `-f body=@file`.

**Always read back what you posted** before moving on (`gh api .../comments/ID --jq '.body'`). A 200 response with an `id` only proves the POST succeeded, not that the body content is what you intended — this is exactly how a previous run of this workflow ended up posting a literal file path as a PR comment three times in a row without noticing.

## Step 5 — Resolve addressed inline threads

Only inline threads can be resolved, using the GraphQL node `id` from Step 1 (not the REST comment ID):

```bash
"$GH" api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }' -f id='THREAD_NODE_ID'
```

For a general comment with no thread, say so plainly rather than attempting a resolve — there's nothing to click there on GitHub's side either.

Verify by re-running the Step 1 query and checking `isResolved: true`.

---

## Environment notes for this machine

These are specific, hard-won gotchas — check whether they still apply if `gh --version` or the OS environment has changed, but they held as of this writing on this Windows setup:

- **`gh` is not on PATH** in either the Bash (git-bash) tool or the PowerShell tool here, even though it's installed. Call it by full path: `"C:\Program Files\GitHub CLI\gh.exe"`. Consider setting `GH="C:\Program Files\GitHub CLI\gh.exe"` once per session and reusing the variable.
- **Prefer Bash (git-bash) over PowerShell** for anything multi-line or involving `gh api graphql` with inline query text. PowerShell's argument re-quoting has mangled multi-line/hyphenated GraphQL query strings passed via `-f query='...'` (a literal repo name like `"AI-Lead-Recovery"` embedded in query text triggered a bogus GraphQL type error). Parameterizing the query (`-f owner=... -f name=... -F number=...` instead of inlining literal strings) sidesteps this regardless of shell, and is worth doing even from Bash.

### Building request bodies reliably

**Do not use `gh api ... -f field=@path\to\file`** expecting it to load the field's value from that file. On this environment it silently posts the _literal string_ `@path\to\file` as the value instead of reading the file — no error, just wrong data sent with a 200 response. This is exactly what caused the "why is there a raw file path as a PR comment" incident this skill exists to prevent a repeat of.

Instead, build the JSON payload explicitly and pass it as a file via `--input`:

```bash
node -e "
const fs = require('fs');
const body = fs.readFileSync('reply.txt', 'utf8');
fs.writeFileSync('reply.json', JSON.stringify({ body }));
"
"$GH" api repos/OWNER/REPO/issues/NUMBER/comments --input reply.json
```

This also works to _fix_ a comment posted wrong: `gh api -X PATCH repos/OWNER/REPO/issues/comments/COMMENT_ID --input reply.json` (or `pulls/comments/COMMENT_ID` for an inline one).

If running from git-bash and building the JSON with `node`, remember `node.exe` is a native Windows binary — a POSIX-style path like `/c/Users/...` gets mis-resolved. Convert it first: `WINPATH=$(cygpath -m "$POSIXPATH")`, then use `$WINPATH` (forward slashes are fine in Windows paths, so no further escaping is needed).
