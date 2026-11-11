'use client'

// ============================================================
// The Curated Introductions form (src/lib/matching/survey.ts holds
// the questions), every section on one page, on /more/match-profile.
// It's shown while Curated Introductions is on; saving it is what
// turns it on the first time.
//
// The questions not marked optional are required: a preference can
// only be checked against an answer. Blank preferred industries and
// roles mean any.
// ============================================================

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Spinner } from '@/components/ui/Loading'
import { cn } from '@/lib/utils'
import {
  ATTITUDES,
  COMPANY_SIZES,
  GENDERS,
  GOLF_PREFERENCES_PROMPT,
  HABITS,
  INDUSTRY_OPTIONS,
  MATCH_GOALS,
  MAX_GOALS,
  PLAY_TIMES,
  PREF_ATTITUDES,
  PREF_COMPANY_SIZES,
  PREF_GENDERS,
  PREF_SKILLS,
  ROLES,
  SKILLS,
  type Option,
  type PrefCompanySize,
  type SurveyAnswers,
} from '@/lib/matching/survey'

type SectionKey = 'connect' | 'business' | 'golf' | 'you' | 'prefs'

const SECTIONS: Array<{ key: SectionKey; title: string; intro?: string }> = [
  { key: 'connect',  title: 'Curated Introduction Preferences' },
  { key: 'business', title: 'Describe your business' },
  { key: 'golf',     title: 'Describe yourself as a golfer' },
  { key: 'you',      title: 'About you', intro: 'Tell us about yourself.' },
  { key: 'prefs',    title: 'Preferred introductions', intro: `${GOLF_PREFERENCES_PROMPT}.` },
]

/** Whether every required answer in a section is in. */
function sectionComplete(key: SectionKey, a: SurveyAnswers): boolean {
  switch (key) {
    case 'connect':
      return a.goals.length > 0 && a.goals.length <= MAX_GOALS && a.meet_company_sizes.length > 0
    case 'business':
      return a.company_size !== null
    case 'golf':
      return a.play_times.length > 0 && a.attitude !== null && a.skill !== null
    case 'you':
      return HABITS.every(h => a[`does_${h.key}`] !== null)
    case 'prefs':
      return a.pref_gender !== null && a.pref_skill !== null && a.pref_attitude !== null
        && HABITS.every(h => a[`minds_${h.key}`] !== null)
  }
}

/** One of a list, as chips; tapping the chosen one clears it. */
function single<V extends string>(v: V[]): V | null {
  return v[v.length - 1] ?? null
}

/** "Any size" stands alone: choosing it clears the sizes, choosing a size clears it. */
function nextSizes(prev: PrefCompanySize[], next: PrefCompanySize[]): PrefCompanySize[] {
  const added = next.find(v => !prev.includes(v))
  if (added === 'any') return ['any']
  return next.filter(v => v !== 'any')
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
  /** The survey was saved, and Curated Introductions is on. */
  onSaved: () => void
}

export default function MatchSurveyForm({ initial, onSaved }: Props) {
  const [answers, setAnswers] = useState<SurveyAnswers>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = (patch: Partial<SurveyAnswers>) => {
    setAnswers(a => ({ ...a, ...patch }))
    setSaved(false)
  }

  const allComplete = useMemo(() => SECTIONS.every(s => sectionComplete(s.key, answers)), [answers])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/match-survey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // The form is only shown while the switch is on.
        body: JSON.stringify({ ...answers, open_to_suggestions: true }),
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

  function section(key: SectionKey) {
    switch (key) {
      case 'connect':
        return (
          <>
            <Question label="Objectives" hint={`Choose up to ${MAX_GOALS}.`}>
              <Chips options={MATCH_GOALS} value={answers.goals} max={MAX_GOALS} onChange={goals => set({ goals })} />
            </Question>
            <Question label="Preferred industries" hint="Select specific industries or leave blank for any industry">
              <Chips options={INDUSTRY_OPTIONS} value={answers.meet_industries} onChange={meet_industries => set({ meet_industries })} />
            </Question>
            <Question label="Preferred roles" hint="Select specific roles or leave blank for any role">
              <Chips options={ROLES} value={answers.meet_roles} onChange={meet_roles => set({ meet_roles })} />
            </Question>
            <Question label="Ideal company size" hint="Choose any, or Any size.">
              <Chips
                options={PREF_COMPANY_SIZES}
                value={answers.meet_company_sizes}
                onChange={v => set({ meet_company_sizes: nextSizes(answers.meet_company_sizes, v) })}
              />
            </Question>
          </>
        )
      case 'business':
        return (
          <>
            <Question label="Organization size">
              <Chips
                options={COMPANY_SIZES}
                value={answers.company_size ? [answers.company_size] : []}
                onChange={v => set({ company_size: single(v) })}
              />
            </Question>
            <Question label="What industry is your business in?" hint="Optional.">
              <Chips
                options={INDUSTRY_OPTIONS}
                value={answers.industry ? [answers.industry] : []}
                onChange={v => set({ industry: single(v) })}
              />
            </Question>
            <Question label="Your role" hint="Optional.">
              <Chips
                options={ROLES}
                value={answers.role ? [answers.role] : []}
                onChange={v => set({ role: single(v) })}
              />
            </Question>
            <Question label="What size of organizations do you serve?" hint="Optional. Choose any.">
              <Chips options={COMPANY_SIZES} value={answers.client_company_sizes} onChange={client_company_sizes => set({ client_company_sizes })} />
            </Question>
            <Question label="Describe your offering" hint="Optional. Shown on your profile.">
              <textarea
                id="survey-value-offered"
                rows={3}
                maxLength={1000}
                value={answers.value_offered ?? ''}
                onChange={e => set({ value_offered: e.target.value })}
                className={TEXTAREA}
              />
            </Question>
            <Question label="Describe any solutions, services or resources you seek" hint="Optional. Shown on your profile.">
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
            <Question label="When do you prefer to play?" hint="Choose any.">
              <Chips options={PLAY_TIMES} value={answers.play_times} onChange={play_times => set({ play_times })} />
            </Question>
            <Question label="What's your golf attitude?">
              <Choice name="survey-attitude" options={ATTITUDES} value={answers.attitude} onChange={attitude => set({ attitude })} />
            </Question>
            <Question label="Golf Skill">
              <Choice name="survey-skill" options={SKILLS} value={answers.skill} onChange={skill => set({ skill })} />
            </Question>
          </>
        )
      case 'you':
        return (
          <>
            <Question label="Your gender" hint="Optional.">
              <Chips
                options={GENDERS}
                value={answers.gender ? [answers.gender] : []}
                onChange={v => set({ gender: single(v) })}
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
    }
  }

  return (
    <div className="space-y-8">
      {SECTIONS.map(s => (
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
          disabled={saving || !allComplete}
          className="btn btn-gold btn-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Spinner className="w-4 h-4" /> : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
