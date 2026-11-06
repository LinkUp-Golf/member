'use client'

// Matchmaking — an admin picks a member, the app lists the players who fit
// them (golf preferences applied both ways, then ranked by score), and the
// admin chooses who to recommend, with a note on why. Nothing is suggested to
// a member without an admin sending it. See docs/playing-partner-matching.md.
//
// Both long lists load MATCHING_PAGE_SIZE at a time and fetch the next page
// as they scroll: the queue inside its own card, which is sized to the screen
// so the page itself doesn't scroll to reach the bottom of it, and the
// players who fit as the page scrolls.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { AdminCard, AdminPageHeader, Badge } from '@/components/admin/AdminUI'
import { ContentLoader, Spinner } from '@/components/ui/Loading'
import { cn } from '@/lib/utils'
import {
  MATCHING_PAGE_SIZE,
  type Candidate,
  type MatchSummary,
  type RecommendationOutcome,
  type SentRecommendation,
} from '@/lib/matching/candidates'
import type { QueueEntry } from '@/lib/matching/queue'
import { MAX_NOTE_LENGTH } from '@/lib/matching/rules'

const MAX_PICKS = 5

interface Detail {
  member: MatchSummary
  candidates: Candidate[]
  /** Everyone who fits, across every page. */
  total: number
  ruledOut: number
  sent: SentRecommendation[]
}

const OUTCOME: Record<RecommendationOutcome, { label: string; colour: 'gray' | 'blue' | 'yellow' | 'green' | 'gold' }> = {
  sent:         { label: 'Sent',            colour: 'gray' },
  seen:         { label: 'Seen',            colour: 'blue' },
  dismissed:    { label: 'Not now',         colour: 'yellow' },
  messaged:     { label: 'Messaged',        colour: 'green' },
  round_booked: { label: 'Round booked',    colour: 'green' },
  played:       { label: 'Played together', colour: 'gold' },
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function roleLine(p: { roleTitle: string | null; businessName: string | null; industry: string | null }): string {
  return [[p.roleTitle, p.businessName].filter(Boolean).join(', '), p.industry].filter(Boolean).join(' · ')
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">{children}</span>
}

/** Calls `onVisible` when `target` scrolls into view of `root` (null: the screen). */
function useLoadMore(
  target: React.RefObject<Element>,
  root: React.RefObject<Element> | null,
  enabled: boolean,
  onVisible: () => void,
) {
  useEffect(() => {
    const el = target.current
    if (!el || !enabled) return
    const io = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) onVisible() },
      { root: root?.current ?? null, rootMargin: '160px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [target, root, enabled, onVisible])
}

function LoadingMore() {
  return (
    <div className="py-3 flex justify-center">
      <Spinner className="w-4 h-4 text-gray-400" />
    </div>
  )
}

// ---- Queue --------------------------------------------------

interface QueueResponse {
  entries: QueueEntry[]
  total: number
  surveyed: number | null
}

async function fetchQueue(term: string, offset: number): Promise<QueueResponse> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(MATCHING_PAGE_SIZE) })
  if (term) params.set('q', term)
  const res = await fetch(`/api/admin/matching?${params}`).catch(() => null)
  const json = await res?.json().catch(() => null)
  if (!res?.ok || !json) throw new Error(json?.error ?? 'Could not load the queue.')
  return json as QueueResponse
}

