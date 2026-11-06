'use client'

// ============================================================
// The matching survey form (src/lib/matching/survey.ts holds the
// questions). Two ways in:
//
//   gate — the mandatory first run, one step at a time, inside
//          MatchSurveyGate. No way out but through: the admin's
//          candidate list is built from these answers.
//   page — /more/match-profile, every section on one page, for
//          changing answers later.
//
// Every pick-list is required; the free text and the handicap are
// not. Nothing is sent until the last step, so a member who closes
// the app halfway meets the gate again with a fresh form.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Spinner } from '@/components/ui/Loading'
import { cn } from '@/lib/utils'
import { INDUSTRY_CATEGORIES } from '@/types'
import { formatNonprofits, MAX_NONPROFITS, parseNonprofits } from '@/lib/profile/nonprofits'
import {
  ATTITUDES,
  COMPANY_SIZES,
  GENDERS,
  GOLF_PREFERENCES_PROMPT,
  HABITS,
  MATCH_GOALS,
  MAX_GOALS,
  PLAY_TIMES,
  PREF_ATTITUDES,
  PREF_GENDERS,
  PREF_SKILLS,
  type Option,
  type SurveyAnswers,
} from '@/lib/matching/survey'

const INDUSTRY_OPTIONS: Option[] = INDUSTRY_CATEGORIES.map(c => ({ value: c, label: c }))

type StepKey = 'connect' | 'business' | 'golf' | 'you' | 'prefs' | 'consent'

const STEPS: Array<{ key: StepKey; title: string; intro?: string }> = [
  { key: 'connect',  title: 'What you want from LinkUp' },
  { key: 'business', title: 'Your business' },
  { key: 'golf',     title: 'How you play' },
  {
    key: 'you',
    title: 'About you',
    intro: 'Other members can say who they would rather not play with. These answers are how we respect that. They are never shown on your profile.',
  },
  { key: 'prefs',    title: 'Golf preferences', intro: `${GOLF_PREFERENCES_PROMPT}.` },
  { key: 'consent',  title: 'Last step' },
]

/** Whether every required answer on a step is in. */
function stepComplete(key: StepKey, a: SurveyAnswers): boolean {
  switch (key) {
    case 'connect':
      return a.goals.length > 0 && a.goals.length <= MAX_GOALS && a.meet_industries.length > 0
    case 'business':
      return a.company_size !== null
    case 'golf':
      return a.play_times.length > 0 && a.attitude !== null
    case 'you':
      return a.gender !== null && HABITS.every(h => a[`does_${h.key}`] !== null)
    case 'prefs':
      return a.pref_gender !== null && a.pref_skill !== null && a.pref_attitude !== null
        && HABITS.every(h => a[`minds_${h.key}`] !== null)
    case 'consent':
      return true
  }
}

// ---- Inputs -------------------------------------------------

function Question({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-0 p-0 m-0 min-w-0">
      <legend className="text-sm font-semibold text-green-950 mb-1">{label}</legend>
      {hint && <p className="text-xs text-green-900/50 mb-2.5">{hint}</p>}
      {!hint && <div className="h-1.5" />}
      {children}
    </fieldset>
  )
}

/** Short options as wrapping chips; several may be on. */
function Chips<V extends string>({
  options,
  value,
  onChange,
  max,
}: {
  options: readonly Option<V>[]
  value: V[]
  onChange: (next: V[]) => void
  max?: number
}) {
  const full = max !== undefined && value.length >= max
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}
            className={cn('chip focus-ring !text-[13px] disabled:opacity-40 disabled:cursor-not-allowed', on && 'active')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** One of a list; long labels, so stacked rows rather than chips. */
function Choice<V extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: readonly Option<V>[]
  value: V | null
  onChange: (next: V) => void
}) {
  return (
    <div className="space-y-2">
      {options.map(o => {
        const on = value === o.value
        return (
          <label
            key={o.value}
            className={cn(
              'flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors',
              on ? 'border-green-900 bg-green-50' : 'border-green-900/10 bg-white hover:bg-green-50/50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-green-700',
                on ? 'border-green-900 bg-green-900' : 'border-green-900/30',
              )}
            >
              {on && <Check className="w-2.5 h-2.5 text-gold" strokeWidth={3.5} />}
            </span>
            <span className="text-sm text-green-950 leading-snug">{o.label}</span>
          </label>
        )
      })}
    </div>
  )
}

