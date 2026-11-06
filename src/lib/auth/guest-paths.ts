// ============================================================
// Where a guest may go — the pages, not the API.
//
// A guest (isGuestOnly in @/lib/ghl/tags) can sign in, but the app is theirs
// for their own rounds and their own account only. Every other page sends them
// to BECOME_A_MEMBER_PATH: the middleware does it on the server before the page
// renders, and AppNav does it again for navigation that happens in the browser
// (switching /book's tab is a URL change the middleware may never see).
//
// The API is gated separately and is the part that can't be talked around:
// withAuth refuses a guest every route not marked allowGuests. Keep this list
// and those routes in step.
//
// Pure, so the edge middleware can import it.
// ============================================================

import { MY_BOOKINGS_TAB } from '@/lib/constants'

export const BECOME_A_MEMBER_PATH = '/become-a-member'

/** Pages a guest may open, with everything beneath them. */
const OPEN_TO_GUESTS = [
  BECOME_A_MEMBER_PATH,
  '/book/invitations', // answering being added to a round
  '/more/profile',
  '/more/settings',
  '/more/install',
]

/**
 * Whether a guest may be on this page. `tab` is the ?tab= query value — /book
 * is open to them only on its My bookings tab.
 */
export function isOpenToGuests(pathname: string, tab: string | null): boolean {
  if (OPEN_TO_GUESTS.some(p => pathname === p || pathname.startsWith(`${p}/`))) return true
  return pathname === '/book' && tab === MY_BOOKINGS_TAB
}
