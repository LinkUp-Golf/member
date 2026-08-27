// ============================================================
// LinkUp Golf — Video guides
//
// The catalogue of walkthrough videos, in one place so a video can be added,
// retitled or re-recorded without touching a screen. Every surface that offers
// one reads from here: the host workspace's Guides page lists them, and the
// screens each video is about link to that one video inline.
//
// Ordered as a journey rather than alphabetically — apply, host a round, spend
// what it earned — because that is how the list reads to someone who has done
// none of it yet.
//
// Safe to import from a client component: data only, no server imports.
// ============================================================

/**
 * Who a guide is for. Only hosts have videos today; the field exists so the
 * first member-facing one doesn't need this file reshaped, and so a future
 * /more/tutorials page can filter rather than hardcode.
 */
export type TutorialAudience = 'host'

export interface Tutorial {
  /** Stable id — used to link one video from the screen it explains. */
  id: string
  title: string
  /** One line, in terms of what the viewer will be able to do afterwards. */
  description: string
  url: string
  audience: TutorialAudience
  /**
   * Rough download size in MB. Shown before anything is fetched, because these
   * are 25–50 MB screen recordings and starting one unaware on cellular is a
   * real cost to the viewer. Update it if a video is re-encoded; leave it off
   * and the size line simply doesn't render.
   */
  sizeMb?: number
}

const CDN = 'https://assets.cdn.filesafe.space/J3tfnLdEv4WmE3XorQYW/media'

export const TUTORIALS: Tutorial[] = [
  {
    id: 'host-application',
    title: 'Apply to be a Host',
    description: 'How to apply, what we ask for, and what happens once you are approved.',
    url: `${CDN}/6a8c366267f8d8c86b4e2100.mp4`,
    audience: 'host',
    sizeMb: 46,
  },
  {
    id: 'hosting-event',
    title: 'Create an event',
    description: 'Listing rounds at your club, and what happens as members reserve the spots.',
    url: `${CDN}/6a8c366267bb7ac35108b769.mp4`,
    audience: 'host',
    sizeMb: 48,
  },
  {
    id: 'credit-usage',
    title: 'Redeem credits',
    description: 'Turning the credit you earned into a code, and paying for a round with it.',
    url: `${CDN}/6a8c3662ad59e6cfed052362.mp4`,
    audience: 'host',
    sizeMb: 25,
  },
]

/** One guide by id. Returns undefined rather than throwing — a missing video
 *  should cost the link, not the screen it sits on. */
export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find(t => t.id === id)
}

/** The guides for one audience, in journey order. */
export function tutorialsFor(audience: TutorialAudience): Tutorial[] {
  return TUTORIALS.filter(t => t.audience === audience)
}
