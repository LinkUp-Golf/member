'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { FEATURES } from '@/lib/features'
import { apiClient } from '@/lib/api-client'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { INDUSTRY_CATEGORIES, type IndustryCategory, type FocusLinkup } from '@/types'
import { format } from 'date-fns'

const MAX = 3
const STANDARD_CATEGORIES = INDUSTRY_CATEGORIES.filter(c => c !== 'Other')

interface Sub {
  id: string
  industry_focus: string
  custom_label: string | null
  status: 'pending' | 'approved' | 'declined'
}

export default function FocusLinkupsPage() {
  const { user } = useProfile()
  const router = useRouter()

  const [subs, setSubs] = useState<Sub[]>([])
  const [upcoming, setUpcoming] = useState<FocusLinkup[]>([])
  const [_loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Add custom group
  const [addingCustom, setAddingCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [savingCustom, setSavingCustom] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  // Edit custom group
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!FEATURES.FOCUS_LINKUPS) router.replace('/more')
  }, [router])

  useEffect(() => { if (user) loadData() }, [user])

  if (!FEATURES.FOCUS_LINKUPS) return null

  async function loadData() {
    const res = await apiClient.get<{ linkups: FocusLinkup[]; subscriptions: Sub[] }>('/api/focus-linkups')
    if (res.data) {
      setSubs(res.data.subscriptions)
      setUpcoming(res.data.linkups)
    }
    setLoading(false)
  }

  const standardSubs = subs.filter(s => s.industry_focus !== 'Other')
  const customSubs   = subs.filter(s => s.industry_focus === 'Other')
  const activeCount  = subs.filter(s => s.status !== 'declined').length
  const atMax        = activeCount >= MAX

  // ---- Standard category toggle ----
  async function toggleStandard(category: IndustryCategory) {
    if (toggling || savingCustom || savingEdit) return
    const existing = standardSubs.find(s => s.industry_focus === category)

    if (existing) {
      setToggling(category)
      await apiClient.delete('/api/focus-linkups/subscriptions', { industry_focus: category })
      setSubs(prev => prev.filter(s => !(s.industry_focus === category && !s.custom_label)))
      setToggling(null)
    } else {
      if (atMax) return
      setToggling(category)
      const res = await apiClient.post<{ id: string }>('/api/focus-linkups/subscriptions', { industry_focus: category })
      if (res.data) {
        setSubs(prev => [...prev, { id: res.data!.id, industry_focus: category, custom_label: null, status: 'approved' }])
      }
      setToggling(null)
    }
  }

  // ---- Add custom group (one term per entry) ----
  async function addCustomGroup() {
    const label = customInput.replace(/,/g, '').trim()
    if (!label || savingCustom) return
    setAddError(null)
    setSavingCustom(true)
    const res = await apiClient.post<{ id: string }>(
      '/api/focus-linkups/subscriptions',
      { industry_focus: 'Other', custom_label: label }
    )
    if (res.data) {
      setSubs(prev => [...prev, { id: res.data!.id, industry_focus: 'Other', custom_label: label, status: 'pending' }])
      setCustomInput('')
      // Keep form open so member can add another group in one flow
      setTimeout(() => customInputRef.current?.focus(), 50)
    } else {
      setAddError(res.error?.message ?? 'Something went wrong')
    }
    setSavingCustom(false)
  }

  function openAddCustom() {
    setAddingCustom(true)
    setAddError(null)
    setEditingId(null)
    setTimeout(() => customInputRef.current?.focus(), 50)
  }

  function closeAddCustom() {
    setAddingCustom(false)
    setCustomInput('')
    setAddError(null)
  }

  // ---- Edit custom group ----
  function startEdit(s: Sub) {
    setEditingId(s.id)
    setEditInput(s.custom_label ?? '')
    setEditError(null)
    setAddingCustom(false)
    setTimeout(() => editInputRef.current?.focus(), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditInput('')
    setEditError(null)
  }

  async function saveEdit() {
    const label = editInput.replace(/,/g, '').trim()
    if (!label || savingEdit || !editingId) return
    setEditError(null)
    setSavingEdit(true)
    const res = await apiClient.patch('/api/focus-linkups/subscriptions', { id: editingId, custom_label: label })
    if (!res.error) {
      setSubs(prev => prev.map(s => s.id === editingId ? { ...s, custom_label: label, status: 'pending' } : s))
      setEditingId(null)
      setEditInput('')
    } else {
      setEditError(res.error?.message ?? 'Something went wrong')
    }
    setSavingEdit(false)
  }

  // ---- Remove custom group ----
  async function removeCustomGroup(id: string) {
    if (removing) return
    setRemoving(id)
    if (editingId === id) cancelEdit()
    await apiClient.delete('/api/focus-linkups/subscriptions', { id })
    setSubs(prev => prev.filter(s => s.id !== id))
    setRemoving(null)
  }

  const pendingCount = customSubs.filter(s => s.status === 'pending').length

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Focus LinkUps</div>
            <div className="logo-subtitle">Manage notifications</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8">
        {/* Explainer */}
        <div className="card card-pad mb-5">
          <p className="text-sm text-green-900 leading-relaxed">
            Focus LinkUps are themed golf days designed to bring together members from specific industries.
            Subscribe to get notified 2 weeks and 1 week before days relevant to you. You can select up to {MAX} groups total.
          </p>
        </div>

        {/* ---- Standard categories ---- */}
        <div className="flex items-center justify-between mb-3">
          <p className="section-label">Industry groups</p>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            atMax ? 'bg-gold/15 text-yellow-800' : 'bg-green-50 text-green-900/50'
          }`}>
            {activeCount} / {MAX} selected
          </span>
        </div>

        {atMax && (
          <p className="text-xs text-green-900/50 mb-3 -mt-1">
            Maximum reached — remove a group to add another.
          </p>
        )}

        <div className="card mb-6">
          {STANDARD_CATEGORIES.map((cat, i) => {
            const isSubscribed = !!standardSubs.find(s => s.industry_focus === cat)
            const isToggling = toggling === cat
            const disabled = !isSubscribed && atMax

            return (
              <div
                key={cat}
                className={`flex items-center justify-between px-4 py-3.5 ${
                  i < STANDARD_CATEGORIES.length - 1 ? 'border-b border-green-900/08' : ''
                } ${disabled ? 'opacity-40' : ''}`}
              >
                <p className="text-sm text-green-900">{cat}</p>
                {isToggling ? (
                  <Spinner className="w-5 h-5 text-green-700 flex-shrink-0" />
                ) : (
                  <button
                    onClick={() => !disabled && toggleStandard(cat)}
                    disabled={disabled}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                      isSubscribed ? 'bg-green-800' : 'bg-green-900/15'
                    } ${disabled ? 'cursor-not-allowed' : ''}`}
                    role="switch"
                    aria-checked={isSubscribed}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      isSubscribed ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* ---- Custom groups ---- */}
        <div className="flex items-center justify-between mb-1">
          <p className="section-label">Custom groups</p>
          {pendingCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
              {pendingCount} awaiting review
            </span>
          )}
        </div>
        <p className="text-xs text-green-900/45 mb-3">
          Don&apos;t see your industry? Request a custom group — our team will review and approve it.
        </p>

        <div className="card mb-2">
          {customSubs.length === 0 && !addingCustom && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium text-green-900/50 mb-0.5">No custom groups yet</p>
              <p className="text-xs text-green-900/30">Add one below and we&apos;ll review it within 24 hours.</p>
            </div>
          )}

          {customSubs.map((s, i) => {
            const isEditing   = editingId === s.id
            const isRemoving  = removing === s.id
            const showBorder  = i < customSubs.length - 1 || addingCustom

            return (
              <div key={s.id} className={showBorder ? 'border-b border-green-900/08' : ''}>
                {isEditing ? (
                  <div className="px-4 py-3.5">
                    <p className="text-xs text-green-900/50 mb-2">Edit group name</p>
                    <input
                      ref={editInputRef}
                      className={`input text-sm w-full mb-1.5 ${editError ? 'border-red-300' : ''}`}
                      placeholder="e.g. Sports Technology"
                      value={editInput}
                      onChange={e => { setEditInput(e.target.value.replace(/,/g, '')); setEditError(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                    />
                    {editError && (
                      <p className="text-xs text-red-400 mb-2">{editError}</p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={cancelEdit} className="btn btn-outline btn-sm flex-1 justify-center" disabled={savingEdit}>
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={!editInput.trim() || savingEdit}
                        className="btn btn-primary btn-sm flex-1 justify-center disabled:opacity-50"
                      >
                        {savingEdit ? <Spinner className="w-4 h-4" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex-1 min-w-0">
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-full border font-medium ${
                        s.status === 'approved'
                          ? 'bg-green-50 text-green-900 border-green-900/10'
                          : s.status === 'declined'
                          ? 'bg-red-50 text-red-400 border-red-200 line-through'
                          : 'bg-yellow-50 text-yellow-800 border-yellow-200'
                      }`}>
                        {s.custom_label}
                      </span>
                      <StatusBadge status={s.status} />
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {!isRemoving && s.status !== 'declined' && (
                        <button
                          onClick={() => startEdit(s)}
                          className="text-green-900/30 hover:text-green-900/60 transition-colors"
                          aria-label="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                      )}
                      {isRemoving ? (
                        <Spinner className="w-4 h-4 text-green-900/40" />
                      ) : (
                        <button
                          onClick={() => removeCustomGroup(s.id)}
                          className="text-green-900/30 hover:text-red-400 transition-colors"
                          aria-label="Remove"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {addingCustom && (
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-sm font-medium text-green-900">What&apos;s your industry or focus area?</p>
                {!atMax && (
                  <p className="text-xs text-green-900/40">
                    {MAX - activeCount} slot{MAX - activeCount !== 1 ? 's' : ''} left
                  </p>
                )}
              </div>
              <p className="text-xs text-green-900/45 mb-2">Name it clearly — e.g. &ldquo;Sports Technology&rdquo; or &ldquo;Impact Investing&rdquo;</p>
              <input
                ref={customInputRef}
                className={`input text-sm w-full mb-1.5 ${addError ? 'border-red-300 focus:border-red-400' : ''}`}
                placeholder="e.g. Sports Technology"
                value={customInput}
                onChange={e => { setCustomInput(e.target.value.replace(/,/g, '')); setAddError(null) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') addCustomGroup()
                  if (e.key === 'Escape') closeAddCustom()
                }}
              />
              {addError && (
                <p className="text-xs text-red-400 mb-2">{addError}</p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={closeAddCustom}
                  className="btn btn-outline btn-sm flex-1 justify-center"
                  disabled={savingCustom}
                >
                  Done
                </button>
                <button
                  onClick={addCustomGroup}
                  disabled={!customInput.trim() || savingCustom || atMax}
                  className="btn btn-primary btn-sm flex-1 justify-center disabled:opacity-50"
                >
                  {savingCustom ? <Spinner className="w-4 h-4" /> : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>

        {!addingCustom && !editingId && (
          <button
            onClick={openAddCustom}
            disabled={atMax}
            className={`w-full py-3 rounded-xl border border-dashed border-green-900/20 transition-colors mb-6 text-center ${atMax ? 'opacity-40 cursor-not-allowed' : 'hover:bg-green-50'}`}
          >
            <p className="text-sm font-medium text-green-700">
              {atMax ? 'Group limit reached' : '+ Request a custom group'}
            </p>
            <p className="text-xs text-green-900/40 mt-0.5">
              {atMax ? 'Remove a group to add another' : "Not in the list? We'll review it."}
            </p>
          </button>
        )}

        {/* ---- Upcoming Focus LinkUps ---- */}
        <p className="section-label mb-3">Upcoming Focus LinkUps</p>
        {upcoming.length === 0 ? (
          <div
            className="rounded-2xl flex flex-col items-center text-center px-6 py-10"
            style={{ background: 'rgba(0,38,105,0.04)', border: '1.5px dashed rgba(0,38,105,0.12)' }}
          >
            <div className="text-3xl mb-3">⛳</div>
            <p className="font-sans font-black text-base text-green-900 mb-1">No upcoming dates yet</p>
            <p className="text-xs text-green-900/40 leading-relaxed max-w-xs">
              Focus LinkUp dates are scheduled throughout the season. Subscribe above to get notified when one relevant to your industry is announced.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(fl => (
              <div key={fl.id} className="card card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-green-900">{fl.title}</p>
                    <p className="text-xs text-green-900/50 mt-1">
                      {format(new Date(fl.focus_date + 'T12:00:00'), 'EEEE, MMMM d')} · {fl.tee_time.slice(0, 5)}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {fl.industry_focus.map(f => (
                        <span key={f} className="tag text-xs">{f}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/book?focusLinkup=${fl.id}&date=${fl.focus_date}`)}
                    className="btn btn-primary btn-sm flex-shrink-0"
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'declined' }) {
  if (status === 'approved') return <p className="text-xs text-green-700 mt-1.5">Approved</p>
  if (status === 'declined') return <p className="text-xs text-red-400 mt-1.5">Declined — you can remove this</p>
  return <p className="text-xs text-yellow-600 mt-1.5">Awaiting admin review</p>
}
