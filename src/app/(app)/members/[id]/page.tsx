'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import type { MemberWithProfile } from '@/types'

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const [member, setMember] = useState<MemberWithProfile | null>(null)
  const [playedTogether, setPlayedTogether] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) loadMember()
  }, [id])

  async function loadMember() {
    const response = await apiClient.get<{ member: MemberWithProfile; hasPlayedWith: boolean }>(`/api/members/${id}`)

    if (response.error || !response.data) {
      router.push('/members')
      return
    }

    setMember(response.data.member)
    setPlayedTogether(response.data.hasPlayedWith)
    setLoading(false)
  }

  async function startConversation() {
    if (!user || !member) return
    router.push(`/messages/new?with=${member.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="text-green-700" />
      </div>
    )
  }

  if (!member) return null

  const p = member.profile

  return (
    <div>
      {/* Back button */}
      <div className="bg-green-900 px-5 pt-4 pb-0">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-gold text-sm mb-4"
        >
          <BackArrow /> Members
        </button>
      </div>

      {/* Profile header */}
      <div className="bg-green-900 px-5 pb-6 text-center">
        <div className="flex justify-center mb-3">
          <Avatar
            firstName={member.first_name}
            lastName={member.last_name}
            avatarUrl={p?.avatar_url}
            size="xl"
          />
        </div>
        <h1 className="font-serif text-2xl text-white font-medium">
          {member.first_name} {member.last_name}
        </h1>
        {p?.role_title && (
          <p className="text-sm text-white/50 mt-1">
            {p.role_title}{p.business_name ? ` · ${p.business_name}` : ''}
          </p>
        )}

        {/* Tags */}
        <div className="flex gap-2 justify-center flex-wrap mt-3">
          {member.home_course?.city && (
            <span className="profile-tag">{member.home_course.city}</span>
          )}
          {p?.handicap_index !== null && p?.handicap_index !== undefined && p?.show_handicap && (
            <span className="profile-tag">Handicap {p.handicap_index}</span>
          )}
          {!playedTogether && (
            <span className="profile-tag text-gold/70">Haven't played yet</span>
          )}
          {playedTogether && (
            <span className="profile-tag">⛳ Played together</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-5 py-4 flex gap-3">
        <button onClick={startConversation} className="btn btn-primary flex-1 justify-center">
          <MessageIcon /> Message
        </button>
        <Link
          href={`/book?invite=${member.id}`}
          className="btn btn-outline flex-1 justify-center"
        >
          <CalendarIcon /> Invite to round
        </Link>
      </div>

      {/* Play suggestion */}
      {!playedTogether && (
        <div className="mx-5 mb-4 rounded-xl bg-green-50 border border-green-900/10 p-3.5 flex items-start gap-3">
          <span className="text-lg">💡</span>
          <div>
            <p className="text-sm text-green-900 font-medium">
              You haven't played with {member.first_name} yet
            </p>
            <p className="text-xs text-green-900/55 mt-0.5">
              Would you like us to find a date? Start a message to coordinate.
            </p>
          </div>
        </div>
      )}

      {/* Profile sections */}
      <div className="pb-6">
        {p?.business_description && (
          <ProfileSection label="About their business">
            {p.business_description}
          </ProfileSection>
        )}

        {p?.value_offered && (
          <ProfileSection label="Value they offer">
            {p.value_offered}
          </ProfileSection>
        )}

        {p?.value_sought && (
          <ProfileSection label="What they're looking for">
            {p.value_sought}
          </ProfileSection>
        )}

        {p?.non_golf_hobbies && (
          <ProfileSection label="Beyond the office">
            {p.non_golf_hobbies}
          </ProfileSection>
        )}

        {/* Golf life */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Golf life</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {p?.handicap_index !== null && p?.handicap_index !== undefined && p?.show_handicap && (
              <GolfStat value={String(p.handicap_index)} label="Handicap" />
            )}
            {p?.play_frequency && (
              <GolfStat value={p.play_frequency} label="Per month" />
            )}
            {p?.preferred_play_times && (
              <GolfStat value={p.preferred_play_times} label="Preferred time" />
            )}
            <GolfStat
              value={p?.open_to_golf_travel ? 'Yes' : 'No'}
              label="Golf travel"
            />
          </div>
          {p?.family_golfers && (
            <p className="text-sm text-green-900/60 leading-relaxed">{p.family_golfers}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Sub-components -----------------------------------------

function ProfileSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-green-900/08">
      <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">{label}</p>
      <p className="text-sm text-green-900 leading-relaxed">{children}</p>
    </div>
  )
}

function GolfStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-green-50 rounded-xl p-3 text-center">
      <p className="font-serif text-xl font-semibold text-green-900">{value}</p>
      <p className="text-xs text-green-900/40 mt-1 tracking-wide">{label}</p>
    </div>
  )
}

// ---- Inline icons -------------------------------------------
function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
function MessageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  )
}
