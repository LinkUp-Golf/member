# LinkUp Golf — member app

The LinkUp Golf member app at [app.linkup.golf](https://app.linkup.golf). It's an installable web app for a private golf-and-business-networking community: tee-time booking, messaging, announcements, hosted rounds, referral partners, curated introductions and an admin console.

Built with Next.js 14 (App Router), TypeScript, Tailwind, Supabase (Postgres, Auth, Realtime, Storage) and GoHighLevel, with Stripe, Resend and Web Push alongside. It's hosted on Vercel.

## Documentation

| Read | For |
| --- | --- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | **Start here.** Services and their dashboard setup, environment variables, environments, how to ship, open questions, access to hand over |
| [`CLAUDE.md`](CLAUDE.md) | Architecture and every feature's rules, in depth. AI coding tools read it automatically ([`AGENTS.md`](AGENTS.md) points other tools to it) |
| [`docs/decisions.md`](docs/decisions.md) | Why things work the way they do |
| [`docs/code-map.md`](docs/code-map.md) | Every page, API route, library file and migration (generated) |
| [`docs/playing-partner-matching.md`](docs/playing-partner-matching.md) | Curated Introductions in full |

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in; see docs/HANDOVER.md §4
npm run dev                        # http://localhost:3000
```

| Command | Does |
| --- | --- |
| `npm run lint && npm test && npm run build` | The checks to run before pushing. There is no CI |
| `npm run db:migration <name>` / `npm run db:push` | Create / apply a Supabase migration (to the linked project) |
| `npm run docs:map` | Regenerate `docs/code-map.md` |
| `npm run generate-vapid` | Generate a Web Push key pair |

Work on `develop`; release with a pull request into `main`, which Vercel deploys to production.
