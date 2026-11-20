'use client'

// ============================================================
// The Curated Introductions form (src/lib/matching/survey.ts holds
// the questions), on /more/match-profile, in two steps:
//
//   1. Describe Yourself — your business, your golf, about you.
//   2. Describe Your Ideal Match — what you're looking for, who
//      you'd like to meet, who you'd like to play with.
//
// It's shown while Curated Introductions is on; submitting it is
// what turns it on the first time. Both steps share one set of
// answers, so going Back and forth loses nothing.
//
// The questions not marked optional are required: a preference can
// only be checked against an answer. Continue and Submit check the
// step's required questions and point at the first one missing.
// Blank preferred industries and roles mean any.
// ============================================================

import { useMemo, useRef, useState } from 'react'
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
  OTHER_INDUSTRY,
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
  type SurveyIndustry,
} from '@/lib/matching/survey'

type StepKey = 'yourself' | 'match'

const STEPS = [
  {
    key: 'yourself',
    title: 'Describe Yourself',
    intro: 'Your business, your golf and you. Other members are matched against these answers.',
  },
  {
    key: 'match',
    title: 'Describe Your Ideal Match',
    intro: 'Who you would like the LinkUp team to introduce you to.',
  },
] as const satisfies ReadonlyArray<{ key: StepKey; title: string; intro: string }>

/** An Other box switched on but left empty. */
const blankOther = (v: string | null) => v !== null && v.trim() === ''

/** Each step's required questions, in the order they're asked. `id` is the question's element. */
const REQUIRED: Record<StepKey, ReadonlyArray<{ id: string; message: string; missing: (a: SurveyAnswers) => boolean }>> = {
  yourself: [
    { id: 'survey-company-size', message: 'Choose your organization size.', missing: a => !a.company_size },
    { id: 'survey-industry', message: 'Name your industry, or choose one from the list.', missing: a => blankOther(a.industry_other) },
    { id: 'survey-play-times', message: 'Choose when you prefer to play.', missing: a => a.play_times.length === 0 },
    { id: 'survey-attitude', message: 'Choose your golf attitude.', missing: a => !a.attitude },
    { id: 'survey-skill', message: 'Choose your golf skill.', missing: a => !a.skill },
    { id: 'survey-does', message: 'Answer each question.', missing: a => HABITS.some(h => a[`does_${h.key}`] === null) },
  ],
  match: [
    { id: 'survey-goals', message: 'Choose at least one objective.', missing: a => a.goals.length === 0 },
    { id: 'survey-meet-industries', message: 'Name the other industry, or untick Other.', missing: a => blankOther(a.meet_industry_other) },
    { id: 'survey-meet-sizes', message: 'Choose a company size, or Any size.', missing: a => a.meet_company_sizes.length === 0 },
    { id: 'survey-pref-gender', message: 'Choose an answer.', missing: a => !a.pref_gender },
    { id: 'survey-pref-skill', message: 'Choose an answer.', missing: a => !a.pref_skill },
    { id: 'survey-pref-attitude', message: 'Choose an answer.', missing: a => !a.pref_attitude },
    { id: 'survey-minds', message: 'Answer each question.', missing: a => HABITS.some(h => a[`minds_${h.key}`] === null) },
  ],
}

const missingIn = (key: StepKey, a: SurveyAnswers) => REQUIRED[key].filter(r => r.missing(a))

/** "Any size" stands alone: choosing it clears the sizes, choosing a size clears it. */
function nextSizes(prev: PrefCompanySize[], next: PrefCompanySize[]): PrefCompanySize[] {
  const added = next.find(v => !prev.includes(v))
  if (added === 'any') return ['any']
  return next.filter(v => v !== 'any')
}

/** One of a list, as chips; tapping the chosen one clears it. */
function single<V extends string>(v: V[]): V | null {
  return v[v.length - 1] ?? null
}

/**
 * Scrolls the page's content area so `el` sits just under the header. The
 * header sticks to the top of that same area, so a plain scrollIntoView would
 * park `el` behind it.
 */
function scrollUnderHeader(el: HTMLElement | null, place: 'top' | 'middle') {
  if (!el) return
  const scroller = el.closest<HTMLElement>('.screen-content')
  if (!scroller) {
    el.scrollIntoView({ block: place === 'top' ? 'start' : 'center', behavior: 'smooth' })
    return
  }
  const header = scroller.querySelector<HTMLElement>('.top-bar')?.offsetHeight ?? 0
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const room = scroller.clientHeight - header
  const gap = place === 'top' ? 16 : Math.max(16, (room - el.offsetHeight) / 2)
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset - header - gap), behavior: 'smooth' })
}

// ---- Layout -------------------------------------------------

