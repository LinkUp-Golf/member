import { describe, it, expect } from 'vitest'
import { recipientsToEmail, shouldEmailForMessage } from '@/lib/messages/email-policy'

// The cost of getting this wrong is asymmetric and both directions are bad:
// too eager and a ten-message exchange sends ten emails, too shy and a member
// never hears that someone wrote to them.

const T = {
  tenAgo: '2026-09-25T11:50:00.000Z',
  fiveAgo: '2026-09-25T11:55:00.000Z',
  now: '2026-09-25T12:00:00.000Z',
}

describe('shouldEmailForMessage', () => {
  it('emails the first message in a conversation', () => {
    expect(
      shouldEmailForMessage({ lastReadAt: null, previousMessageAt: null }),
    ).toBe(true)
  })

  it('emails someone who had read everything up to now', () => {
    expect(
      shouldEmailForMessage({ lastReadAt: T.fiveAgo, previousMessageAt: T.tenAgo }),
    ).toBe(true)
  })

  it('stays quiet when they already have something unread here', () => {
    // They were emailed about the message they haven't read. A second email
    // adds nothing they don't already know.
    expect(
      shouldEmailForMessage({ lastReadAt: T.tenAgo, previousMessageAt: T.fiveAgo }),
    ).toBe(false)
  })

  it('emails once to someone who has never opened the conversation, then stops', () => {
    expect(
      shouldEmailForMessage({ lastReadAt: null, previousMessageAt: null }),
    ).toBe(true)
    expect(
      shouldEmailForMessage({ lastReadAt: null, previousMessageAt: T.fiveAgo }),
    ).toBe(false)
  })

  it('treats reading at the same instant as caught up', () => {
    expect(
      shouldEmailForMessage({ lastReadAt: T.fiveAgo, previousMessageAt: T.fiveAgo }),
    ).toBe(true)
  })

  it('errs towards sending when a timestamp makes no sense', () => {
    expect(
      shouldEmailForMessage({ lastReadAt: 'not a date', previousMessageAt: T.fiveAgo }),
    ).toBe(true)
  })
})

describe('recipientsToEmail', () => {
  it('splits a group by who was caught up', () => {
    // One person is reading along, the other has been away since before the
    // last message. Only the second is behind on this conversation.
    const emailed = recipientsToEmail(
      [
        { memberId: 'reading-along', lastReadAt: T.fiveAgo },
        { memberId: 'away', lastReadAt: T.tenAgo },
      ],
      T.fiveAgo,
    )
    expect(emailed).toEqual(['reading-along'])
  })

  it('emails everyone on the opening message', () => {
    const emailed = recipientsToEmail(
      [
        { memberId: 'a', lastReadAt: null },
        { memberId: 'b', lastReadAt: null },
      ],
      null,
    )
    expect(emailed).toEqual(['a', 'b'])
  })

  it('returns nothing rather than throwing on an empty conversation', () => {
    expect(recipientsToEmail([], T.now)).toEqual([])
  })
})
