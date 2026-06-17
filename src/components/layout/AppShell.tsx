import Header from '@/components/ui/Header'

interface AppShellProps {
  children: React.ReactNode
  /** Page title shown in the header */
  title?: string
  /** Subtitle shown below the title */
  description?: string
  /** Element on the right side of the header */
  end?: React.ReactNode
  /** Replace the entire header with a custom element */
  header?: React.ReactNode
  /** Hide the messages shortcut icon in the header (e.g. on the messages page itself) */
  hideMessagesLink?: boolean
}

// AppShell wraps a page's header + scrollable content.
// Navigation (sidebar + bottom nav) is handled by (app)/layout.tsx
// and is always visible — including during Suspense loading states.
export default function AppShell({
  children,
  title,
  description,
  end,
  header,
  hideMessagesLink,
}: AppShellProps) {
  const showHeader = header !== undefined || title !== undefined

  return (
    <>
      {showHeader && (
        header ?? <Header title={title ?? ''} description={description} end={end} hideMessagesLink={hideMessagesLink} />
      )}
      {children}
    </>
  )
}
