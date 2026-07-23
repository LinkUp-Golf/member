'use client'

// Lets a user with more than one workspace switch between them. The set of
// workspaces is derived from their roles: member (has a golf membership / home
// course), admin (is_admin), referral partner and host (own the respective
// row). Rendered in the host/partner shells so a non-member — who can't reach
// the member app's /more hub — can still move between the workspaces they hold.

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronsUpDown, Check, Home, ShieldCheck, BadgeDollarSign, Flag, type LucideIcon } from 'lucide-react'
import { useMemberRoles } from '@/hooks/useMemberRoles'
import { useProfile } from '@/hooks/useProfile'

export type WorkspaceKey = 'member' | 'admin' | 'partner' | 'host'

const META: Record<WorkspaceKey, { label: string; href: string; icon: LucideIcon }> = {
  member:  { label: 'Member portal', href: '/home',    icon: Home },
  admin:   { label: 'Admin',         href: '/admin',   icon: ShieldCheck },
  partner: { label: 'Your Referrals', href: '/partner', icon: BadgeDollarSign },
  host:    { label: 'Host',          href: '/host',    icon: Flag },
}

export default function WorkspaceSwitcher({ current }: { current: WorkspaceKey }) {
  const { isAdmin, isPartner, isHost } = useMemberRoles()
  const { profile } = useProfile()
  const isMember = !!profile?.home_course_id

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const available = ([
    isMember && 'member',
    isAdmin && 'admin',
    isPartner && 'partner',
    isHost && 'host',
  ].filter(Boolean) as WorkspaceKey[])

  const CurrentIcon = META[current].icon

  // With only the current workspace there's nothing to switch to — show a static
  // label so the header still reads which workspace you're in.
  if (available.filter(k => k !== current).length === 0) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-white">
        <CurrentIcon className="w-4 h-4 flex-shrink-0" strokeWidth={1.9} />
        <span className="text-sm font-semibold truncate">{META[current].label}</span>
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-white hover:bg-white/10 transition-colors"
      >
        <CurrentIcon className="w-4 h-4 flex-shrink-0" strokeWidth={1.9} />
        <span className="text-sm font-semibold truncate flex-1 text-left">{META[current].label}</span>
        <ChevronsUpDown className="w-4 h-4 flex-shrink-0 text-white/50" strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-56 rounded-xl bg-white shadow-xl border border-gray-100 py-1 z-50"
        >
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Switch workspace
          </p>
          {available.map(k => {
            const m = META[k]
            const ItemIcon = m.icon
            const active = k === current
            return (
              <Link
                key={k}
                href={m.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                  active ? 'text-green-800 font-medium' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <ItemIcon className="w-4 h-4 flex-shrink-0" strokeWidth={1.9} />
                <span className="flex-1 truncate">{m.label}</span>
                {active && <Check className="w-4 h-4 flex-shrink-0" strokeWidth={2.2} />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
