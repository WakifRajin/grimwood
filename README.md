# The Grimwood: web edition

A browser version of **The Grimwood** (2016), a chaotic card game for 2–6 players.

- **Offline vs AI:** 1–5 bots (Easy / Normal). Runs entirely in the browser, and your game is saved locally so you can resume it.
- **Online:** create a room, share the 5-letter code or link, and add bots to fill seats. Uses Firebase Realtime Database.

Plain HTML/CSS/JS (ES modules), no build step.

## Features

- Offline vs 1–5 bots (Easy / Normal), saved automatically so you can resume.
- Online rooms with a code or invite link. Bots can fill seats, and rooms clean themselves up.
- Animated playback of every move: flying cards, a spotlight for played powers, turn banners and score pop-ups.
- Generated sound effects and ambient background music (Web Audio, no audio files).
- Settings: music and effects volume, mute, bot speed, reduced animations, and vibration on phones.
- Installable app that plays offline vs AI (manifest + service worker).
- Works on phones and desktops, with keyboard support and screen-reader labels.

## Run locally

```bash
npm run serve
```

Then open http://localhost:8080. ES modules need a web server; opening `index.html` as a file won't work.
`scripts/serve.js` applies the same response headers as Firebase Hosting, including the content security policy, so problems show up before you deploy.

## Enable online play (Firebase)

1. Create a project at https://console.firebase.google.com.
2. **Build → Realtime Database → Create database.** Any location works; start in locked mode.
3. **Build → Authentication → Sign-in method → enable Anonymous.**
4. **Project settings → Your apps → Add web app**, then copy the config into [public/js/firebase-config.js](public/js/firebase-config.js). Include `databaseURL`.
5. Deploy the security rules and the site:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase use --add
```

```bash
npm run deploy
```

You can also host `public/` anywhere static, such as GitHub Pages. In that case deploy only the rules with `firebase deploy --only database` and add your domain under Authentication → Settings → Authorized domains.

### How online works

There is no paid backend. The **host's browser runs the rules engine** ([public/js/host.js](public/js/host.js)):

| Path | Who can read | Who can write |
|---|---|---|
| `rooms/{code}/meta`, `players`, `bots` | signed-in users | host / each player for themselves |
| `rooms/{code}/secret` (full state) | host | host |
| `rooms/{code}/views/{uid}` (redacted view) | that player | host |
| `rooms/{code}/intents/{id}` (actions) | host | room players (own uid only) |

Players never receive other players' hands or the deck order. The host could inspect the full state, so play with people you trust to host.
If the host closes the tab the game pauses. When the host comes back and clicks **Rejoin room**, the game picks up where it left off.
**Rooms clean themselves up** without a paid backend:
- When the host leaves, the room is deleted immediately, and other players are told it was closed.
- While the host is present, their browser refreshes `rooms/{code}/meta/active` and `activity/{code}` every few minutes.
- Whenever anyone creates or joins a room, the app deletes up to 25 rooms that have been idle for more than 3 hours. It finds them through the `activity` index.
- The database rules let only the host delete a live room. Anyone may delete a room that is closed or idle for 3+ hours.

These rules must be deployed for cleanup to work. See the deploy steps above.

## Tests

```bash
npm test
```

- `tests/sim.js` plays thousands of AI-vs-AI games and checks that no card is created or lost, combos stay legal, and every game ends.
- `tests/online-sim.js` runs a full online game (host + remote player + bot) against an in-memory fake of the RTDB API.

## Code map

| File | Purpose |
|---|---|
| `public/js/cards.js` | Card list, deck composition, scoring |
| `public/js/engine.js` | Rules engine: pure, serialisable state; every power; amulets; end of game |
| `public/js/ai.js` | Bots. They only see their own redacted view |
| `public/js/host.js` | Applies actions and drives bot turns (offline + online host) |
| `public/js/online.js` | Firebase rooms, lobby, host/client sync |
| `public/js/ui.js` | Table rendering, prompts, rules dialog |
| `public/js/audio.js` | Synthesised sound effects and generative background music |
| `public/js/settings.js` | Saved preferences and the Settings dialog |
| `public/sw.js` | Service worker: network-first caching for offline play |
| `scripts/serve.js` | Local server that applies `firebase.json` headers |
| `public/js/fx.js` | Event animations: flying cards, power spotlight, turn banner, score pop-ups |
| `public/js/main.js` | Screens and wiring |

## Rules interpretations

These follow the official 2017 rule sheet. Where the sheet is ambiguous:

- **Turn:** play one card (a supernatural with its power, or a Rune). Combos can be placed at any time. Close the turn by drawing or stealing. The turn then ends automatically, unless you're holding a complete combo (or supernaturals on the final round) that you might still want to place. Supernaturals can also be placed without using their power.
- **Rune:** +2 extra actions this turn. Each extra action is a draw, a steal, or a power. Extra draws and steals do not close the turn.
- **Stealing:** a normal steal needs a target with 2+ cards. Steals from powers need 1+.
- **Amulet:** the victim decides whether to block. A blocked normal steal ends the thief's turn. A blocked power steal only stops that one card.
- **Nymph / Bride / Centaur / Giant / Faeries:** the taken card goes to your hand. "Play immediately" means placing it and using its power for free.
- **Elf:** reactivates another supernatural in your combos.
- **Each card's power resolves at most once per turn** (house rule, prevents an endless Elf ↔ Nymph loop).
- **Sorceress:** discard 2 Owls or 2 Crows from your hand (as in the German text) to take another player's combo.
- **Highwayman:** swaps one of your combos for one of theirs.
- **Dragon:** its combo is frozen and immune to Demon, Highwayman, Sorceress, Bride and Nymph.
- **Supernatural combos** are capped at 5 cards (15 pts).
- **End:** when the last card is drawn, every other player gets one final turn.

Card artwork is not included. Cards are drawn with CSS and emoji.
