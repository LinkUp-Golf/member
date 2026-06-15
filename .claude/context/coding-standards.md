# Coding Standards — LinkUp Golf

> Derived from existing patterns in this repository. These standards document
> conventions that are **already followed consistently** in the codebase. They
> are descriptive, not aspirational — follow them to stay consistent with the
> surrounding code.

## 0. Git — branches & commits

- **Conventional type prefixes**, taken from the commit history (`feature` ×27,
  `fix` ×11, `chore`): use the **full word `feature`** (not `feat`), `fix`,
  `chore`; `refactor` / `docs` / `hotfix` when they clearly apply.
- **Commit messages:** `<type>: <summary>` (e.g. `feature: in-app notifications`,
  `fix: convert tee times to user local timezone`).
- **Branches:** `<type>/<short-slug>` — and for ClickUp-driven work,
  `<type>/<taskId>-<slug>` (e.g. `feature/86d3bpfzy-admin-custom-group-actions`).
- **Base branch:** work branches off and PRs target `develop`; `main` is the
  production branch.
- Never commit directly on `develop` or `main`.

## 1. TypeScript

- **Strict mode is on.** `tsconfig.json` enables `strict: true`,
  `noUncheckedIndexedAccess`, `noImplicitReturns`, and
  `noFallthroughCasesInSwitch`. Write code that satisfies these.
- **No `any`.** `@typescript-eslint/no-explicit-any` is an **error**. Use proper
  types, generics, or `unknown` with narrowing.
- **`interface` for object contracts, `type` for unions and composition.**
  - Database rows / provider contracts → `interface` (e.g. `Member`, `Booking`,
    `GHLContact` in `src/types/index.ts`).
  - String-literal unions and enriched/joined shapes → `type` (e.g.
    `MembershipStatus`, `BookingStatus`, `ApiResponse<T>`).
- **No `enum` keyword.** Enumerations are modeled as string-literal unions, and
  fixed lists as `const` arrays with inferred types (e.g. `INDUSTRY_CATEGORIES`
  in `src/types/index.ts`).
- **Use type-only imports.** `@typescript-eslint/consistent-type-imports` is an
  **error**: `import type { OptimisticMessage } from '@/types'`.
- **Domain types live in `src/types/index.ts`**; integration-specific types live
  beside their module (`src/lib/ghl/types.ts`, `src/lib/push/types.ts`, etc.).

## 2. Naming Conventions

| Kind | Convention | Example |
|------|------------|---------|
| Components | PascalCase file + default export | `Avatar.tsx` → `export default function Avatar` |
| Hooks | `use` prefix, camelCase file | `useProfile.ts` → `export function useProfile()` |
| Utilities / libs | camelCase file | `api-client.ts`, `validation.ts` |
| Folders | kebab-case | `messages/`, `ui/`, `with-auth.ts` |
| API routes | path = folder structure, handler = `route.ts` | `api/bookings/create/route.ts` |
| Functions | camelCase | `getInitials()`, `validateEmail()` |
| Factories / HOCs | `create*`, `with*`, `get*` prefix | `createAdminClient()`, `withAuth()` |
| Predicates | `is*`, `has*`, `can*` | `hasAnyAccessTag()` |
| Type unions | camelCase | `membershipStatus` |
| Domain types | PascalCase | `Member`, `Booking` |
| App constants | SCREAMING_SNAKE_CASE | `BOOKING_PRICE_USD`, `GHL_BASE_URL` |
| DB fields | snake_case (mirrored in TS types) | `member_id`, `created_at` |

## 3. React Components

- **Functional components only**, with destructured, interface-typed props.
  Optional props use `?` (e.g. `size?: 'sm' | 'md' | 'lg' | 'xl'`).
- **Mark client code explicitly** with `'use client'` at the top of the file
  (components using hooks/state, context providers, hooks). Server components and
  layouts stay unmarked.
- **Export style:** default exports for UI components and pages; named exports for
  utilities and hooks. Co-located sub-components are named functions within the
  file (see `MessageBubble.tsx`).
- **No PropTypes** — typing is fully via TypeScript.

## 4. State, Context & Data Fetching

