# CLAUDE.md

Guidance for coding agents working in this repository. The general guidelines are adapted from
[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md);
the project section below takes precedence where they overlap. They favour care over speed; use
judgment for trivial tasks.

## How to work

### 1. Think before coding

Don't assume, don't hide confusion, and surface tradeoffs.

- State assumptions. If something is unclear, stop, name it, and ask.
- If a request has several readings, lay them out instead of picking one silently.
- If there's a simpler approach, say so, and push back when it's warranted.

### 2. Keep it simple

Write the minimum code that solves the problem, and nothing speculative.

- No features, abstractions, options or configurability beyond what was asked.
- No error handling for situations that can't happen.
- If 200 lines could be 50, rewrite it. Would a senior engineer call it overcomplicated?

### 3. Make surgical changes

Touch only what the task needs, and clean up only your own mess.

- Don't reformat, re-comment or refactor adjacent code that isn't broken. Match the existing style.
- Remove imports, variables and functions that your change made unused. Mention other dead code
  you notice rather than deleting it.
- Every changed line should trace back to the request.

### 4. Work toward verifiable goals

Define what success looks like, then iterate until it's checked.

- "Add validation" → write tests for invalid input, then make them pass.
- "Fix the bug" → write a test that reproduces it, then make it pass.
- "Refactor X" → tests pass before and after.
- For multi-step work, state a short plan with a check per step.

## This project

A voice-following teleprompter: the browser streams microphone audio through a Fastify relay
to Deepgram, and a pure matcher in the browser keeps the speaker's place in their script.
User-facing docs: [README.md](README.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

### Commands

| Command                                                                | Use                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm install`                                                         | Install (pnpm 11, Node 22+)                                                    |
| `pnpm dev` / `pnpm dev:mobile`                                         | Web :5173 + server :8787 (mobile mode serves HTTPS on the LAN)                 |
| `pnpm verify`                                                          | Lint, typecheck, tests and builds: run before calling work done (CI runs this) |
| `pnpm test` · `pnpm --filter @teleprompter/<web\|server\|shared> test` | Tests (Vitest)                                                                 |
| `pnpm format`                                                          | Prettier                                                                       |

### Layout

- `packages/shared`: protocol schemas, tokenizer, **matcher** (`src/matcher/`) and speaker
  simulator. Used by both apps.
- `apps/web`: React + Vite front end (setup, presenter, AudioWorklet capture, WebSocket client)
  and its Caddy image.
- `apps/server`: Fastify WebSocket relay, Deepgram adapter, access control and limits.
- `deploy/`: optional platform-specific configs. Everything else stays platform-agnostic.

### Rules that must hold

- **The matcher stays pure and provider-independent:** `update(ctx, state, event) → state`, with
  no I/O and no Deepgram-specific shapes (normalize those in `apps/server/src/providers/`).
- **Interim results move only the tentative cursor.** Only final results move the confirmed
  cursor, and it never jumps backward automatically; only a manual tap can move it back.
- **Matcher thresholds live in `packages/shared/src/matcher/config.ts`.** For matcher changes,
  add a test or simulator scenario in `tracker.test.ts`, and check that no scenario runs ahead of
  the speaker.
- **Secrets stay server-side.** Never send API keys to the browser. Never log audio, transcripts
  or credentials. Scripts never leave the browser.
- **Manual mode must work without a microphone, network or API key.**
- **The UI is mobile-first:** base styles target phones, with larger screens layered on through
  `min-width` breakpoints. Keep tap targets at 44 px or more, and put mouse-only affordances under
  `(hover: hover)`.
- **No platform-specific defaults in code or images.** Configure through environment variables
  (`apps/server/.env.example`, `apps/web/Caddyfile`).
- **Never commit `.env` files.** `apps/server/.env` holds a real key.
