Implement a single ClickUp task end to end, then self-review and open a PR. Task: $ARGUMENTS

This is the per-ticket worker for autonomous coding. Autonomy boundary:
**implement → verify → self-review → open PR → hand off. NEVER merge, never push to `develop`/`main`.**

## 0. Load the ClickUp MCP tools — use the LOCAL `clickup` server

Use the **local `clickup` MCP server**; its tools are prefixed `mcp__clickup__`
(get task / update task / add comment / search tasks). Run `ToolSearch` with query
`clickup` if they aren't loaded yet, and **always prefer the `mcp__clickup__*`
tools over the `claude_ai_ClickUp` account connector** — the local server is the
only one reliable in headless/`/loop` runs. If `mcp__clickup__*` tools are
unavailable, **stop** and report that the local ClickUp server isn't loaded
(restart the session / check `claude mcp list`). Do not fall back to the connector
and do not guess task contents.

## 1. Fetch & claim the task

- Resolve `$ARGUMENTS` to a ClickUp task id (accept an id or a task URL).
- Fetch the task: title, description, acceptance criteria, and existing comments.
- Restate the requirement in 1–3 lines. If acceptance criteria are missing or
  ambiguous, **do not invent scope** — add a ClickUp comment asking for
  clarification, leave status unchanged, and stop.
- Move the task status → **In Progress** (or the project's equivalent).

## 2. Branch

- Ensure a clean tree (`git status`). Start from up-to-date `develop`.
- Determine the change **type** from the task: new functionality → `feature`,
  bug fix → `fix`, maintenance/config/deps/tooling → `chore` (also `refactor`,
  `docs`, `hotfix` when they clearly apply). Match the repo convention — the full
  word `feature` (not `feat`), `fix`, `chore`.
- Create the branch `<type>/<taskId>-<short-slug>`
  (e.g. `feature/86d3bpfzy-admin-custom-group-actions`, `fix/<taskId>-<slug>`).
  Never commit on `develop`/`main`.

## 3. Plan → implement

- Read the relevant context first: `.claude/context/architecture.md`,
  `coding-standards.md`, and whichever of `auth.md` / `database.md` /
  `security.md` the task touches.
- For non-trivial work, get a plan from the `architect` agent and follow it.
- Implement using existing patterns (`withAuth`, `apiClient`, `withCache` + key
  builders, `src/lib/ghl/`, migrations for schema). Mirror the nearest analogous
  feature. Update `src/types/index.ts` alongside any schema change.
- Add/extend tests in `src/__tests__/` for new `src/lib/` logic (mock external
  services).

## 4. Verify (gate — must pass before a PR)

Run all three and capture output:

```bash
npm run lint
npm test
npm run build
```

If any fail and you can't fix them cleanly: commit nothing to a PR, add a ClickUp
comment with the failing output, move the task → **Blocked**, and stop.

## 5. Self-review (this is the "PR + self-review" mode)

- Run the `reviewer` agent and the `security` agent on the diff
  (`git diff develop...HEAD`). Use `supabase` if migrations/RLS changed and
  `performance` if hot paths changed.
- Fix any **Blocker / Critical / High** findings, then re-run the verify gate.
- Keep a short summary of the findings and how each was resolved.

## 6. Commit, push, open PR (no merge)

- Commit with a message prefixed by the **same type as the branch**
  (`feature: …`, `fix: …`, `chore: …`) and referencing the task; end with the
  Co-Authored-By trailer per the repo convention.
- Push the branch and open a PR with `gh pr create` **--base develop** (edit if the
  team targets a different base). PR body: what changed, how it was verified
  (lint/test/build results), the self-review summary, and `Closes/Refs <ClickUp link>`.
- **Do not merge.** Leave it for human review.

## 7. Hand off on ClickUp

- Add a ClickUp comment with the PR URL + a one-line summary and the self-review
  outcome.
- Move the task status → **In Review** (or equivalent).

## Output

Report: task id/title, branch, PR URL, verify results, self-review findings &
resolutions, and final ClickUp status. If you stopped early (ambiguous scope or
failing gate), say exactly why and what you left on the task.
