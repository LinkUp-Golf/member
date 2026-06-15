Review the pending changes on the current branch (or the PR / diff referenced by: $ARGUMENTS).

## Objective

Verify the change is correct, consistent with existing patterns, and safe — using
the project's own conventions as the bar. Do not invent new standards.

## Before reviewing

Read the relevant project context so the review reflects how this codebase
actually works:

- `.claude/context/coding-standards.md`
- `.claude/context/architecture.md`
- `.claude/context/auth.md`
- `.claude/context/database.md`
- `.claude/context/security.md`
- `.claude/context/testing.md`

Get the diff (`git diff main...HEAD` or the referenced PR) and read the changed
files in full, plus their immediate callers/callees.

## Review checklist (verify against existing patterns)

### Auth & authorization
- [ ] Authenticated API routes use `withAuth()` / `withAdminAuth()` — not hand-rolled checks.
- [ ] Admin routes use `requireAdmin`; new admin paths reflected in `ADMIN_ROUTES`.
- [ ] New public paths added to `PUBLIC_ROUTES` in `src/middleware.ts`.
- [ ] `createAdminClient()` is server-side only and behind an auth/webhook/cron gate.
- [ ] GHL validation stays fail-secure with positive-cache / negative-recheck asymmetry.

### Data & RLS
- [ ] New tables/columns ship as a migration in `supabase/migrations/`; RLS enabled with community/ownership policies.
- [ ] Message privacy preserved (no `is_admin()` read on `messages`); `invite_tokens`/`play_history` writes stay server-side.
- [ ] Correct Supabase client for the context; client components fetch via `apiClient`.

### Security
- [ ] Input validated via `src/lib/validation.ts`; user content escaped with `sanitiseText()`.
- [ ] Webhook/cron secrets verified before doing work; no secret exposed to client.
- [ ] PATCH handlers whitelist updatable fields.
- [ ] Appropriate rate limiter applied; client errors stay generic; security events `auditLog()`-ged.

### Structure & style
- [ ] Route order: validate → authenticate → authorize → execute → return; `dynamic = 'force-dynamic'` where needed.
- [ ] Typed error hierarchy used; cache via `withCache` + key builders; GHL/push via their lib modules.
- [ ] No `any`; type-only imports; naming, `@/` imports, and `'use client'` usage match conventions.
- [ ] Caching invalidated on mutation.

### Tests & gates
- [ ] `npm run lint`, `npm test`, `npm run build` pass.
- [ ] New `src/lib/` logic (esp. auth/cache/error/security invariants) has a `src/__tests__/*.test.ts`.

## Output

Group findings by severity (Blocker / Should-fix / Nit). For each: file:line, the
convention it violates (cite the context doc), and a concrete fix. Call out
anything that regresses a privacy invariant or fail-secure behavior as a Blocker.
Note explicitly when the change is clean.

For deeper or multi-file changes, delegate dimensions to the `reviewer`, `security`,
`performance`, and `supabase` agents and synthesize their findings.
