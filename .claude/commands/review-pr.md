Review the pending changes on the current branch (or the PR / diff referenced by: $ARGUMENTS).

## Objective

Verify the change is correct, consistent with existing patterns, and safe — using
the project's own conventions as the bar. Do not invent new standards.

## Step 1 — Classify the diff

Get the diff first (`git diff main...HEAD` or the referenced PR). Label it **SIMPLE** or **COMPLEX**:

**SIMPLE** — all of the following must be true:
- Only UI text, copy, labels, or minor styling changes
- No `src/lib/` logic, no API routes, no migrations, no auth/security files touched
- ≤ 3 files changed, all in `src/app/` (pages/components only)

**COMPLEX** — any of the following:
- New or modified API routes, `src/lib/` logic, migrations, or auth/security files
- > 3 files changed, or changes cross multiple layers

## Step 2 — Load context (COMPLEX only)

If COMPLEX, read the relevant project context so the review reflects how this
codebase actually works:

- `.claude/context/coding-standards.md`
- `.claude/context/architecture.md`
- `.claude/context/auth.md`
- `.claude/context/database.md`
- `.claude/context/security.md`
- `.claude/context/testing.md`

Read the changed files in full, plus their immediate callers/callees.

If SIMPLE, skip context docs — just review the diff directly.

## Step 3 — Review checklist

### Auth & authorization (skip if SIMPLE)
- [ ] Authenticated API routes use `withAuth()` / `withAdminAuth()` — not hand-rolled checks.
- [ ] Admin routes use `requireAdmin`; new admin paths reflected in `ADMIN_ROUTES`.
- [ ] New public paths added to `PUBLIC_ROUTES` in `src/middleware.ts`.
- [ ] `createAdminClient()` is server-side only and behind an auth/webhook/cron gate.
- [ ] GHL validation stays fail-secure with positive-cache / negative-recheck asymmetry.

### Data & RLS (skip if SIMPLE)
- [ ] New tables/columns ship as a migration in `supabase/migrations/`; RLS enabled with community/ownership policies.
- [ ] Message privacy preserved (no `is_admin()` read on `messages`); `invite_tokens`/`play_history` writes stay server-side.
- [ ] Correct Supabase client for the context; client components fetch via `apiClient`.

### Security (skip if SIMPLE)
- [ ] Input validated via `src/lib/validation.ts`; user content escaped with `sanitiseText()`.
- [ ] Webhook/cron secrets verified before doing work; no secret exposed to client.
- [ ] PATCH handlers whitelist updatable fields.
- [ ] Appropriate rate limiter applied; client errors stay generic; security events `auditLog()`-ged.

### Structure & style (always check)
- [ ] Route order: validate → authenticate → authorize → execute → return; `dynamic = 'force-dynamic'` where needed.
- [ ] Typed error hierarchy used; cache via `withCache` + key builders; GHL/push via their lib modules.
- [ ] No `any`; type-only imports; naming, `@/` imports, and `'use client'` usage match conventions.
- [ ] Caching invalidated on mutation.

### Tests & gates (always check)
- [ ] `npm run lint`, `npm test`, `npm run build` pass.
- [ ] New `src/lib/` logic (esp. auth/cache/error/security invariants) has a `src/__tests__/*.test.ts`.

## Step 4 — Agent delegation (COMPLEX only)

For complex or multi-file changes, delegate dimensions to subagents and synthesize:
- `reviewer` — correctness and pattern consistency
- `security` — auth, secrets, input validation
- `supabase` — migrations and RLS (if schema changed)
- `performance` — hot paths (if data-fetch or caching changed)

For SIMPLE changes, skip subagent delegation entirely.

## Output

State the complexity label first. Group findings by severity (Blocker / Should-fix / Nit).
For each: file:line, the convention it violates, and a concrete fix. Call out anything
that regresses a privacy invariant or fail-secure behavior as a Blocker. Note explicitly
when the change is clean.
