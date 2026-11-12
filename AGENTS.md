# AGENTS.md

Instructions for AI coding tools (Codex, Cursor, Copilot, Claude Code and others) working in this repository.

**Read [`CLAUDE.md`](CLAUDE.md) first.** It is the full guide: architecture, every feature's rules, and the patterns to follow. It's named for Claude Code, but it applies to every tool.

Then, as needed:

- [`docs/HANDOVER.md`](docs/HANDOVER.md): the outside services, environment variables, environments, how to ship, open questions and known gaps.
- [`docs/decisions.md`](docs/decisions.md): why things are the way they are. Check it before reversing something that looks like a bug.
- [`docs/code-map.md`](docs/code-map.md): every page, API route, library file and migration, with a one-line description each (`npm run docs:map` regenerates it).

Before pushing, run `npm run lint && npm test && npm run build`. There is no CI.
