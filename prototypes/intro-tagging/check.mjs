// No API call. Checks the labels are valid and the scoring finds the right people
// when tagging is perfect: the ceiling a real run can be compared against.
import { NICHES, NICHE_SET, FUNCTION_SET, SENIORITY_SET, SECTORS } from './taxonomy.mjs'
import { PERSONAS, EDGE_CASES } from './samples.mjs'
import { evaluate, industryFit } from './scoring.mjs'

const bad = []
const FIELDS = ['ownIndustry', 'ownRole', 'wantIndustry', 'wantRole']
for (const p of PERSONAS) {
  for (const f of FIELDS) {
    const g = p[f].gold
    for (const t of g.industries ?? []) if (!NICHE_SET.has(t)) bad.push(`${p.id}.${f}: ${t}`)
    for (const t of g.functions ?? []) if (!FUNCTION_SET.has(t)) bad.push(`${p.id}.${f}: ${t}`)
    for (const t of g.seniority ?? []) if (!SENIORITY_SET.has(t)) bad.push(`${p.id}.${f}: ${t}`)
    for (const t of g.excludes ?? []) if (!SECTORS[t]) bad.push(`${p.id}.${f}: ${t}`)
  }
  for (const id of p.fits) if (!PERSONAS.some(x => x.id === id)) bad.push(`${p.id}.fits: ${id}`)
}

const toTagged = g => ({ status: 'tagged', industries: g.industries ?? [], excludes: g.excludes ?? [], functions: g.functions ?? [], seniority: g.seniority ?? [] })
const people = PERSONAS.map(p => ({ id: p.id, ...Object.fromEntries(FIELDS.map(f => [f, toTagged(p[f].gold)])) }))
const results = evaluate(people, Object.fromEntries(PERSONAS.map(p => [p.id, p.fits])))

const pending = industryFit({ status: 'pending' }, people[0].ownIndustry)
const answers = PERSONAS.length * FIELDS.length + EDGE_CASES.length
console.log(`${Object.keys(SECTORS).length} sectors, ${NICHES.length} niches, ${answers} sample answers`)
console.log(`invalid labels: ${bad.length}`); bad.forEach(b => console.log('  ' + b))
console.log(`pending answer scores neutral: ${pending === 0.5}`)
console.log(`perfect tags: ${results.filter(r => r.hit).length}/${results.length} seekers have an expected person in top 3; ${results.filter(r => r.allFound).length}/${results.length} have all of them`)
results.filter(r => !r.allFound).forEach(r => console.log(`  ${r.id}: expected ${r.fits.join(', ')}; top 3 ${r.top.join(', ')}`))
process.exitCode = bad.length ? 1 : 0