function QueueList({
  selectedId,
  onSelect,
  reloadKey,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
}) {
  const [q, setQ] = useState('')
  const term = q.trim()
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [total, setTotal] = useState(0)
  const [surveyed, setSurveyed] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  // Bumped per first-page request, so a slow answer to an old search can't
  // overwrite the list for the new one.
  const ticket = useRef(0)

  // As tall as the screen leaves below the card, so the list scrolls inside
  // it and the page doesn't.
  useLayoutEffect(() => {
    function measure() {
      const el = card.current
      if (!el) return
      const scrolled = el.closest('main')?.scrollTop ?? 0
      const top = el.getBoundingClientRect().top + scrolled
      setHeight(Math.max(320, window.innerHeight - top - 24))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const page = await fetchQueue(term, 0)
        if (mine !== ticket.current) return
        setEntries(page.entries)
        setTotal(page.total)
        if (page.surveyed !== null) setSurveyed(page.surveyed)
        scroller.current?.scrollTo({ top: 0 })
      } catch (err) {
        if (mine === ticket.current) setError(err instanceof Error ? err.message : 'Could not load the queue.')
      } finally {
        if (mine === ticket.current) setLoading(false)
      }
    }, term ? 300 : 0)
    return () => clearTimeout(timer)
  }, [term, reloadKey])

  const hasMore = !loading && !error && entries.length < total
  const loadMore = useCallback(async () => {
    if (loadingMore) return
    const mine = ticket.current
    setLoadingMore(true)
    try {
      const page = await fetchQueue(term, entries.length)
      if (mine !== ticket.current) return
      setEntries(prev => {
        const seen = new Set(prev.map(e => e.id))
        return [...prev, ...page.entries.filter(e => !seen.has(e.id))]
      })
      setTotal(page.total)
    } catch (err) {
      if (mine === ticket.current) setError(err instanceof Error ? err.message : 'Could not load more.')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, term, entries.length])

  useLoadMore(sentinel, scroller, hasMore && !loadingMore, loadMore)

  return (
    <div
      ref={card}
      style={height ? { height } : undefined}
      className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800 text-sm">{term ? 'Search results' : 'Waiting for a match'}</h2>
        {!loading && !error && <span className="text-xs text-gray-400 tabular-nums">{total}</span>}
      </div>

      <div className="px-4 sm:px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 focus-within:border-green-700">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            id="matching-search"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Find any member by name or email"
            className="flex-1 min-w-0 text-sm outline-none bg-transparent"
          />
        </div>
        {!term && surveyed !== null && (
          <p className="text-xs text-gray-400 mt-3">
            {surveyed} {surveyed === 1 ? 'member has' : 'members have'} completed the survey. Listed here: no
            recommendation in the last 30 days, newest survey first.
          </p>
        )}
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 sm:px-3 pb-3">
        {loading ? (
          <ContentLoader />
        ) : error && entries.length === 0 ? (
          <p className="text-sm text-red-500 py-6 text-center">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-6 text-center">
            {term ? 'No members match.' : 'Everyone surveyed has had a recommendation in the last 30 days.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-gray-50">
              {entries.map(e => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(e.id)}
                    className={cn(
                      'w-full text-left px-2 py-2.5 rounded-lg transition-colors',
                      selectedId === e.id ? 'bg-green-50' : 'hover:bg-gray-50',
                    )}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                    <p className="text-xs text-gray-500 truncate">{[roleLine(e), e.courseName].filter(Boolean).join(' · ')}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {e.surveyCompletedAt ? `Survey ${shortDate(e.surveyCompletedAt)}` : 'No survey yet'}
                      {e.lastRecommendedAt && ` · Last matched ${shortDate(e.lastRecommendedAt)}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <div ref={sentinel} aria-hidden className="h-px" />
            {loadingMore && <LoadingMore />}
            {error && <p className="text-xs text-red-500 py-2 text-center">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ---- One member ---------------------------------------------

function MemberSummaryCard({ member }: { member: MatchSummary }) {
  return (
    <AdminCard>
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{member.name}</h2>
          <p className="text-sm text-gray-500">
            {[roleLine(member), member.courseName, member.handicap !== null ? `HCP ${member.handicap}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        {member.surveyCompleted && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {member.goals.map(g => <Chip key={g}>{g}</Chip>)}
              {member.playTimes.map(t => <Chip key={t}>{t}</Chip>)}
              {member.attitude && <Chip>{member.attitude}</Chip>}
              {member.companySize && <Chip>{member.companySize}</Chip>}
            </div>
            {(member.offers || member.seeks) && (
              <dl className="grid gap-2 sm:grid-cols-2 text-sm">
                {member.offers && <div><dt className="text-xs text-gray-400">Offers</dt><dd className="text-gray-700">{member.offers}</dd></div>}
                {member.seeks && <div><dt className="text-xs text-gray-400">Looking for</dt><dd className="text-gray-700">{member.seeks}</dd></div>}
              </dl>
            )}
            <p className="text-xs text-gray-500 rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium text-gray-600">Golf preferences:</span> {member.preferences.join(' · ')}
              <span className="block text-gray-400 mt-0.5">Admins only. Never shown to members or named in a note.</span>
            </p>
            {!member.openToSuggestions && (
              <p className="text-xs text-yellow-700">Has turned off being suggested to other members.</p>
            )}
          </>
        )}
      </div>
    </AdminCard>
  )
}

function CandidateRow({
  candidate: c,
  memberFirstName,
  note,
  picked,
  disabled,
  onToggle,
  onNote,
}: {
  candidate: Candidate
  memberFirstName: string
  note: string | undefined
  picked: boolean
  disabled: boolean
  onToggle: () => void
  onNote: (text: string) => void
}) {
  // Sent already, one way or the other: shown ticked so it reads as done,
  // and disabled so it can't be sent twice.
  const locked = Boolean(c.recommendedAt || c.suggestedAt)
  const lockedNote = c.recommendedAt
    ? `Recommended to ${memberFirstName} on ${shortDate(c.recommendedAt)}`
    : c.suggestedAt
      ? `${memberFirstName} was recommended to ${c.firstName || 'them'} on ${shortDate(c.suggestedAt)}`
      : null
  return (
    <li className={cn('px-4 sm:px-5 py-4', picked && 'bg-green-50/60', locked && 'bg-gray-50/70')}>
      <label className={cn('flex gap-3', locked || disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={picked || locked}
          disabled={locked || disabled}
          onChange={onToggle}
          className="mt-1 w-4 h-4 rounded accent-green-800 flex-shrink-0 disabled:opacity-60"
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn('text-sm font-medium', locked ? 'text-gray-500' : 'text-gray-900')}>{c.name}</span>
            <span className="text-sm font-semibold text-green-800 tabular-nums whitespace-nowrap">
              {c.score}<span className="text-xs font-normal text-gray-400"> / 100</span>
            </span>
          </div>
          <p className="text-xs text-gray-500">
            {[roleLine(c), c.handicap !== null ? `HCP ${c.handicap}` : null].filter(Boolean).join(' · ')}
          </p>
          {c.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{c.chips.map(ch => <Chip key={ch}>{ch}</Chip>)}</div>
          )}
          {lockedNote && <p className="text-xs text-gray-400">{lockedNote}</p>}
          {!locked && c.recentRecommendations > 0 && (
            <p className="text-xs text-yellow-700">
              Recommended {c.recentRecommendations} {c.recentRecommendations === 1 ? 'time' : 'times'} in the last 30 days
            </p>
          )}
        </div>
      </label>
      {picked && (
        <div className="mt-3 ml-7">
          <label htmlFor={`note-${c.id}`} className="text-xs text-gray-500">Note to the member on why</label>
          <textarea
            id={`note-${c.id}`}
            rows={2}
            maxLength={MAX_NOTE_LENGTH}
            value={note ?? ''}
            onChange={e => onNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-700/30 resize-none"
          />
          <p className="text-[11px] text-gray-400 text-right tabular-nums">{(note ?? '').length} / {MAX_NOTE_LENGTH}</p>
        </div>
      )}
    </li>
  )
}

async function fetchDetail(memberId: string, offset: number): Promise<Detail> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(MATCHING_PAGE_SIZE) })
  const res = await fetch(`/api/admin/matching/${memberId}?${params}`).catch(() => null)
  const json = await res?.json().catch(() => null)
  if (!res?.ok || !json) throw new Error(json?.error ?? 'Could not load this member.')
  return json as Detail
}

function MemberMatching({ memberId, onSent }: { memberId: string; onSent: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [picks, setPicks] = useState<Map<string, string>>(new Map())
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const ticket = useRef(0)

  const load = useCallback(async () => {
    const mine = ++ticket.current
    setDetail(null)
    setError(null)
    try {
      const first = await fetchDetail(memberId, 0)
      if (mine === ticket.current) setDetail(first)
    } catch (err) {
      if (mine === ticket.current) setError(err instanceof Error ? err.message : 'Could not load this member.')
    }
  }, [memberId])

  useEffect(() => {
    setPicks(new Map())
    setResult(null)
    load()
  }, [load])

  const hasMore = Boolean(detail && detail.candidates.length < detail.total)
  const loadMore = useCallback(async () => {
    if (!detail || loadingMore) return
    const mine = ticket.current
    setLoadingMore(true)
    try {
      const next = await fetchDetail(memberId, detail.candidates.length)
      if (mine !== ticket.current) return
      setDetail(d => {
        if (!d) return d
        const seen = new Set(d.candidates.map(c => c.id))
        return { ...d, total: next.total, candidates: [...d.candidates, ...next.candidates.filter(c => !seen.has(c.id))] }
      })
    } catch {
      // The sentinel stays in view, so the next scroll tries again.
    } finally {
      setLoadingMore(false)
    }
  }, [detail, loadingMore, memberId])

  useLoadMore(sentinel, null, hasMore && !loadingMore, loadMore)

  function toggle(c: Candidate) {
    setResult(null)
    setPicks(prev => {
      const next = new Map(prev)
      if (next.has(c.id)) next.delete(c.id)
      else next.set(c.id, c.note)
      return next
    })
  }

  async function send() {
    setSending(true)
    setResult(null)
    const res = await fetch(`/api/admin/matching/${memberId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picks: [...picks].map(([candidateId, note]) => ({ candidateId, note })) }),
    }).catch(() => null)
    const json = await res?.json().catch(() => null)
    setSending(false)
    if (res?.ok) {
      const n = json?.sent ?? picks.size
      const who = detail?.member.firstName || 'The member'
      setResult({
        ok: true,
        text: `Sent ${n} ${n === 1 ? 'recommendation' : 'recommendations'}. ${who} and ${n === 1 ? 'the player' : 'each player'} get a push and an email.`,
      })
      setPicks(new Map())
      await load()
      onSent()
    } else {
      setResult({ ok: false, text: json?.error ?? 'Could not send. Please try again.' })
    }
  }

  if (error) {
    return (
      <AdminCard>
        <div className="py-10 text-center">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={load} className="btn btn-outline btn-sm mt-4">Try again</button>
        </div>
      </AdminCard>
    )
  }
  if (!detail) return <ContentLoader />

  const { member, candidates, total, ruledOut, sent } = detail
  const emptyNote = [...picks.values()].some(n => !n.trim())
  const memberFirstName = member.firstName || member.name

  return (
    <div className="space-y-4">
      <MemberSummaryCard member={member} />

      {!member.surveyCompleted ? (
        <AdminCard>
          <p className="text-sm text-gray-500 py-4 text-center">
            {memberFirstName} hasn&apos;t completed the matching survey yet. They&apos;ll be asked to the next time
            they open the app.
          </p>
        </AdminCard>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">
              Players who fit <span className="font-normal text-gray-400 tabular-nums">· {total}</span>
            </h2>
            <span className="text-xs text-gray-400">
              {ruledOut} ruled out by golf preferences
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-10 px-5 text-center">
              No one at {member.courseName ?? 'their course'} fits yet. Players appear here once they complete the survey.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-50">
                {candidates.map(c => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    memberFirstName={memberFirstName}
                    note={picks.get(c.id)}
                    picked={picks.has(c.id)}
                    disabled={!picks.has(c.id) && picks.size >= MAX_PICKS}
                    onToggle={() => toggle(c)}
                    onNote={text => setPicks(prev => new Map(prev).set(c.id, text))}
                  />
                ))}
              </ul>
              <div ref={sentinel} aria-hidden className="h-px" />
              {loadingMore && <LoadingMore />}
            </>
          )}
          <div className="sticky bottom-0 bg-white rounded-b-xl flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-t border-gray-100">
            <p className={cn('text-sm', result ? (result.ok ? 'text-green-700' : 'text-red-500') : 'text-gray-400')}>
              {result?.text ?? (picks.size >= MAX_PICKS ? `Up to ${MAX_PICKS} at a time.` : 'Tick a player, check the note, send.')}
            </p>
            <button
              type="button"
              onClick={send}
              disabled={picks.size === 0 || emptyNote || sending}
              className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Spinner className="w-4 h-4" /> : picks.size === 1 ? 'Send 1 recommendation' : `Send ${picks.size} recommendations`}
            </button>
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <AdminCard title="Already sent">
          <ul className="-my-2 divide-y divide-gray-50">
            {sent.map(s => (
              <li key={s.id} className="py-2.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{s.candidate.name}</p>
                  {s.note && <p className="text-xs text-gray-500 mt-0.5">{s.note}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-400">{shortDate(s.sentAt)}</span>
                  <Badge label={OUTCOME[s.outcome].label} colour={OUTCOME[s.outcome].colour} />
                </div>
              </li>
            ))}
          </ul>
        </AdminCard>
      )}
    </div>
  )
}

// ---- Page ---------------------------------------------------

export default function MatchingPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Matchmaking"
        description="Pick a member, choose who they should play with, and send it. Golf preferences are applied before anyone is listed."
      />
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] items-start">
        {/* Sticky on wide screens, so the queue stays put while a long list
            of candidates scrolls beside it. */}
        <div className={cn('lg:sticky lg:top-4', selectedId && 'hidden lg:block')}>
          <QueueList selectedId={selectedId} onSelect={setSelectedId} reloadKey={reloadKey} />
        </div>
        <div className={cn('min-w-0', !selectedId && 'hidden lg:block')}>
          {selectedId ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="lg:hidden inline-flex items-center gap-1.5 text-sm text-gray-500 mb-3"
              >
                <ArrowLeft className="w-4 h-4" /> Back to the queue
              </button>
              <MemberMatching memberId={selectedId} onSent={() => setReloadKey(k => k + 1)} />
            </>
          ) : (
            <AdminCard>
              <p className="text-sm text-gray-400 py-16 text-center">Choose a member to see who fits them.</p>
            </AdminCard>
          )}
        </div>
      </div>
    </div>
  )
}
