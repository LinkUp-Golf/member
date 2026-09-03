// ============================================================
// Shared constants for the admin usage report — imported by both
// the API route and the page, so the roster's page-size options
// can't drift between what the UI offers and what the server
// accepts.
// ============================================================

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25
