// An announcement's assets, as the notification can carry them.
//
// A post is written with photos and sometimes a video, and the email about it
// went out as text — so a member read "Dana posted an announcement" with none of
// what was actually posted. The email template already renders images; all that
// was missing was telling it which.
//
// Images only, and the reason is the medium: a mail client will not play a video,
// and the few that embed one do it by downloading the whole file into the
// message. A video-only post emails as it did before, with its button opening the
// post in the app — which is where the video plays.
//
// Pure, so the route that sends the email and the one that approves a held post
// pick the same assets.

/**
 * Extensions we treat as video.
 *
 * Derived from the extension rather than a stored type because that's all a
 * media_urls entry is — a public storage URL. The same list the admin
 * announcements table reads to decide whether to draw a <video> thumbnail, plus
 * the forms that accept uploads.
 */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'quicktime', 'm4v', 'ogv', 'avi'] as const

/** The extension of a URL's path, lowercased, without the dot. */
function extensionOf(url: string): string {
  // Query and fragment first: a signed storage URL carries both, and '.mp4?x=1'
  // must not read as the extension 'mp4?x=1'.
  const path = url.split('#')[0]?.split('?')[0] ?? ''
  const last = path.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase()
}

/** Whether this URL points at a video rather than a still. */
export function isVideoUrl(url: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(url))
}

/**
 * The images an announcement can show in an email, in the order they were posted.
 *
 * `media_urls` is the authoritative list — the admin form writes every file there
 * and mirrors the first image into `image_url` for older readers — so it leads,
 * and `image_url` is a fallback for a row written before that column existed.
 * `video_url` is never returned: see the note at the top.
 */
export function announcementImages(row: {
  image_url?: string | null
  video_url?: string | null
  media_urls?: string[] | null
}): string[] {
  const candidates = [
    ...(Array.isArray(row.media_urls) ? row.media_urls : []),
    row.image_url ?? '',
  ]

  const out: string[] = []
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const url = raw.trim()
    // Only absolute http(s): a mail client fetches these itself, from wherever
    // it is, so a path relative to the app is a broken image in every inbox.
    if (!/^https?:\/\//i.test(url)) continue
    if (isVideoUrl(url)) continue
    if (out.includes(url)) continue
    out.push(url)
  }
  return out
}