- **Auth/session state** flows through context providers (`AuthContext`,
  `ProfileContext` in `src/contexts/`, `SessionProvider` in
  `src/components/providers/`). Profile loading composes session + member data
  (`useProfile()` composes `useUser()` + profile context).
- **Client components fetch via the `apiClient` singleton**
  (`src/lib/api-client.ts`), never via direct Supabase calls. Pattern:
  `apiClient.get<ResponseType>(path)` returning `{ data, error, status }`.
  Parallelize independent reads with `Promise.all()`.
- **Client components never access the database directly** — they call API routes.
- **Resilience patterns already in use:** exponential-backoff retry on profile
  fetch, optimistic updates for message send (temp id → replace on confirm), and
  dual-layer realtime (broadcast + `postgres_changes` backup) on channel
  `conversation:{id}`.

## 5. API Route Handlers

Standard order: **validate → authenticate → authorize → execute → return.**

- **Wrap authenticated routes with `withAuth()`** (or `withAdminAuth()` /
  `withAuth(..., { requireAdmin: true })`) from `src/lib/auth/with-auth.ts`. The
  HOC supplies an `AuthContext` (`userId`, `memberId`, `ghlContactId`, `isAdmin`,
  `homeCourseId`, `requestId`).
- **Validate input first** using `src/lib/validation.ts` validators; return
  `NextResponse.json({ error: result.errors[0] }, { status: 400 })` on failure.
- **Set `export const dynamic = 'force-dynamic'`** on dynamic route handlers.
- **Success responses:** `NextResponse.json(data)` (or `{ status: 201 }` for
  creates).
- **Fire-and-forget side effects** (cache invalidation, push notifications) are
  non-critical — wrap in `.catch(() => {})` so they never fail the main request.
- **One route per `route.ts` file.**

## 6. Error Handling

- **Use the typed error hierarchy** in `src/lib/errors/app-error.ts`: `AppError`
  base with `.code`, `.statusCode`, `.context`; subclasses `AuthError` (401),
  `AuthorizationError` (403), `ValidationError` (400), `GHLError` (503),
  `RateLimitError` (429).
- **API error response shape:** `{ error: { code, message } }` with matching HTTP
  status. Client-facing wrapper shape: `{ data: T | null, error: { code, message } | null }`.
- **Return generic messages to clients** for security-sensitive flows; put the
  specific reason in logs via `auditLog()` (see `magic-link/route.ts`).
- **Correlate logs with a request id** (`randomUUID()`), attached to the response
  header and threaded through child loggers.

## 7. Validation & Sanitization

- **Validators return `{ valid: boolean, errors: string[] }`**
  (`src/lib/validation.ts`). Compose multiple results with `combineResults(...)`.
- Available validators: `validateEmail`, `validateString`, `validateDate`
  (`YYYY-MM-DD`), `validateUUID`, plus composites
  (`validateBookingPayload`, `validateMessagePayload`, `validateReferralPayload`).
- **Escape user-generated content with `sanitiseText()`** before storing/displaying
  it to other users.

## 8. Imports & Path Aliases

- **Use the `@/` alias** for all `src/`-relative imports
  (`@/components/ui/Avatar`, `@/lib/utils`). Relative imports only for co-located
  sub-components.
- **Import order:** React/Next → external packages → internal (`@/lib` → `@/hooks`
  → `@/components` → `@/types`).

## 9. Logging

- **`no-console` is a warning** repo-wide but **disabled under `src/app/api/**`**
  where console logging is permitted for request debugging.
- **Security-relevant events go through `auditLog('EVENT_NAME', { ... })`**
  (`src/lib/logger/`), a dedicated sink — not the general logger.

## 10. Styling (Tailwind)

- **Utility-first Tailwind**; no CSS modules.
- **Brand colors** are defined in `tailwind.config.ts` (e.g. `green-900`
  `#002669`, `gold` `#85bb65`, `charcoal`, `cream`). Reference via Tailwind
  classes (`text-green-900`) or CSS variables (`style={{ color: 'var(--color-gold)' }}`).
- **Semantic block classes** (`.card`, `.bubble`, `.top-bar`, `.avatar`,
  `.section-label`, with modifiers like `.bubble-in`/`.bubble-out`) are defined in
  global CSS and reused across the app.
- **Light theme only** — no dark mode is configured.
