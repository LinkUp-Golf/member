# Testing Rules — LinkUp Golf

> Derived from the testing setup that **already exists** in this repository. The
> codebase uses Vitest with a focused unit-test suite plus strict lint/type gates.
> These rules codify the conventions in place; the "Current coverage" and "Gaps"
> sections describe the real state so new tests extend the existing approach
> rather than introducing a competing one.

## 1. Test Framework

- **Vitest is the test runner** (`vitest` 4.x, `@vitest/coverage-v8`).
  Configuration: `vitest.config.ts`. Global setup: `src/__tests__/setup.ts`
  (stubs Next.js environment variables).
- **Scripts** (`package.json`):
  - `npm test` — run the suite once
  - `npm run test:watch` — watch mode
  - `npm run test:coverage` — coverage report
- **Test files live in `src/__tests__/`** and are named `*.test.ts`.
- **MSW is available** (already a dev dependency, wired via `MockProvider`) for
  mocking external HTTP (e.g. GHL) in tests.

## 2. What Is Tested Today (follow these patterns)

Coverage is configured for `src/lib/auth/**`, `src/lib/cache/**`,
`src/lib/logger/**`, and `src/lib/errors/**`. Existing suites:

- **`errors.test.ts`** — the `AppError` hierarchy: codes, status codes, type
  mapping.
- **`cache.test.ts`** — `MemoryCache` behavior: TTL expiry, capacity/eviction,
  prefix (`clear`) deletion.
- **`ghl-validator.test.ts`** — GHL membership validation: positive results are
  cached, negative results are always re-checked, and fail-secure behavior when
  GHL is unavailable.

**Conventions to mirror when adding tests:**

- **Prioritize pure/business-logic modules in `src/lib/`** — the lib layer is the
  established unit-test target.
- **Test the security-critical invariants explicitly** (as `ghl-validator.test.ts`
  does): fail-secure on outage, asymmetric caching of positive vs negative auth.
- **Keep tests deterministic** — stub env and external calls via the setup file
  and MSW; do not hit live Supabase or GHL.
- **Co-locate new test files in `src/__tests__/`** with the `*.test.ts` suffix.

## 3. Static Analysis Gates (the everyday "tests")

These run on the whole codebase and are the primary correctness gate alongside
unit tests:

- **`npm run lint`** — ESLint (`next/core-web-vitals` + `next/typescript`) with
  strict rules: `@typescript-eslint/no-explicit-any` (error),
  `consistent-type-imports` (error), `react-hooks/exhaustive-deps` (error),
  `jsx-a11y/*`, `no-console` (warn; off under `src/app/api/**`).
- **`npm run build`** — `next build` performs full TypeScript type-checking under
  `strict: true` (plus `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`). A clean build is the type-safety gate.

**Before pushing, run `npm run lint`, `npm test`, and `npm run build` locally** —
there is no CI to catch failures (see Gaps).

## 4. Current Gaps (documented, not yet standardized)

These are **not** covered today. They are recorded here so contributors know
where the established suite stops — not as invented requirements. Extend coverage
here using the patterns in §2 when touching these areas:

- No integration tests for API route handlers (e.g. `magic-link`,
  `bookings/create`, `webhooks/ghl`).
- No tests for the `withAuth()` HOC end-to-end (its five checks).
- No middleware tests (session refresh, admin redirect/retry).
- No rate-limiter tests (capacity, expiry, reset).
- No webhook signature-verification tests.
- **No CI pipeline / pre-commit hooks** — quality gates are run manually. There is
  no `.github/workflows`, husky, or lint-staged configuration.

## 5. When Adding Tests

1. Place the file in `src/__tests__/` as `<unit>.test.ts`.
2. If the unit lives outside the configured coverage globs, extend the `coverage`
   include list in `vitest.config.ts`.
3. Mock external services (Supabase, GHL, web-push) — never call them live.
4. Assert the **invariant**, not just the happy path (error codes, fail-secure
   denials, cache expiry), matching the depth of the existing suites.
