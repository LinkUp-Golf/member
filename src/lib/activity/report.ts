// ============================================================
// Shared constants for the admin usage report — imported by both
// the API route and the page, so the roster's page-size options
// can't drift between what the UI offers and what the server
// accepts.
// ============================================================

export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

// The roster opens on the shortest page. It's a list to work through — who
// hasn't used the app, who to follow up — not a table to scan, and a first
// screen that ends where the page does beats one that runs past the fold
// before the admin has read a row.
export const DEFAULT_PAGE_SIZE: PageSize = 10