function YesNo({ name, value, onChange }: { name: string; value: boolean | null; onChange: (next: boolean) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup">
      {([true, false] as const).map(v => (
        <label key={String(v)} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            checked={value === v}
            onChange={() => onChange(v)}
            className="peer sr-only"
          />
          <span className={cn(
            'chip !text-[13px] !px-5 inline-block peer-focus-visible:ring-2 peer-focus-visible:ring-green-700',
            value === v && 'active',
          )}>
            {v ? 'Yes' : 'No'}
          </span>
        </label>
      ))}
    </div>
  )
}

function YesNoRows({
  prefix,
  questions,
  answers,
  set,
}: {
  prefix: 'does' | 'minds'
  questions: ReadonlyArray<{ key: string; label: string }>
  answers: SurveyAnswers
  set: (patch: Partial<SurveyAnswers>) => void
}) {
  return (
    <div className="divide-y divide-green-900/[0.07] rounded-xl border border-green-900/10 bg-white">
      {questions.map(q => {
        const field = `${prefix}_${q.key}` as keyof SurveyAnswers
        return (
          <div key={q.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-3">
            <span className="text-sm text-green-950 leading-snug min-w-0 flex-1 basis-56">{q.label}</span>
            <YesNo
              name={field}
              value={answers[field] as boolean | null}
              onChange={v => set({ [field]: v } as Partial<SurveyAnswers>)}
            />
          </div>
        )
      })}
    </div>
  )
}

const TEXTAREA = 'input resize-none'

// ---- The form -----------------------------------------------

interface Props {
  initial: SurveyAnswers
  mode: 'gate' | 'page'
  /** The survey was saved. */
  onSaved: () => void
}

export default function MatchSurveyForm({ initial, mode, onSaved }: Props) {
  const [answers, setAnswers] = useState<SurveyAnswers>(initial)
  const [handicapText, setHandicapText] = useState(initial.handicap_index === null ? '' : String(initial.handicap_index))
  const [nonprofitsText, setNonprofitsText] = useState(formatNonprofits(initial.nonprofits))
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Each step opens at its top, and its title is where focus lands.
  useEffect(() => {
    if (mode !== 'gate') return
    root.current?.closest('[data-scroll-root]')?.scrollTo({ top: 0 })
    root.current?.querySelector<HTMLElement>('#match-survey-title')?.focus()
  }, [step, mode])

  const set = (patch: Partial<SurveyAnswers>) => {
    setAnswers(a => ({ ...a, ...patch }))
    setSaved(false)
  }

  const tooManyNonprofits = parseNonprofits(nonprofitsText).length > MAX_NONPROFITS
  const allComplete = useMemo(() => STEPS.every(s => stepComplete(s.key, answers)), [answers])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/match-survey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...answers,
          handicap_index: handicapText.trim() === '' ? null : handicapText.trim(),
          // Raw text: the server parses it with the profile page's rules.
          nonprofits: nonprofitsText,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not save your answers. Please try again.')
        return
      }
      setSaved(true)
      onSaved()
    } catch {
      setError('Could not save your answers. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  function section(key: StepKey) {
    switch (key) {
      case 'connect':
        return (
          <>
            <Question label="What do you want from LinkUp connections?" hint={`Choose up to ${MAX_GOALS}.`}>
              <Chips options={MATCH_GOALS} value={answers.goals} max={MAX_GOALS} onChange={goals => set({ goals })} />
            </Question>
            <Question label="Who would you most like to meet?" hint="Choose any industries.">
              <Chips options={INDUSTRY_OPTIONS} value={answers.meet_industries} onChange={v => set({ meet_industries: v as SurveyAnswers['meet_industries'] })} />
            </Question>
          </>
        )
      case 'business':
        return (
          <>
            <Question label="How big is your company?">
              <Chips
                options={COMPANY_SIZES}
                value={answers.company_size ? [answers.company_size] : []}
                onChange={v => set({ company_size: v[v.length - 1] ?? null })}
              />
            </Question>
            {/* Two questions, not one: a single block of industries followed
                by a row of headcounts read as options unrelated to the ask. */}
            <Question label="What industries are your best clients in?" hint="Optional. Choose any.">
              <Chips options={INDUSTRY_OPTIONS} value={answers.client_industries} onChange={v => set({ client_industries: v as SurveyAnswers['client_industries'] })} />
            </Question>
            <Question label="How big are your best clients' companies?" hint="Optional. Choose any.">
              <Chips options={COMPANY_SIZES} value={answers.client_company_sizes} onChange={client_company_sizes => set({ client_company_sizes })} />
            </Question>
            <Question label="What you offer" hint="Optional. Shown on your profile.">
              <textarea
                id="survey-value-offered"
                rows={3}
                maxLength={1000}
                value={answers.value_offered ?? ''}
                onChange={e => set({ value_offered: e.target.value })}
                className={TEXTAREA}
              />
            </Question>
            <Question label="What you're looking for" hint="Optional. Shown on your profile.">
              <textarea
                id="survey-value-sought"
                rows={3}
                maxLength={1000}
                value={answers.value_sought ?? ''}
                onChange={e => set({ value_sought: e.target.value })}
                className={TEXTAREA}
              />
            </Question>
          </>
        )
      case 'golf':
        return (
          <>
            <Question label="When do you usually play?" hint="Choose any.">
              <Chips options={PLAY_TIMES} value={answers.play_times} onChange={play_times => set({ play_times })} />
            </Question>
            <Question label="What's your golf attitude?">
              <Choice name="survey-attitude" options={ATTITUDES} value={answers.attitude} onChange={attitude => set({ attitude })} />
            </Question>
            <Question label="Handicap index" hint="Optional. Leave it blank if you don't have one yet.">
              <input
                id="survey-handicap"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="-10"
                max="54"
                value={handicapText}
                onChange={e => { setHandicapText(e.target.value); setSaved(false) }}
                className="input max-w-[10rem]"
              />
            </Question>
            <Question label="Outside golf" hint="Optional. Your hobbies, and up to 3 non-profits you support, one per line.">
              <div className="space-y-2.5">
                <textarea
                  id="survey-hobbies"
                  rows={2}
                  maxLength={1000}
                  placeholder="Hobbies"
                  value={answers.non_golf_hobbies ?? ''}
                  onChange={e => set({ non_golf_hobbies: e.target.value })}
                  className={TEXTAREA}
                />
                <textarea
                  id="survey-nonprofits"
                  rows={3}
                  placeholder="Non-profits, one per line"
                  value={nonprofitsText}
                  onChange={e => { setNonprofitsText(e.target.value); setSaved(false) }}
                  className={TEXTAREA}
                />
                {tooManyNonprofits && (
                  <p className="text-xs text-red-500">List up to {MAX_NONPROFITS} non-profits.</p>
                )}
              </div>
            </Question>
          </>
        )
      case 'you':
        return (
          <>
            <Question label="Your gender">
              <Chips
                options={GENDERS}
                value={answers.gender ? [answers.gender] : []}
                onChange={v => set({ gender: v[v.length - 1] ?? null })}
              />
            </Question>
            <Question label="Smoke, music and booze">
              <YesNoRows prefix="does" questions={HABITS.map(h => ({ key: h.key, label: h.does }))} answers={answers} set={set} />
            </Question>
          </>
        )
      case 'prefs':
        return (
          <>
            <Question label="Do you have a gender preference?">
              <Choice name="survey-pref-gender" options={PREF_GENDERS} value={answers.pref_gender} onChange={pref_gender => set({ pref_gender })} />
            </Question>
            <Question label="Do you have a skill level preference?">
              <Choice name="survey-pref-skill" options={PREF_SKILLS} value={answers.pref_skill} onChange={pref_skill => set({ pref_skill })} />
            </Question>
            <Question label="Do you have a golf attitude preference?">
              <Choice name="survey-pref-attitude" options={PREF_ATTITUDES} value={answers.pref_attitude} onChange={pref_attitude => set({ pref_attitude })} />
            </Question>
            <Question label="Smoke, music and booze">
              <YesNoRows prefix="minds" questions={HABITS.map(h => ({ key: h.key, label: h.minds }))} answers={answers} set={set} />
            </Question>
          </>
        )
      case 'consent':
        return (
          <div className="rounded-xl border border-green-900/10 bg-white px-3.5 py-3.5">
            <label htmlFor="survey-open-to-suggestions" className="flex items-start gap-3 cursor-pointer">
              <input
                id="survey-open-to-suggestions"
                type="checkbox"
                checked={answers.open_to_suggestions}
                onChange={e => set({ open_to_suggestions: e.target.checked })}
                aria-describedby="survey-open-to-suggestions-help"
                className="mt-0.5 w-4 h-4 rounded accent-green-800 flex-shrink-0"
              />
              <span className="text-sm font-semibold text-green-950">Suggest me to other members</span>
            </label>
            <p id="survey-open-to-suggestions-help" className="text-xs text-green-900/55 mt-1 ml-7 leading-relaxed">
              The LinkUp team reads your answers and recommends people for you to play with. With this on,
              they can also recommend you to other members. Your golf preferences and the answers about
              you are never shown to other members.
            </p>
          </div>
        )
    }
  }

  // ---- page: every section, one save ---------------------------
  if (mode === 'page') {
    return (
      <div className="space-y-8">
        {STEPS.map(s => (
          <section key={s.key} className="space-y-5">
            <div>
              <p className="section-label !mb-1">{s.title}</p>
              {s.intro && <p className="text-xs text-green-900/55 leading-relaxed">{s.intro}</p>}
            </div>
            {section(s.key)}
          </section>
        ))}
        <div className="space-y-2">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!allComplete && <p className="text-xs text-green-900/50">Answer every question that isn&apos;t marked optional to save.</p>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !allComplete || tooManyNonprofits}
            className="btn btn-gold btn-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Spinner className="w-4 h-4" /> : saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </div>
    )
  }

  // ---- gate: one step at a time --------------------------------
  const current = STEPS[step]
  if (!current) return null
  const last = step === STEPS.length - 1
  const canContinue = stepComplete(current.key, answers) && !(current.key === 'golf' && tooManyNonprofits)

  return (
    <div ref={root} className="flex flex-col min-h-full">
      <div className="px-5 pt-6 pb-4">
        <p className="section-label !mb-1">Your networking profile · Step {step + 1} of {STEPS.length}</p>
        <div className="flex gap-1 mt-2" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.key} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-green-800' : 'bg-green-900/10')} />
          ))}
        </div>
        <h2 id="match-survey-title" tabIndex={-1} className="text-lg font-bold text-green-950 mt-4 focus:outline-none">{current.title}</h2>
        {current.intro && <p className="text-sm text-green-900/60 mt-1 leading-relaxed">{current.intro}</p>}
        {step === 0 && (
          <p className="text-sm text-green-900/60 mt-1 leading-relaxed">
            A few questions so the LinkUp team can match you with the right people to play with. It takes
            about 3 minutes, and you can change your answers any time from More.
          </p>
        )}
      </div>

      <div className="px-5 pb-6 space-y-6 flex-1">{section(current.key)}</div>

      <div className="sticky bottom-0 bg-white border-t border-green-900/[0.07] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} disabled={saving} className="btn btn-outline flex-shrink-0">
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? save() : setStep(step + 1))}
            disabled={!canContinue || saving}
            className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Spinner className="w-4 h-4" /> : last ? 'Finish' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
