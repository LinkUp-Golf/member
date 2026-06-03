// ============================================================
// LinkUp Golf — Next.js Middleware (Edge Runtime)
// Runs on every matched request. Responsibilities:
//   1. Attach correlation ID to every request
//   2. Supabase session refresh
//   3. Redirect unauthenticated users to /login
//   4. Guard /admin routes with is_admin DB check
//
// NOTE: GHL tag re-validation is NOT done here (Edge runtime
// has no persistent cache). It is enforced per-request in
// API routes via withAuth() in src/lib/auth/with-auth.ts.
// ============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
  '/join',
  '/install',
  '/auth/error',
  '/membership-required',
  '/api/auth/magic-link',   // unauthenticated users request magic links
  '/api/auth/callback',     // Supabase redirects here after magic link click
  '/api/auth/signout',      // clears session cookie server-side
  '/api/webhooks',          // GHL webhooks secured by secret, not session
]

const ADMIN_ROUTES = ['/admin']

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Service-worker assets: importScripts() cannot follow redirects, so pass
  // these through before any auth logic runs. The matcher already excludes
  // them, but this guards against edge cases (e.g. cached middleware bundle).
  if (/^\/(sw\.js|worker-|workbox-)/.test(pathname)) {
    return NextResponse.next()
  }

  const requestId = crypto.randomUUID()

  // Guard: if Supabase env vars are missing, skip auth and let the request through.
  // This prevents a hard crash in the edge runtime when env vars are not yet configured.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('Middleware: Missing Supabase env vars — skipping auth checks')
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  // Attach correlation ID so it propagates to API responses and logs
  response.headers.set('X-Request-Id', requestId)

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            request.cookies.set({ name, value, ...options })
            response = NextResponse.next({ request: { headers: request.headers } })
            response.headers.set('X-Request-Id', requestId)
            response.cookies.set({ name, value, ...options })
          },
          remove(name: string, options: CookieOptions) {
            request.cookies.set({ name, value: '', ...options })
            response = NextResponse.next({ request: { headers: request.headers } })
            response.headers.set('X-Request-Id', requestId)
            response.cookies.set({ name, value: '', ...options })
          },
        },
      }
    )

    // Refresh session (also validates JWT signature via Supabase)
    const { data: { user } } = await supabase.auth.getUser()

    // ---- Public routes ---------------------------------------
    if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
      // Already authenticated → redirect away from login page
      if (user && pathname === '/login') {
        const redirectResponse = NextResponse.redirect(new URL('/home', request.url))
        redirectResponse.headers.set('X-Request-Id', requestId)
        return redirectResponse
      }
      return response
    }

    // ---- Unauthenticated: redirect to login ------------------
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', pathname)
      const redirectResponse = NextResponse.redirect(loginUrl)
      redirectResponse.headers.set('X-Request-Id', requestId)
      return redirectResponse
    }

    // ---- Admin routes: enforce is_admin ----------------------
    if (user && ADMIN_ROUTES.some(route => pathname.startsWith(route))) {
      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (memberError) {
        // DB query failed (network blip, cold start, etc.) — retry once
        // before making an access decision to avoid false denials.
        const { data: retried, error: retryError } = await supabase
          .from('members')
          .select('is_admin')
          .eq('id', user.id)
          .single()

        if (retryError || !retried?.is_admin) {
          const redirectResponse = NextResponse.redirect(new URL('/home', request.url))
          redirectResponse.headers.set('X-Request-Id', requestId)
          return redirectResponse
        }
      } else if (!member?.is_admin) {
        const redirectResponse = NextResponse.redirect(new URL('/home', request.url))
        redirectResponse.headers.set('X-Request-Id', requestId)
        return redirectResponse
      }
    }
  } catch (err) {
    console.error('Middleware error:', err)
    // Fall through: let the request continue rather than crashing the edge worker.
    // The page/API route will enforce its own auth checks.
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|worker-|mockServiceWorker.js|workbox-|.*\\.(?:webp|png|jpg|jpeg|svg|gif|ico|woff2?|ttf|eot|otf|mp4|mp3|pdf)).*)',
  ],
}
