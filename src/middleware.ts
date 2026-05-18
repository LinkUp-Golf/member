// ============================================================
// LinkUp Golf — Next.js Middleware
// Runs on every request. Handles:
// 1. Supabase session refresh
// 2. Route protection (redirect unauthenticated users to /login)
// 3. Admin route protection
// ============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/join',           // invitation onboarding
  '/auth/callback',  // magic link callback
  '/auth/error',
  '/api/webhooks',   // GHL webhooks (secured by webhook secret, not auth)
]

// Routes that require admin role
const ADMIN_ROUTES = ['/admin']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // Refresh session if it exists
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Allow public routes through
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    // If already logged in and hitting /login, redirect to home
    if (user && pathname === '/login') {
      return NextResponse.redirect(new URL('/home', request.url))
    }
    return response
  }

  // AUTH BYPASS — remove before launch
  // if (!user) {
  //   const loginUrl = new URL('/login', request.url)
  //   loginUrl.searchParams.set('redirectTo', pathname)
  //   return NextResponse.redirect(loginUrl)
  // }

  // Admin route — check admin flag
  if (user && ADMIN_ROUTES.some(route => pathname.startsWith(route))) {
    const { data: member } = await supabase
      .from('members')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!member?.is_admin) {
      return NextResponse.redirect(new URL('/home', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - public folder files (icons, manifest, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox-.*).*)',
  ],
}
