Implement the ticket / feature described by: $ARGUMENTS

## Objective

Ship the change consistent with the existing codebase. Reuse established patterns;
never introduce a parallel mechanism where one already exists.

## Step 1 — Classify complexity

Before doing anything, label the request **SIMPLE** or **COMPLEX**:

**SIMPLE** — all of the following must be true:
- UI text, copy, labels, or minor styling only
- No new API routes, no `src/lib/` logic, no migrations, no auth/security changes
- Touches ≤ 3 files, all in `src/app/` (pages/components only)
- Clear, unambiguous scope

**COMPLEX** — any of the following:
- New feature, API route, or `src/lib/` logic
- Schema/migration or RLS change
- Auth, membership, or security layer involved
- > 3 files or multiple layers
- Ambiguous scope

State the label and one-line reason before proceeding.

## Step 2 — Load context (COMPLEX only)

If COMPLEX, read the context for the area you're touching:

- `.claude/context/architecture.md` — layers, module organization, client selection
- `.claude/context/coding-standards.md` — TS/React/route/error conventions
- `.claude/context/auth.md` — if it touches auth/membership/admin
- `.claude/context/database.md` — if it needs schema/RLS changes
- `.claude/context/security.md` — secrets, validation, rate limits, privacy invariants
- `.claude/context/testing.md` — where and how to add tests

Read 2–3 existing implementations of the nearest analogous feature and mirror them.

If SIMPLE, skip context docs — implement directly, mirroring the nearest analogous file.

## Step 3 — Plan (COMPLEX only)

If COMPLEX, state a short plan: files to add/change, the layer each change belongs in,
and any migration. Confirm scope before large changes. For non-trivial design, use the
`Plan` or `architect` agent.

If SIMPLE, skip the plan step — just implement.

## Step 4 — Implementation rules (from existing patterns)

- **API routes:** wrap with `withAuth()` / `withAdminAuth()`; order validate →
  authenticate → authorize → execute → return; set `dynamic = 'force-dynamic'`;
  validate via `src/lib/validation.ts`; use the typed error hierarchy; wrap
  non-critical side effects in `.catch(() => {})`.
- **Data:** schema/RLS changes go in a new `supabase/migrations/` file with
  community/ownership policies; preserve message privacy and server-only write
  patterns. Update the matching TS types in `src/types/index.ts`.
- **Clients:** correct Supabase client per context; `createAdminClient()` only
  server-side behind a gate; client components fetch via `apiClient`.
- **Cross-cutting:** GHL via `src/lib/ghl/`; cache via `withCache` + key builders
  (invalidate on mutation); push via `pushService.ts`.
- **Style:** strict TS (no `any`), type-only imports, `@/` aliases, `'use client'`
  only where needed, Tailwind brand classes.

## Step 5 — Verify

- Add/extend tests in `src/__tests__/` for new `src/lib/` logic (esp. auth, cache,
  errors, security invariants), mocking external services. (COMPLEX only)
- Run `npm run lint`, `npm test`, and `npm run build` — all must pass (no CI to
  catch failures).
- Self-review against `.claude/commands/review-pr.md` before declaring done.

## Output

Summarize what changed (by file), any migration to apply, how it was verified, and
anything deferred. Commit/push only if explicitly asked.
