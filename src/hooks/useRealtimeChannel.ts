import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Generic lifecycle manager for a Supabase Realtime channel.
// setup receives a fresh channel, attaches listeners, and returns it.
// The channel is subscribed automatically and cleaned up on unmount.
export function useRealtimeChannel(
  channelName: string,
  setup: (channel: RealtimeChannel) => RealtimeChannel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: any[]
) {
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = setup(supabase.channel(channelName))
    channel.subscribe()
    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
    // deps intentionally spread — callers control when to re-subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, ...deps])

  return channelRef
}
