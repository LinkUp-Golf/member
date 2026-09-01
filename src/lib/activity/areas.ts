// ============================================================
// Member activity registry — the single list of everything the
// app tracks, shared by the client tracker, the ingest route and
// the admin report.
//
// Imported by client components, so it must stay free of any
// server-only import.
//
// view vs action
//   view   — landed on an area of the app (a listing, a calendar)
//   action — did something deliberate inside it: opened a specific
//            item, or changed state (booked, cancelled, reserved,
//            clicked out to an offer).
// Announcements and the directory have no transaction of their
// own, so opening a specific announcement or profile is the
// engagement signal for those areas — that's why those count as
// actions rather than views.
// ============================================================

export const ACTIVITY_AREAS = [
  'session',
  'calendars',
  'promotions',
  'announcements',
  'directory',
  'messages',
  'events',
  'profile',
  'other',
] as const

export type ActivityArea = (typeof ACTIVITY_AREAS)[number]

/** The four areas the admin report leads with. */
export const FOCUS_AREAS = ['calendars', 'promotions', 'announcements', 'directory'] as const
export type FocusArea = (typeof FOCUS_AREAS)[number]

export const AREA_LABELS: Record<ActivityArea, string> = {
  session:       'Sign-ins',
  calendars:     'Calendars',
  promotions:    'Promotions',
  announcements: 'Announcements',
  directory:     'Member directory',
  messages:      'Messages',
  events:        'Events',
  profile:       'Profile & settings',
  other:         'Other',
}

export type ActivityKind = 'view' | 'action'

interface ActivitySpec {
  area: ActivityArea
  kind: ActivityKind
  /** Past-tense phrase used verbatim in the admin activity feed. */
  label: string
  /** False for events only the server may record — a member must not be
   *  able to POST themselves a booking. */
  client: boolean
}

export const ACTIVITY_ACTIONS = {
  // ---- Session --------------------------------------------
  // The plainest answer to "did this member use the app at all", and the only
  // activity that can be reconstructed for the past — members.last_sign_in
  // has been stamped since long before this table existed.
  signed_in:                { area: 'session',       kind: 'action', label: 'Signed in',                      client: false },

  // ---- Calendars ------------------------------------------
  calendar_viewed:          { area: 'calendars',     kind: 'view',   label: 'Opened the tee-time calendar',   client: true  },
  host_calendar_viewed:     { area: 'calendars',     kind: 'view',   label: 'Opened the hosted events calendar', client: true },
  booking_created:          { area: 'calendars',     kind: 'action', label: 'Booked a tee time',              client: false },
  booking_cancelled:        { area: 'calendars',     kind: 'action', label: 'Cancelled a booking',            client: false },
  hosted_event_registered:  { area: 'calendars',     kind: 'action', label: 'Reserved a spot at an event',    client: false },

  // ---- Promotions -----------------------------------------
  promotions_viewed:        { area: 'promotions',    kind: 'view',   label: 'Browsed member offers',          client: true  },
  promotion_opened:         { area: 'promotions',    kind: 'action', label: 'Opened an offer',                client: true  },
  promotion_cta_clicked:    { area: 'promotions',    kind: 'action', label: 'Followed an offer link',         client: true  },

  // ---- Announcements --------------------------------------
  announcements_viewed:     { area: 'announcements', kind: 'view',   label: 'Browsed announcements',          client: true  },
  announcement_opened:      { area: 'announcements', kind: 'action', label: 'Read an announcement',           client: true  },

  // ---- Member directory -----------------------------------
  directory_viewed:         { area: 'directory',     kind: 'view',   label: 'Browsed the member directory',   client: true  },
  member_profile_viewed:    { area: 'directory',     kind: 'action', label: 'Viewed a member profile',        client: true  },
  member_message_started:   { area: 'directory',     kind: 'action', label: 'Messaged a member',              client: false },

  // ---- Everything else ------------------------------------
  home_viewed:              { area: 'other',         kind: 'view',   label: 'Opened the home screen',         client: true  },
  more_viewed:              { area: 'other',         kind: 'view',   label: 'Opened the more menu',           client: true  },
  messages_viewed:          { area: 'messages',      kind: 'view',   label: 'Opened messages',                client: true  },
  events_viewed:            { area: 'events',        kind: 'view',   label: 'Browsed events',                 client: true  },
  hosted_event_opened:      { area: 'events',        kind: 'action', label: 'Opened an event',                client: true  },
  profile_viewed:           { area: 'profile',       kind: 'view',   label: 'Opened profile or settings',     client: true  },
} as const satisfies Record<string, ActivitySpec>

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS

export function activitySpec(action: string): ActivitySpec | null {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_ACTIONS, action)
    ? (ACTIVITY_ACTIONS as Record<string, ActivitySpec>)[action] ?? null
    : null
}

/** Ingest guard: the client may only claim events flagged `client: true`. */
export function isClientAction(action: string): action is ActivityAction {
  return activitySpec(action)?.client === true
}

// ---- Path → activity ----------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Maps a member-app pathname onto the activity it represents.
 * Returns null for paths that aren't worth a row — message threads
 * (private, and one row per open would drown everything else) and
 * anything unlisted.
 */
export function activityForPath(pathname: string): { action: ActivityAction; targetId?: string } | null {
  const segments = pathname.split('/').filter(Boolean)
  if (!segments.length) return null

  const [first, second, third] = segments
  const id = (value: string | undefined) => (value && UUID_RE.test(value) ? value : undefined)

  if (first === 'home') return { action: 'home_viewed' }

  if (first === 'book') return { action: 'calendar_viewed' }

  if (first === 'members') {
    const target = id(second)
    return target
      ? { action: 'member_profile_viewed', targetId: target }
      : { action: 'directory_viewed' }
  }

  // Thread contents stay untracked; the list tells us the area was used.
  if (first === 'messages') return second ? null : { action: 'messages_viewed' }

  if (first !== 'more') return null
  if (!second) return { action: 'more_viewed' }

  switch (second) {
    case 'promotions': {
      const target = id(third)
      return target ? { action: 'promotion_opened', targetId: target } : { action: 'promotions_viewed' }
    }
    case 'announcements': {
      const target = id(third)
      return target ? { action: 'announcement_opened', targetId: target } : { action: 'announcements_viewed' }
    }
    case 'hosted-events': {
      if (third === 'calendar') return { action: 'host_calendar_viewed' }
      const target = id(third)
      return target ? { action: 'hosted_event_opened', targetId: target } : { action: 'events_viewed' }
    }
    case 'events':
      return { action: 'events_viewed' }
    case 'profile':
    case 'settings':
      return { action: 'profile_viewed' }
    default:
      return null
  }
}
