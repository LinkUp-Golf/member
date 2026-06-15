Implement the ticket / feature described by: $ARGUMENTS

## Objective

Ship the change consistent with the existing codebase. Reuse established patterns;
never introduce a parallel mechanism where one already exists.

## Before implementing

Read the context for the area you're touching:

- `.claude/context/architecture.md` — layers, module organization, client selection
- `.claude/context/coding-standards.md` — TS/React/route/error conventions
- `.claude/context/auth.md` — if it touches auth/membership/admin
- `.claude/context/database.md` — if it needs schema/RLS changes
- `.claude/context/security.md` — secrets, validation, rate limits, privacy invariants
- `.claude/context/testing.md` — where and how to add tests

Read 2–3 existing implementations of the nearest analogous feature and mirror them.

## Plan first

State a short plan: files to add/change, the layer each change belongs in, and any
migration. Confirm scope before large changes. For non-trivial design, use the
`Plan` or `architect` agent.

## Implementation rules (from existing patterns)

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

## Verify

- Add/extend tests in `src/__tests__/` for new `src/lib/` logic (esp. auth, cache,
  errors, security invariants), mocking external services.
- Run `npm run lint`, `npm test`, and `npm run build` — all must pass (no CI to
  catch failures).
- Self-review against `.claude/commands/review-pr.md` before declaring done.

## Output

Summarize what changed (by file), any migration to apply, how it was verified, and
anything deferred. Commit/push only if explicitly asked.
