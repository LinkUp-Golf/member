Investigate the bug described by: $ARGUMENTS

## Objective

Find the root cause with evidence before proposing a fix. Understand the project's
patterns first; do not guess or introduce new patterns.

## Before investigating

Read the context relevant to the affected area:

- `.claude/context/architecture.md` — layer boundaries, where logic lives
- `.claude/context/auth.md` — if the bug touches login, sessions, membership, or 401/403s
- `.claude/context/database.md` — if it touches data, RLS, or migrations
- `.claude/context/security.md` — if it touches secrets, webhooks, cron, rate limits

## Steps

1. **Reproduce / locate.** Restate the expected vs actual behavior. Identify the
   entry point (route, component, hook, cron, webhook) and trace the request path
   through the layers: middleware → `withAuth` → handler → lib → Supabase/GHL.
2. **Gather evidence.** Read the actual code on the path. Check the obvious
   project-specific culprits:
   - 403s → GHL membership validation / `is_admin` / RLS policy mismatch.
   - Empty/blocked data → RLS policy (community vs ownership), wrong Supabase client.
   - Stale data → cache TTL / missing invalidation (`src/lib/cache/`), or service-worker caching.
   - Auth loops → middleware redirect logic, session refresh, `PUBLIC_ROUTES`.
   - Missing notifications → push subscription pruning, cron secret, fire-and-forget `.catch`.
   - Timezone/booking issues → course `timezone`, tee-time conversions.
3. **Form a hypothesis** and confirm it against the code (and a test if one can
   isolate it). Distinguish root cause from symptom.
4. **Propose the fix** consistent with existing patterns — the minimal change at
   the right layer. Note any RLS/migration implications.

## Output

- Root cause with file:line evidence and the request path.
- Why it happens (the specific condition).
- Proposed fix (and which layer it belongs in), plus any regression risk.
- A test that would catch it, if the area is unit-testable (`src/__tests__/`).

Do not apply the fix unless asked — report first. For wide or uncertain searches,
delegate to the `Explore` agent; for data/RLS depth, use the `supabase` agent.
