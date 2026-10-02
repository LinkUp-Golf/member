import { describe, it, expect } from 'vitest'
import { announcementImages, isVideoUrl } from '@/lib/announcements/media'

// Which of a post's assets can go in the email about it. The failure is silent
// in both directions: a video URL in an <img> is a broken image in every inbox,
// and a dropped photo is a post that arrives looking like nothing happened.

const CDN = 'https://cdn.example.com/post-media'

describe('isVideoUrl', () => {
  it('knows the formats the upload accepts', () => {
    expect(isVideoUrl(`${CDN}/round.mp4`)).toBe(true)
    expect(isVideoUrl(`${CDN}/round.webm`)).toBe(true)
    expect(isVideoUrl(`${CDN}/round.MOV`)).toBe(true)
  })

  it('reads a still as a still', () => {
    expect(isVideoUrl(`${CDN}/round.jpg`)).toBe(false)
    expect(isVideoUrl(`${CDN}/round.png`)).toBe(false)
    expect(isVideoUrl(`${CDN}/round.webp`)).toBe(false)
  })

  it('ignores a query string, which a storage URL carries', () => {
    expect(isVideoUrl(`${CDN}/round.mp4?token=abc`)).toBe(true)
    expect(isVideoUrl(`${CDN}/round.jpg?width=400`)).toBe(false)
  })

  it('treats something with no extension as not a video', () => {
    // An <img> that turns out to be a video shows nothing; the reverse would
    // drop a real photo.
    expect(isVideoUrl(`${CDN}/round`)).toBe(false)
    expect(isVideoUrl('')).toBe(false)
  })
})

describe('announcementImages', () => {
  it('takes the post\'s media in the order it was posted', () => {
    expect(
      announcementImages({
        media_urls: [`${CDN}/a.jpg`, `${CDN}/b.png`],
        image_url: `${CDN}/a.jpg`,
      }),
    ).toEqual([`${CDN}/a.jpg`, `${CDN}/b.png`])
  })

  it('leaves the video behind', () => {
    // A mail client won't play it, and the few that embed one download the whole
    // file into the message. The button opens the post, which is where it plays.
    expect(
      announcementImages({
        media_urls: [`${CDN}/clip.mp4`, `${CDN}/a.jpg`],
        video_url: `${CDN}/clip.mp4`,
      }),
    ).toEqual([`${CDN}/a.jpg`])
  })

  it('falls back to image_url for a row written before media_urls', () => {
    expect(announcementImages({ image_url: `${CDN}/old.jpg` })).toEqual([`${CDN}/old.jpg`])
  })

  it('names each image once', () => {
    // image_url mirrors the first of media_urls, so the two overlap by design.
    expect(
      announcementImages({ media_urls: [`${CDN}/a.jpg`], image_url: `${CDN}/a.jpg` }),
    ).toEqual([`${CDN}/a.jpg`])
  })

  it('drops anything a mail client could not fetch', () => {
    // It fetches these itself, from wherever it is — a path relative to the app
    // is a broken image in every inbox.
    expect(
      announcementImages({
        media_urls: ['/post-media/a.jpg', 'data:image/png;base64,xx', '  ', `${CDN}/a.jpg`],
      }),
    ).toEqual([`${CDN}/a.jpg`])
  })

  it('is empty for a post with nothing on it', () => {
    expect(announcementImages({})).toEqual([])
    expect(announcementImages({ media_urls: null, image_url: null, video_url: null })).toEqual([])
  })
})
