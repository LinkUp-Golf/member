/**
 * Pull a displayable string out of an API error body.
 *
 * Route handlers return a flat `{ error: string }`, but withAuth's own failures
 * (401 UNAUTHORIZED, 403 MEMBERSHIP_REVOKED, 429, 503 GHL_UNAVAILABLE) return
 * `{ error: { code, message } }`. Admin components that read `json.error`
 * directly were putting that object into JSX, so an expired session crashed the
 * page with "Objects are not valid as a React child" rather than showing why.
 *
 * apiClient already normalises both shapes; this is for the components that use
 * raw fetch.
 */
export function errorMessage(json: unknown, fallback: string): string {
  const err = (json as { error?: unknown } | null | undefined)?.error

  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}
