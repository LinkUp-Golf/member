// Browser-only Supabase client.
// Safe to import in Client Components ('use client').
// For server-side clients (API routes, Server Components), use @/lib/supabase-server.

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
