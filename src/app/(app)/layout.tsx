import AppNav from '@/components/layout/AppNav'

// Server Component — no client JS for this wrapper.
// Only AppNav (usePathname for active-state) is a client boundary.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppNav>{children}</AppNav>
}
