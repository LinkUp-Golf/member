'use client'

// Curated Introductions — optional. One switch, and below it, while it's on,
// the questions the LinkUp team introduces members from.
//
// A member who has answered before turns it on and off in place (PATCH): off
// takes them out of introductions both ways, and keeps their answers for when
// it's turned back on. A member who hasn't answered turns the switch on to see
// the questions, and saving them is what turns it on.

import { useCallback, useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ContentLoader } from '@/components/ui/Loading'
import MatchSurveyForm from '@/components/matching/MatchSurveyForm'
import type { SurveyAnswers } from '@/lib/matching/survey'

interface SurveyState {
  eligible: boolean
  completed: boolean
  enabled: boolean
  answers: SurveyAnswers
}

export default function CuratedIntroductionsPage() {
  const [state, setState] = useState<SurveyState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // On screen. For a member who hasn't answered yet it only opens the form.
  const [on, setOn] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await fetch('/api/match-survey').catch(() => null)
    const json = await res?.json().catch(() => null)
    if (!res?.ok || !json?.answers) {
      setLoadError(json?.error ?? 'Could not load your answers.')
      return
    }
    setState(json)
    setOn(json.enabled === true)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle() {
    if (!state || switching) return
    const next = !on
    setSwitchError(null)
    setOn(next)
    if (!state.completed) return

    setSwitching(true)
    try {
      const res = await fetch('/api/match-survey', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setOn(!next)
        setSwitchError(json.error ?? 'Could not change that. Please try again.')
        return
      }
      setState(s => (s ? { ...s, enabled: next } : s))
    } catch {
      setOn(!next)
      setSwitchError('Could not change that. Check your connection and try again.')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <AppShell title="Curated Introductions" description="Introductions from the LinkUp team">
      <div className="max-w-2xl mx-auto w-full px-5 pt-5 pb-10 space-y-6">
        {loadError ? (
          <div className="card card-pad text-center">
            <p className="text-sm text-red-500">{loadError}</p>
            <button onClick={load} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        ) : !state ? (
          <ContentLoader />
        ) : !state.eligible ? (
          <div className="card card-pad">
            <p className="text-sm text-green-900/60">Curated Introductions are for members of a LinkUp club.</p>
          </div>
        ) : (
          <>
            <div className="card px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="curated-introductions-switch" className="text-sm font-semibold text-green-950 cursor-pointer">
                  Turn on Curated Introductions
                </label>
                <button
                  id="curated-introductions-switch"
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={toggle}
                  disabled={switching}
                  className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative focus-ring disabled:opacity-60 ${
                    on ? 'bg-green-800' : 'bg-green-900/15'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    on ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
              {on && !state.completed && (
                <p className="text-xs text-green-900/55 mt-2">Answer the questions below and save to turn it on.</p>
              )}
              {switchError && <p className="text-xs text-red-500 mt-2">{switchError}</p>}
            </div>

            {/* Hidden rather than unmounted while off, so answers edited this
                visit survive switching it off and on again. */}
            <div hidden={!on}>
              <MatchSurveyForm
                initial={state.answers}
                onSaved={() => setState(s => (s ? { ...s, completed: true, enabled: true } : s))}
              />
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
