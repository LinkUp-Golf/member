// ============================================================
// Typed API client with global 403 MEMBERSHIP_REVOKED handler.
//
// When the server returns 403 with code MEMBERSHIP_REVOKED, the
// client must immediately sign out and redirect — the user's
// membership has been revoked while they were active.
//
// Usage (replaces bare fetch in all client components):
//   import { apiClient } from '@/lib/api-client'
//   const data = await apiClient.get('/api/bookings/create?date=...')
//   const result = await apiClient.post('/api/bookings/create', body)
// ============================================================

import { ErrorCode } from '@/lib/errors/app-error'

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface ApiClientOptions {
  onMembershipRevoked: () => void
}

interface ApiResponse<T = unknown> {
  data: T | null
  error: { code: string; message: string } | null
  status: number
}

class ApiClient {
  private onMembershipRevoked: (() => void) | null = null

  /** Call once from the app layout / auth store to wire in the signout handler */
  configure(options: ApiClientOptions): void {
    this.onMembershipRevoked = options.onMembershipRevoked
  }

  async request<T = unknown>(
    path: string,
    method: ApiMethod = 'GET',
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })

    // ---- Parse non-OK responses (including 403) -------------
    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } | string } = {}
      try { errorBody = await res.json() } catch { /* empty */ }

      const errObj = typeof errorBody.error === 'object' ? errorBody.error : null
      const errMsg = typeof errorBody.error === 'string' ? errorBody.error : errObj?.message
      const errCode = errObj?.code ?? 'REQUEST_FAILED'

      // 403 MEMBERSHIP_REVOKED: sign out immediately
      if (res.status === 403 && errCode === ErrorCode.MEMBERSHIP_REVOKED) {
        this.onMembershipRevoked?.()
        return {
          data: null,
          error: { code: ErrorCode.MEMBERSHIP_REVOKED, message: 'Your membership is no longer active.' },
          status: 403,
        }
      }

      return {
        data: null,
        error: { code: errCode, message: errMsg ?? `Request failed with status ${res.status}` },
        status: res.status,
      }
    }

    const data = await res.json().catch(() => null) as T | null
    return { data, error: null, status: res.status }
  }

  get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>(path, 'GET')
  }

  post<T = unknown>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, 'POST', body)
  }

  patch<T = unknown>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, 'PATCH', body)
  }

  delete<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, 'DELETE', body)
  }
}

export const apiClient = new ApiClient()
