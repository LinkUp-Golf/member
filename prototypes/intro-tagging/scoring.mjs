import { sectorOf } from './taxonomy.mjs'

// A tagged answer: { status: 'tagged'|'open'|'pending', industries, excludes, functions, seniority }.
// 'open' means the member said anyone. 'pending' means tagging hasn't succeeded yet:
// it earns a neutral half, so a failed call can't outrank a real match.
export const NEUTRAL = 0.5

export function industryFit(want, own) {
  if (want.status === 'pending' || own.status === 'pending') return NEUTRAL
  if (want.status === 'open') return 1
  const ownTags = own.industries ?? []
  if (ownTags.some(t => (want.excludes ?? []).includes(sectorOf(t)))) return 0
  const wanted = want.industries ?? []
  if (wanted.length === 0) return (want.excludes ?? []).length ? 1 : NEUTRAL
  if (ownTags.some(t => wanted.includes(t))) return 1
  const sectors = new Set(wanted.map(sectorOf))
  return ownTags.some(t => sectors.has(sectorOf(t))) ? 0.5 : 0
}

export function roleFit(want, own) {
  if (want.status === 'pending' || own.status === 'pending') return NEUTRAL
  if (want.status === 'open') return 1
  const parts = []
  if (want.functions?.length) parts.push((own.functions ?? []).some(f => want.functions.includes(f)) ? 1 : 0)
  if (want.seniority?.length) parts.push((own.seniority ?? []).some(s => want.seniority.includes(s)) ? 1 : 0)
  return parts.length ? Math.max(...parts) : NEUTRAL
}

export const directional = (a, b) => (industryFit(a.wantIndustry, b.ownIndustry) + roleFit(a.wantRole, b.ownRole)) / 2

// Geometric mean, like pairScore in src/lib/matching/rules.ts.
export const pairFit = (a, b) => Math.sqrt(directional(a, b) * directional(b, a))

export function rank(seeker, people) {
  return people.filter(p => p.id !== seeker.id)
    .map(p => ({ id: p.id, oneWay: directional(seeker, p), score: pairFit(seeker, p) }))
    .sort((x, y) => y.oneWay - x.oneWay || y.score - x.score)
}

// Did the seeker's expected people land in their top 3?
export function evaluate(people, fitsById) {
  return people.map(p => {
    const top = rank(p, people).slice(0, 3).map(r => r.id)
    const fits = fitsById[p.id] ?? []
    return { id: p.id, top, fits, hit: fits.some(f => top.includes(f)), allFound: fits.every(f => top.includes(f)) }
  })
}
