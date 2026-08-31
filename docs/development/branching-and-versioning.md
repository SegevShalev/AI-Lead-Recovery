# Branching & Versioning

How the two of us use git on this project. Small team, learning-oriented, no
release pressure — so this stays simple and we tighten it only when it
actually hurts us.

## Branches

Three kinds of branch exist:

- **`main`** — always deployable. Nothing is committed to `main` directly;
  it only moves forward via a merge from `dev`.
- **`dev`** — the integration branch. Both of us branch from `dev` and merge
  back into `dev`. This is where features meet each other before they're
  considered stable.
- **feature branches** — one per unit of work, branched from `dev`, merged
  back into `dev` via PR, then deleted.

```
main   ──●───────────────────●──────────────►  (releases only)
          \                 /
dev    ────●───●───●───●───●──────────────►  (integration)
             \     \   \
feature/x     ●──●  \   \
feature/y          ●─●   \
feature/z              ●──●
```

### Naming

`<type>/<short-description>`, kebab-case, no ticket numbers unless we start
using a tracker:

| Type       | Use for                                    |
| ---------- | ------------------------------------------ |
| `feature/` | new functionality                          |
| `fix/`     | bug fixes                                  |
| `chore/`   | tooling, deps, CI, config                  |
| `docs/`    | documentation only                         |
| `spike/`   | throwaway exploration — never merged as-is |

Examples: `feature/dashboard-ui-fake-data`, `fix/port-env-validation`,
`chore/upgrade-vite`.

### Workflow

1. `git checkout dev && git pull`
2. `git checkout -b feature/<name>`
3. Commit as you go (see below).
4. Push and open a PR **into `dev`**, not `main`.
5. The other person reviews (or self-review is fine for solo throwaway
   work like docs/spikes — use judgment).
6. Merge with a normal merge commit (not squash) so the branch's commit
   history stays visible — small commits are more useful here than a
   flattened history, since this is a learning project.
7. Delete the feature branch after merge.

### Releasing (`dev` → `main`)

When `dev` is in a state worth shipping or demoing:

1. Open a PR from `dev` into `main`.
2. Confirm CI is green and the app actually runs (see [local-development.md](local-development.md)).
3. Merge into `main`.
4. Tag the resulting commit (see Versioning below).

There's no fixed release cadence. We cut a release when there's something
real to show, not on a schedule.

### Hotfixes

If something on `main` is broken and can't wait for the normal `dev` cycle:
branch `fix/<name>` from `main`, fix it, PR into `main`, then immediately
merge `main` back into `dev` so `dev` doesn't drift.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), so history and
(eventually) changelogs stay readable:

```
<type>(<scope>): <summary>

[optional body — the "why", not the "what"]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.
Scope is optional — a package/service name when it helps (`feat(web): ...`,
`fix(api): ...`).

Keep commits small and focused. A commit should represent one coherent
change, not "end of day checkpoint."

## Versioning

Each deployable unit (`apps/web`, `services/api`, `services/recovery-worker`,
`services/ai-service`) has its own `version` in its `package.json` and moves
independently — this is a multi-service repo, not a single-version product.

We follow [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`) once a service
has a real consumer (another service, or a deployed frontend) depending on
its contract:

- **MAJOR** — breaking API/event contract change.
- **MINOR** — backward-compatible feature addition.
- **PATCH** — backward-compatible bug fix.

Pre-1.0 (`0.x.y`), anything can change and that's expected — everything in
this repo currently starts at `0.0.0`/`0.1.0` and stays in `0.x` until the
service has an actual external consumer worth protecting with SemVer
guarantees.

### Tags

When we merge `dev` into `main` for a release, tag the merge commit:

```bash
git tag -a v0.1.0 -m "short description of what shipped"
git push origin v0.1.0
```

Tag the whole repo state (not per-service) until services are deployed
independently enough that per-service tags (`api-v0.3.0`) earn their keep.

## What this doc doesn't cover yet

- CI enforcement of branch protection on `main`/`dev` (add once the repo
  has a remote both of us push to regularly).
- Automated changelog generation from Conventional Commits.
- Per-service tagging, once services deploy independently via CDK.

Revisit this doc when any of those become real friction, not before.
