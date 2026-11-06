'use client'

// Golf preferences — the matching survey again, every section on one page,
// for a member changing their answers after the mandatory first run.

import { useCallback, useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ContentLoader } from '@/components/ui/Loading'
import MatchSurveyForm from '@/components/matching/MatchSurveyForm'
import type { SurveyAnswers } from '@/lib/matching/survey'

export default function MatchProfilePage() {
  const [answers, setAnswers] = useState<SurveyAnswers | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch('/api/match-survey').catch(() => null)
    const json = await res?.json().catch(() => null)
    if (!res?.ok || !json?.answers) {
      setError(json?.error ?? 'Could not load your answers.')
      return
    }
    setAnswers(json.answers)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <AppShell title="Golf Preferences" description="Who the LinkUp team matches you with">
      <div className="max-w-2xl mx-auto w-full px-5 pt-5 pb-10">
        {error ? (
          <div className="card card-pad text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={load} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        ) : answers ? (
          <MatchSurveyForm mode="page" initial={answers} onSaved={() => {}} />
        ) : (
          <ContentLoader />
        )}
      </div>
    </AppShell>
  )
}
