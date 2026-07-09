'use client'

// Reusable picker for linking existing members (multi-select) and non-members
// (by email) to a referral partner. Controlled: the parent owns the selection
// ({ memberIds, emails }); this component fetches the member list itself and
// renders chips + email entry + a searchable member list.

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface MemberOption {
  id: string
  first_name: string
  last_name: string
  email: string
  membership_status: string
}

export interface ReferralSelection {
  memberIds: string[]
  emails: string[]
}

export default function ReferralContactPicker({
  value,
  onChange,
  linkedEmails,
}: {
  value: ReferralSelection
  onChange: (next: ReferralSelection) => void
  linkedEmails?: Set<string>
}) {
  const [members, setMembers] = useState<MemberOption[]>([])
  const [search, setSearch] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)

  useEffect(() => {
    createClient()
      .from('members')
      .select('id, first_name, last_name, email, membership_status')
      .order('first_name')
      .then(({ data }) => setMembers((data ?? []) as MemberOption[]))
  }, [])

  const excluded = useMemo(() => linkedEmails ?? new Set<string>(), [linkedEmails])

  function toggleMember(memberId: string) {
    const memberIds = value.memberIds.includes(memberId)
      ? value.memberIds.filter(m => m !== memberId)
      : [...value.memberIds, memberId]
    onChange({ ...value, memberIds })
  }

  function addEmail(raw: string) {
    const e = raw.trim().toLowerCase()
    if (!e) return
    if (!EMAIL_RE.test(e)) { setEmailError('That email address is not valid.'); return }
    if (value.emails.includes(e) || excluded.has(e)) { setEmailInput(''); return }
    onChange({ ...value, emails: [...value.emails, e] })
    setEmailInput('')
    setEmailError(null)
  }

  function removeEmail(e: string) {
    onChange({ ...value, emails: value.emails.filter(x => x !== e) })
  }

  function onEmailKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault()
      addEmail(emailInput)
    }
  }

  const filteredMembers = members.filter(m => {
    if (excluded.has(m.email.toLowerCase())) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      {(value.memberIds.length > 0 || value.emails.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {value.memberIds.map(mid => {
            const m = members.find(x => x.id === mid)
            return (
              <button
                key={mid}
                type="button"
                onClick={() => toggleMember(mid)}
                className="flex items-center gap-1.5 bg-green-100 text-green-900 rounded-full px-3 py-1 text-xs font-medium"
              >
                {m ? `${m.first_name} ${m.last_name}` : 'Member'}
                <span className="text-green-900/50 text-base leading-none">×</span>
              </button>
            )
          })}
          {value.emails.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => removeEmail(e)}
              className="flex items-center gap-1.5 bg-blue-100 text-blue-900 rounded-full px-3 py-1 text-xs font-medium"
            >
              {e}
              <span className="text-blue-900/50 text-base leading-none">×</span>
            </button>
          ))}
        </div>
      )}

      {/* Non-member email entry */}
      <div>
        <label htmlFor="rp-email-input" className="block text-xs font-medium text-gray-600 mb-1">Add non-member by email</label>
        <div className="flex gap-2">
          <input
            id="rp-email-input"
            type="email"
            value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setEmailError(null) }}
            onKeyDown={onEmailKeyDown}
            placeholder="person@example.com  (Enter to add)"
            className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none bg-white"
          />
          <button
            type="button"
            onClick={() => addEmail(emailInput)}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200"
          >
            Add
          </button>
        </div>
        {emailError && <p className="mt-1 text-[11px] text-red-500">{emailError}</p>}
      </div>

      {/* Member picker */}
      <div>
        <label htmlFor="rp-member-search" className="block text-xs font-medium text-gray-600 mb-1">Select existing members</label>
        <input
          id="rp-member-search"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search members…"
          className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none bg-white mb-2"
        />
        <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
          {filteredMembers.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400 italic">No members found.</div>
          ) : filteredMembers.slice(0, 100).map(m => {
            const isSelected = value.memberIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-green-50/50 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 capitalize truncate">{m.first_name} {m.last_name}</p>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'border-green-800 bg-green-800' : 'border-gray-300'
                }`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