function Stepper({ step, firstDone, onSelect }: { step: number; firstDone: boolean; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Survey steps">
      <ol className="grid grid-cols-2 gap-2">
        {STEPS.map((s, i) => {
          const current = i === step
          const done = i === 0 && firstDone && !current
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'w-full h-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-ring',
                  current ? 'border-green-900 bg-white shadow-sm' : 'border-green-900/10 bg-white/60 hover:bg-white',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold',
                    current ? 'bg-green-900 text-gold' : done ? 'bg-green-100 text-green-900' : 'bg-green-900/[0.07] text-green-900/50',
                  )}
                >
                  {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-green-900/45">
                    Step {i + 1} of {STEPS.length}
                  </span>
                  <span className={cn('block text-[13px] font-semibold leading-snug', current ? 'text-green-950' : 'text-green-900/60')}>
                    {s.title}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** A heading inside a step. */
function Group({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div>
        <h3 className="section-label !mb-1">{title}</h3>
        {intro && <p className="text-xs text-green-900/55 leading-relaxed">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * One question. A labelled group rather than a fieldset: a legend lays out
 * differently from browser to browser, and the spacing has to match whether
 * or not there's a hint.
 */
function Question({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={error ? `${id}-error` : undefined}
      className="min-w-0"
    >
      <p id={`${id}-label`} className="text-sm font-semibold text-green-950 leading-snug">{label}</p>
      {hint && <p className="text-xs text-green-900/50 mt-1 leading-relaxed">{hint}</p>}
      <div className="mt-2.5">{children}</div>
      {error && <p id={`${id}-error`} className="text-xs font-medium text-red-500 mt-2">{error}</p>}
    </div>
  )
}

// ---- Inputs -------------------------------------------------

/** Short options as wrapping chips; several may be on. */
function Chips<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly Option<V>[]
  value: V[]
  onChange: (next: V[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}
            className={cn('chip focus-ring !text-[13px] max-w-full', on && 'active')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The "Other" chip's value. Never sent: the named industry travels as text. */
const OTHER_CHIP = '__other__'

/**
 * The survey's industries plus Other, which opens a box to name one the list
 * doesn't have. `other` is null while Other is off, and text (maybe empty)
 * while it's on.
 */
function IndustryPicker({
  id,
  multiple,
  values,
  other,
  onChange,
}: {
  id: string
  multiple: boolean
  values: SurveyIndustry[]
  other: string | null
  onChange: (values: SurveyIndustry[], other: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const options: readonly Option<SurveyIndustry | typeof OTHER_CHIP>[] = [
    ...INDUSTRY_OPTIONS,
    { value: OTHER_CHIP, label: OTHER_INDUSTRY.label },
  ]
  const selected: Array<SurveyIndustry | typeof OTHER_CHIP> = other !== null ? [...values, OTHER_CHIP] : values

  function pick(next: Array<SurveyIndustry | typeof OTHER_CHIP>) {
    const openingOther = other === null && next.includes(OTHER_CHIP)
    if (multiple) {
      onChange(next.filter((v): v is SurveyIndustry => v !== OTHER_CHIP), next.includes(OTHER_CHIP) ? (other ?? '') : null)
    } else {
      // One industry: the chip just tapped wins, and tapping it again clears it.
      const chosen = single(next)
      if (chosen === OTHER_CHIP) onChange([], other ?? '')
      else onChange(chosen ? [chosen] : [], null)
    }
    if (openingOther) requestAnimationFrame(() => input.current?.focus())
  }

  return (
    <>
      <Chips options={options} value={selected} onChange={pick} />
      {other !== null && (
        <input
          ref={input}
          id={`${id}-other`}
          type="text"
          value={other}
          maxLength={OTHER_INDUSTRY.maxLength}
          onChange={e => onChange(values, e.target.value)}
          placeholder="Name the industry"
          aria-label={multiple ? 'Other industry you would like to meet' : 'Your industry'}
          className="input mt-2.5"
        />
      )}
    </>
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
          // `relative` keeps the visually hidden radio inside the label. Without
          // it the radio is positioned against the page instead, sits outside
          // the scrolling content, and stretches the whole page past the app.
          <label
            key={o.value}
            className={cn(
              'relative flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors',
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
            <span className="text-sm text-green-950 leading-snug min-w-0">{o.label}</span>
          </label>
        )
      })}
    </div>
  )
}

function YesNo({ name, value, onChange }: { name: string; value: boolean | null; onChange: (next: boolean) => void }) {
  return (
    <div className="flex gap-2 flex-shrink-0" role="radiogroup">
      {([true, false] as const).map(v => (
        // `relative`: see Choice.
        <label key={String(v)} className="relative cursor-pointer">
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

/** The question above its answers on a phone, beside them from sm up — the same for every row. */
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
          <div key={q.key} className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-sm text-green-950 leading-snug min-w-0">{q.label}</span>
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
  /** The member has submitted it before, so this is an edit. */
  completed: boolean
  /** The survey was saved, and Curated Introductions is on. */
  onSaved: () => void
}

export default function MatchSurveyForm({ initial, completed, onSaved }: Props) {
  const [answers, setAnswers] = useState<SurveyAnswers>(initial)
  const [step, setStep] = useState(0)
  // A step's missing answers are pointed out once the member tries to leave it.
  const [checked, setChecked] = useState<Record<StepKey, boolean>>({ yourself: false, match: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const set = (patch: Partial<SurveyAnswers>) => {
    setAnswers(a => ({ ...a, ...patch }))
    setSaved(false)
  }

  const current = step === 0 ? STEPS[0] : STEPS[1]
  const key: StepKey = current.key
  const missing = useMemo(() => new Set(missingIn(key, answers).map(r => r.id)), [key, answers])
  const firstDone = useMemo(() => missingIn('yourself', answers).length === 0, [answers])
  const errorFor = (id: string) =>
    checked[key] && missing.has(id) ? REQUIRED[key].find(r => r.id === id)?.message ?? null : null

  function show(i: number) {
    setStep(i)
    setError(null)
    requestAnimationFrame(() => scrollUnderHeader(top.current, 'top'))
  }

  /** Whether a step is complete; if it isn't, says what's missing and goes to the first. */
  function check(k: StepKey): boolean {
    const gaps = missingIn(k, answers)
    if (gaps.length === 0) return true
    setChecked(c => ({ ...c, [k]: true }))
    const first = gaps[0]
    if (first) {
      requestAnimationFrame(() => scrollUnderHeader(document.getElementById(first.id), 'middle'))
    }
    return false
  }

  function next() {
    if (check('yourself')) show(1)
  }

  function select(i: number) {
    if (i === step) return
    if (i < step) show(i)
    else next()
  }

  async function submit() {
    if (!check('match')) return
    // Only reachable through Continue, but a gap on the first step would
    // otherwise come back from the server as a message about a page not shown.
    if (missingIn('yourself', answers).length > 0) {
      show(0)
      check('yourself')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/match-survey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // The form is only shown while the switch is on.
        body: JSON.stringify({
          ...answers,
          industry_other: answers.industry_other?.trim() || null,
          meet_industry_other: answers.meet_industry_other?.trim() || null,
          open_to_suggestions: true,
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

  return (
    <div ref={top} className="space-y-6">
      <Stepper step={step} firstDone={firstDone} onSelect={select} />

      <div>
        <h2 className="text-lg font-bold text-green-950">{current.title}</h2>
        <p className="text-xs text-green-900/55 leading-relaxed mt-1">{current.intro}</p>
      </div>

      {key === 'yourself' ? (
        <div className="space-y-8">
          <Group title="Your business">
            <Question id="survey-role" label="Your role" hint="Optional.">
              <Chips
                options={ROLES}
                value={answers.role ? [answers.role] : []}
                onChange={v => set({ role: single(v) })}
              />
            </Question>
            <Question id="survey-company-size" label="Organization size" error={errorFor('survey-company-size')}>
              <Chips
                options={COMPANY_SIZES}
                value={answers.company_size ? [answers.company_size] : []}
                onChange={v => set({ company_size: single(v) })}
              />
            </Question>
            <Question
              id="survey-industry"
              label="What industry is your business in?"
              hint="Optional. Choose Other to name one that isn't listed."
              error={errorFor('survey-industry')}
            >
              <IndustryPicker
                id="survey-industry"
                multiple={false}
                values={answers.industry ? [answers.industry] : []}
                other={answers.industry_other}
                onChange={(values, other) => set({ industry: values[0] ?? null, industry_other: other })}
              />
            </Question>
            <Question id="survey-client-sizes" label="What size of organizations do you serve?" hint="Optional. Choose as many as you like.">
              <Chips options={COMPANY_SIZES} value={answers.client_company_sizes} onChange={client_company_sizes => set({ client_company_sizes })} />
            </Question>
            <Question id="survey-offering" label="Describe your offering" hint="Optional. Shown on your profile.">
              <textarea
                id="survey-value-offered"
                aria-labelledby="survey-offering-label"
                rows={3}
                maxLength={1000}
                value={answers.value_offered ?? ''}
                onChange={e => set({ value_offered: e.target.value })}
                className={TEXTAREA}
              />
            </Question>
          </Group>

          <Group title="Your golf">
            <Question id="survey-play-times" label="When do you prefer to play?" hint="Choose either or both." error={errorFor('survey-play-times')}>
              <Chips options={PLAY_TIMES} value={answers.play_times} onChange={play_times => set({ play_times })} />
            </Question>
            <Question id="survey-attitude" label="What's your golf attitude?" error={errorFor('survey-attitude')}>
              <Choice name="survey-attitude-choice" options={ATTITUDES} value={answers.attitude} onChange={attitude => set({ attitude })} />
            </Question>
            <Question id="survey-skill" label="Golf skill" error={errorFor('survey-skill')}>
              <Choice name="survey-skill-choice" options={SKILLS} value={answers.skill} onChange={skill => set({ skill })} />
            </Question>
          </Group>

          <Group title="About you">
            <Question id="survey-gender" label="Your gender" hint="Optional.">
              <Chips
                options={GENDERS}
                value={answers.gender ? [answers.gender] : []}
                onChange={v => set({ gender: single(v) })}
              />
            </Question>
            <Question id="survey-does" label="Smoke, music and booze" error={errorFor('survey-does')}>
              <YesNoRows prefix="does" questions={HABITS.map(h => ({ key: h.key, label: h.does }))} answers={answers} set={set} />
            </Question>
          </Group>
        </div>
      ) : (
        <div className="space-y-8">
          <Group title="What you're looking for">
            <Question id="survey-goals" label="Objectives" hint="Choose as many as you like." error={errorFor('survey-goals')}>
              <Chips options={MATCH_GOALS} value={answers.goals} onChange={goals => set({ goals })} />
            </Question>
            <Question id="survey-seeking" label="Describe any solutions, services or resources you seek" hint="Optional. Shown on your profile.">
              <textarea
                id="survey-value-sought"
                aria-labelledby="survey-seeking-label"
                rows={3}
                maxLength={1000}
                value={answers.value_sought ?? ''}
                onChange={e => set({ value_sought: e.target.value })}
                className={TEXTAREA}
              />
            </Question>
          </Group>

          <Group title="Who you'd like to meet">
            <Question
              id="survey-meet-industries"
              label="Preferred industries"
              hint="Select specific industries or leave blank for any industry"
              error={errorFor('survey-meet-industries')}
            >
              <IndustryPicker
                id="survey-meet-industries"
                multiple
                values={answers.meet_industries}
                other={answers.meet_industry_other}
                onChange={(meet_industries, meet_industry_other) => set({ meet_industries, meet_industry_other })}
              />
            </Question>
            <Question id="survey-meet-roles" label="Preferred roles" hint="Select specific roles or leave blank for any role">
              <Chips options={ROLES} value={answers.meet_roles} onChange={meet_roles => set({ meet_roles })} />
            </Question>
            <Question
              id="survey-meet-sizes"
              label="Preferred company size"
              hint="Choose as many as you like, or Any size."
              error={errorFor('survey-meet-sizes')}
            >
              <Chips
                options={PREF_COMPANY_SIZES}
                value={answers.meet_company_sizes}
                onChange={v => set({ meet_company_sizes: nextSizes(answers.meet_company_sizes, v) })}
              />
            </Question>
          </Group>

          <Group title="Who you'd like to play with" intro={`${GOLF_PREFERENCES_PROMPT}.`}>
            <Question id="survey-pref-gender" label="Do you have a gender preference?" error={errorFor('survey-pref-gender')}>
              <Choice name="survey-pref-gender-choice" options={PREF_GENDERS} value={answers.pref_gender} onChange={pref_gender => set({ pref_gender })} />
            </Question>
            <Question id="survey-pref-skill" label="Do you have a skill level preference?" error={errorFor('survey-pref-skill')}>
              <Choice name="survey-pref-skill-choice" options={PREF_SKILLS} value={answers.pref_skill} onChange={pref_skill => set({ pref_skill })} />
            </Question>
            <Question id="survey-pref-attitude" label="Do you have a golf attitude preference?" error={errorFor('survey-pref-attitude')}>
              <Choice name="survey-pref-attitude-choice" options={PREF_ATTITUDES} value={answers.pref_attitude} onChange={pref_attitude => set({ pref_attitude })} />
            </Question>
            <Question id="survey-minds" label="Smoke, music and booze" error={errorFor('survey-minds')}>
              <YesNoRows prefix="minds" questions={HABITS.map(h => ({ key: h.key, label: h.minds }))} answers={answers} set={set} />
            </Question>
          </Group>
        </div>
      )}

      <div className="space-y-3 pt-2">
        {checked[key] && missing.size > 0 && (
          <p className="text-xs text-red-500">Answer the questions marked above to {step === 0 ? 'continue' : 'submit'}.</p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {saved && step === STEPS.length - 1 && (
          <p className="text-sm text-green-800 font-medium">Saved. Curated Introductions is on.</p>
        )}
        <div className="flex gap-3">
          {step > 0 && (
            <button type="button" onClick={() => show(step - 1)} className="btn btn-outline flex-1">
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} className="btn btn-gold flex-1">
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="btn btn-gold flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Spinner className="w-4 h-4" /> : saved ? 'Saved' : completed ? 'Save changes' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
