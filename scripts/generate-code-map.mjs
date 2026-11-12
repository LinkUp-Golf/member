#!/usr/bin/env node
// Writes docs/code-map.md: every page, every API route (with the HTTP methods
// it exports), every library file and every migration, each with the first
// lines of its own header comment. The map is generated so it can't drift from
// the code: rerun `npm run docs:map` after adding or moving files.
//
// It only reads what the files already say about themselves, so a file with no
// header comment shows up with no description. Adding one is the fix.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'docs', 'code-map.md')
const MAX_DESC = 220

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.next')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, keep, out)
    else if (keep(path)) out.push(path)
  }
  return out
}

const rel = p => relative(ROOT, p).split(sep).join('/')

/** The file's opening comment, as one line of prose. */
function describe(source) {
  const lines = source.split('\n')
  const text = []
  let i = 0
  // Skip directives and blank lines before the comment.
  while (i < lines.length && /^\s*('use (client|server)'|"use (client|server)"|export const (dynamic|runtime|revalidate)\b.*|)\s*;?\s*$/.test(lines[i])) i++
  if (lines[i]?.trim().startsWith('/*')) {
    for (; i < lines.length; i++) {
      const l = lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim()
      if (l) text.push(l)
      if (lines[i].includes('*/')) break
    }
  } else if (lines[i]?.trim().startsWith('--')) {
    for (; i < lines.length && lines[i].trim().startsWith('--'); i++) {
      const l = lines[i].replace(/^\s*--+\s?/, '').trim()
      if (l && !/^[-=]+$/.test(l)) text.push(l)
    }
  } else {
    for (; i < lines.length && lines[i].trim().startsWith('//'); i++) {
      const l = lines[i].replace(/^\s*\/\/+\s?/, '').trim()
      if (l && !/^[-=]+$/.test(l)) text.push(l)
    }
  }
  const joined = text.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > MAX_DESC ? `${joined.slice(0, MAX_DESC).replace(/\s+\S*$/, '')} …` : joined
}

/** The first comment block anywhere in the file, for files whose header sits below the imports. */
// Only a comment above the first top-level declaration counts (one inside a
// component is about that line, not the file), and not a section divider or a
// two-word label.
function firstComment(source) {
  const lines = source.split('\n')
  const DECLARATION = /^(export |function |async function |const |let |var |interface |type |class |enum )/
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (DECLARATION.test(lines[i])) return ''
    if ((t.startsWith('//') || t.startsWith('/*')) && !/eslint-|@ts-|prettier-ignore/.test(t)) {
      const text = describe(lines.slice(i).join('\n'))
      if (/^-{2,}|^={2,}/.test(text) || text.split(/\s+/).length < 5) continue
      return text
    }
  }
  return ''
}

/** A page's own heading, from the title / description props it passes its shell. */
function pageHeading(source) {
  // Only the page shell's own props — an empty state's title is not the page's.
  const shell = source.match(/<(?:AppShell|AdminPageHeader)\b[^>]*>/s)?.[0] ?? ''
  const title = shell.match(/\btitle=["']([^"'{]+)["']/)?.[1]
  const desc = shell.match(/\bdescription=["']([^"'{]+)["']/)?.[1]
  return [title, desc].filter(Boolean).join(' — ').replace(/&amp;/g, '&')
}

const explain = (source, isPage = false) =>
  describe(source) || (isPage && pageHeading(source)) || firstComment(source) || ''

const cell = s => s.replace(/\|/g, '\\|')

/** /api/bookings/[id] from src/app/api/bookings/[id]/route.ts, route groups dropped. */
function urlOf(file, leaf) {
  const parts = rel(file).replace(/^src\/app/, '').split('/').slice(0, -1).filter(p => !/^\(.*\)$/.test(p))
  return parts.join('/') || (leaf === 'page' ? '/' : '')
}

function methodsOf(source) {
  const found = new Set()
  for (const m of source.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.add(m[1])
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop())) {
      if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) found.add(name)
    }
  }
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter(m => found.has(m)).join(', ')
}

function groupOf(file) {
  const m = rel(file).match(/^src\/app\/(\([^)]+\))/)
  return m ? m[1] : 'public'
}

const app = join(ROOT, 'src', 'app')
const pages = walk(app, p => p.endsWith(`${sep}page.tsx`))
const routes = walk(app, p => p.endsWith(`${sep}route.ts`))
const lib = walk(join(ROOT, 'src', 'lib'), p => /\.(ts|tsx)$/.test(p))
const hooks = walk(join(ROOT, 'src', 'hooks'), p => /\.(ts|tsx)$/.test(p))
const migrations = walk(join(ROOT, 'supabase', 'migrations'), p => p.endsWith('.sql'))

const out = []
out.push('# Code map')
out.push('')
out.push('Generated by `npm run docs:map` (scripts/generate-code-map.mjs) from each file\'s own header comment. Don\'t edit by hand: rerun it.')
out.push('')
out.push(`${pages.length} pages · ${routes.length} API routes · ${lib.length} library files · ${hooks.length} hooks · ${migrations.length} migrations`)
out.push('')

out.push('## Pages')
out.push('')
out.push('Route groups: `(app)` signed-in members and guests, `(admin)` admins, `(host)` hosts, `(partner)` referral partners, `(auth)` sign-in. Ungrouped pages are public or callbacks.')
out.push('')
let lastGroup = ''
for (const f of pages) {
  const g = groupOf(f)
  if (g !== lastGroup) {
    out.push('', `### ${g}`, '', '| URL | File | What it is |', '| --- | --- | --- |')
    lastGroup = g
  }
  out.push(`| \`${urlOf(f, 'page')}\` | \`${rel(f)}\` | ${cell(explain(readFileSync(f, 'utf8'), true))} |`)
}
out.push('')

out.push('## API routes')
out.push('')
out.push('Most are wrapped in `withAuth` / `withAdminAuth` (`src/lib/auth/with-auth.ts`). `/api/webhooks/*` are verified by signature or secret; `/api/cron/*` by `CRON_SECRET`.')
out.push('')
let lastArea = ''
for (const f of routes) {
  const url = urlOf(f, 'route')
  const area = url.split('/').slice(0, 3).join('/')
  if (area !== lastArea) {
    out.push('', `### ${area}`, '', '| Route | Methods | What it does |', '| --- | --- | --- |')
    lastArea = area
  }
  const src = readFileSync(f, 'utf8')
  out.push(`| \`${url}\` | ${methodsOf(src)} | ${cell(explain(src))} |`)
}
out.push('')

for (const [title, files] of [['Library (`src/lib`)', lib], ['Hooks (`src/hooks`)', hooks]]) {
  out.push(`## ${title}`, '', '| File | What it is |', '| --- | --- |')
  for (const f of files) out.push(`| \`${rel(f)}\` | ${cell(explain(readFileSync(f, 'utf8')))} |`)
  out.push('')
}

out.push('## Migrations', '', 'Applied in filename order (`npm run db:push`). Newest last.', '', '| File | What it does |', '| --- | --- |')
for (const f of migrations) out.push(`| \`${rel(f).replace('supabase/migrations/', '')}\` | ${cell(explain(readFileSync(f, 'utf8')))} |`)
out.push('')

writeFileSync(OUT, out.join('\n'))
console.log(`Wrote ${rel(OUT)}: ${pages.length} pages, ${routes.length} routes, ${lib.length} lib files, ${hooks.length} hooks, ${migrations.length} migrations`)
