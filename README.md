<div align="center">

<img src="apps/web/public/icon.svg" width="72" height="72" alt="" />

# Teleprompter

**A script that follows your voice, so you never lose your place.**

Paste your talk, press the microphone, and speak. The script keeps up with you: the line you're on stays at eye level, and what you've already said is dimmed.

<br />

<img src="docs/images/presenter-desktop.png" alt="The presenter view following a speaker: spoken text is dimmed, the phrase being heard glows amber, and the next word is underlined on the reading line." width="860" />

<sub>The presenter view mid-talk (captured with the built-in speaker simulation).</sub>

<br />
<br />

[![CI](https://github.com/rimorin/tk_teleprompter/actions/workflows/ci.yml/badge.svg)](https://github.com/rimorin/tk_teleprompter/actions/workflows/ci.yml)
![Node 22+](https://img.shields.io/badge/node-22%2B-3c873a)
![pnpm 11](https://img.shields.io/badge/pnpm-11-f69220)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React 19](https://img.shields.io/badge/React-19-61dafb)
![Mobile first](https://img.shields.io/badge/design-mobile--first-7ea6ff)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## Why this exists

Public speakers use notes to hold their thoughts together. But a phone or tablet of notes has
two problems:

- **You have to scroll it.** Every swipe is a moment when your attention is on the device instead
  of your message.
- **You need to look at your audience.** Every time you look up to connect with the room, you
  come back to a wall of text and have to find your place again.

Between the scrolling and the looking up, it's easy to lose track of where you are, both on the
page and in your train of thought.

**Teleprompter removes both problems.** It listens as you speak, recognizes where you are in your
script, and keeps that line in view on its own. Look up, make eye contact, pause, tell a story
that isn't in your notes. When you glance back down, your place is waiting for you.

## How it works

<table>
<tr>
<td width="33%" valign="top">

### 1 · Add your script

Paste it, or upload a `.txt` or `.docx`. Paragraphs are kept exactly as you wrote them.

</td>
<td width="33%" valign="top">

### 2 · Start presenting

Pick a comfortable text size and theme. Tap the microphone and speak naturally.

</td>
<td width="33%" valign="top">

### 3 · Just talk

The script follows you. Tap any word if you ever want to jump somewhere yourself.

</td>
</tr>
</table>

**Reading the screen at a glance**

| You see         | It means                                                 |
| --------------- | -------------------------------------------------------- |
| Dimmed text     | Already spoken                                           |
| Warm amber text | What it's hearing right now                              |
| Underlined word | Your next word                                           |
| ◀ ▶ markers     | The reading line, where your current line always settles |

### Built for the moments that don't go to plan

Real talks aren't read word-for-word. The tracker is designed for that:

| When you…                              | Teleprompter…                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pause** to breathe or think          | waits; nothing moves on silence                                                              |
| **Ad-lib** or tell an unscripted story | holds your place and picks up again when you return to the script                            |
| **Paraphrase** or stumble over a word  | tolerates misheard words, fillers ("um", "so") and small wording changes                     |
| **Skip** a sentence or a whole section | jumps ahead once it's confident: a distinctive phrase, normally confirmed across two updates |
| **Repeat** a line for emphasis         | never jumps backward on its own                                                              |
| **Lose connection** or the mic stops   | freezes in place and tells you; manual controls always keep working                          |

A common phrase that appears in several places ("thank you very much", "at the end of the day")
is never enough on its own to make it jump.

## Features

**Made for reading on stage**

- Large, adjustable text: size, line spacing, column width, sans or serif
- Dark, light and high-contrast themes; mirrored text for teleprompter glass
- Adjustable reading line: near the top by default, close to your camera and your audience's eye line
- Smooth scrolling that ignores tiny movements and respects "reduce motion"

**Hands-free, with manual control whenever you want it**

- Voice following with live status: _Listening_, _Lost place_, _Paused_
- Tap any word or paragraph to jump there; previous/next paragraph buttons
- Pause tracking (Space), keyboard shortcuts (`?`), and presenter remotes (Page Up / Page Down)

**Phone and tablet first**

- Thumb-reach controls with a large microphone button
- Keeps the screen awake while presenting
- Works in portrait and landscape, and can be added to your home screen like an app

**Practice anytime**

- A built-in speaker simulation (clean, noisy, or with ad-libs and skips) shows how following
  behaves, with no microphone or API key needed
- Full manual teleprompter mode works offline

<table>
<tr>
<td align="center"><img src="docs/images/setup-phone.png" width="240" alt="Setup screen on a phone with the script editor and a Start presenting button." /><br /><sub>Add your script</sub></td>
<td align="center"><img src="docs/images/presenter-phone.png" width="240" alt="Presenter view on a phone following along, with a large stop button in the bottom dock." /><br /><sub>Present hands-free</sub></td>
<td align="center"><img src="docs/images/settings-phone.png" width="240" alt="Settings sheet on a phone with theme, typeface, text size, spacing, column width and reading line controls." /><br /><sub>Make it comfortable</sub></td>
</tr>
</table>

## Privacy

- **Your script never leaves your browser.** It's stored locally on your device for convenience,
  and `.docx` files are read on your device too.
- **Audio is only sent while the microphone is on**, streamed to the speech-recognition provider
  ([Deepgram](https://deepgram.com)) through this app's server for live transcription.
- **Nothing is recorded or stored on the server**: no audio, no transcripts. The server never logs
  speech content.
- The provider API key stays on the server and is never sent to the browser.

---

## Quick start

**You'll need:** Node.js 22+, [pnpm](https://pnpm.io) 11, and (for voice following) a
[Deepgram](https://deepgram.com) API key. Manual mode and the simulation work without a key.

```bash
git clone https://github.com/rimorin/tk_teleprompter.git && cd tk_teleprompter
pnpm install

cp apps/server/.env.example apps/server/.env   # then set DEEPGRAM_API_KEY
pnpm dev                                        # web on :5173, server on :8787
```

Open **http://localhost:5173**, choose **Load sample**, then **Start presenting**.

### On your phone or tablet

Browsers only allow the microphone on secure pages, so use the HTTPS dev mode:

```bash
pnpm dev:mobile
```

Open the printed `https://<your-computer's-IP>:5173` address on a device on the same Wi-Fi and
accept the one-time certificate warning (it's a local development certificate).

### Keyboard shortcuts

| Key                     | Action                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `M`                     | Start / stop microphone                                       |
| `Space`                 | Pause / resume tracking                                       |
| `↑` `↓` · `PgUp` `PgDn` | Previous / next paragraph (works with most presenter remotes) |
| `Home`                  | Back to the start                                             |
| `+` `−`                 | Larger / smaller text                                         |
| `F`                     | Fullscreen                                                    |
| `D`                     | Diagnostics panel                                             |
| `?`                     | Show all shortcuts                                            |

## Deploying

It runs anywhere you can run containers: a VPS with Docker Compose, Kubernetes, or a container
platform such as Railway, Render or Fly.io. You can also put the front end on a static host
(Netlify, Vercel, Cloudflare Pages…) with the API deployed separately. Putting Cloudflare's proxy or Tunnel in front is supported too.

There are two images: `web` (Caddy, public) and `api` (Node.js, private, holds the speech API
key). Both are configured at runtime, and platforms build them straight from the repo.

```bash
cp apps/server/.env.example apps/server/.env    # DEEPGRAM_API_KEY, APP_ACCESS_CODE
docker compose up --build                        # http://localhost:8080
```

**[DEPLOYMENT.md](DEPLOYMENT.md)** covers requirements, configuration and a recipe for each
option. Public deployments should set `APP_ACCESS_CODE`: presenters enter it once per device, which
keeps strangers from spending your speech-recognition budget. Session, per-IP and duration limits
are also built in.

---

## Under the hood

```
┌───────────────────────── Browser ──────────────────────────┐
│ Script parser → tokens (with original text offsets)         │
│ Presenter UI · manual controls · smooth scroll controller   │
│ Microphone → AudioWorklet (resample to 16 kHz PCM) ─┐       │
│ Pure matcher: transcript → confirmed / tentative ◀──┼──┐    │
└─────────────────────────────────────────────────────┼──┼────┘
                              audio frames (WebSocket)│  │ normalized transcript events
┌──────────────────────── Server (Fastify) ───────────▼──┴────┐
│ Session relay · access code & limits · Deepgram adapter      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
                 Streaming speech-to-text (Deepgram)
```

**The matcher** is a pure, provider-independent function,
`update(context, state, transcriptEvent) → state`, tested without a microphone or network:

- **Final and interim results are treated differently.** Final results move a _confirmed_ cursor.
  Interim guesses only move a _tentative_ highlight, so a revised guess can never push you ahead or
  duplicate words.
- **Speech is matched as phrases, not single words.** The last ~8 spoken words are aligned against
  the script, tolerating substitutions, insertions, deletions, fillers, near-misses and spoken
  numbers ("twenty twenty five" ↔ "2025").
- **Nearby progress is preferred.** Distant jumps need a distinctive, unique match and agreement
  across updates, and automatic backward jumps never happen.
- Every threshold lives in one documented config
  ([`packages/shared/src/matcher/config.ts`](packages/shared/src/matcher/config.ts)).

A seeded simulator generates realistic recognition output (errors, fillers, revisions, pauses,
skips, ad-libs, re-reads) with ground truth, so behaviour is measured rather than guessed.

### Project layout

```
apps/
  web/        React + Vite front end (mobile-first presenter, setup, audio capture)
  server/     Fastify WebSocket relay, Deepgram adapter, access control
packages/
  shared/     Protocol schemas, tokenizer, matcher, simulator (used by both apps)
docs/         Screenshots
deploy/       Optional platform configs (Railway)
DEPLOYMENT.md Deployment guide for any platform
compose.yaml  Run the production images with Docker Compose
```

### Tech stack

TypeScript (strict) · React 19 · Vite · Fastify 5 · `ws` · Zod · Web Audio `AudioWorklet` ·
Deepgram streaming speech-to-text (Nova-3) · Caddy · Vitest + Testing Library · pnpm workspaces.

## Development

| Command                        | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `pnpm dev`                     | Web (http://localhost:5173) + server, with hot reload                |
| `pnpm dev:mobile`              | Same, served over HTTPS on your local network for phones and tablets |
| `pnpm test`                    | Unit and integration tests for all packages                          |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript                                                  |
| `pnpm build`                   | Production builds (static web bundle; single-file server bundle)     |
| `pnpm verify`                  | Everything CI runs: lint, typecheck, tests, builds                   |

Server configuration (API key, access code, limits, allowed origins) is documented in
[`apps/server/.env.example`](apps/server/.env.example).

## Limitations

- **English only for now.** The matching design is language-agnostic, but it hasn't been tuned
  for other languages.
- **It follows phrase by phrase, not syllable by syllable,** so the highlight can trail your voice
  slightly. How much depends on network and recognition speed.
- **Very noisy rooms and heavy paraphrasing** make recognition, and so following, less reliable.
  It holds its place rather than guessing, and a tap always puts you back on track.
- **On iPhone and iPad, switching apps or locking the screen stops the microphone.** Start it
  again when you return (the screen is kept awake while presenting to avoid this).
- **Tested so far** with automated tests, emulated phones and tablets (WebKit and Chromium), and
  live use on a laptop. Broader real-device testing is ongoing.
- PDF import isn't supported yet (use `.txt` or `.docx`).

## Roadmap

- Automatic reconnect after network drops, with live microphone level feedback
- Stage-direction cues like `[PAUSE]` or `[SLIDE 5]`, shown but never read
- Webcam / glass reading-line presets and text-size presets by distance
- PDF import and more languages

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `pnpm verify`. For matcher
changes, please add a simulator scenario or test that shows the behaviour you're improving.

## License

[MIT](LICENSE) © 2026 John-Eric Kwan
