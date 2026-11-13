# The Daily Brief

Grady's personal morning brief as a phone app. It installs from the browser to the home
screen (no App Store), works offline, and shows whatever the daily agents published that day.

- **App:** plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.
- **Data:** one encrypted JSON file per section per day in `data/days/<date>/`, written by
  agents with `tools/brief.mjs`. See [AGENTS.md](AGENTS.md) for the format.
- **Privacy:** the repo is public (free GitHub Pages needs that), so every brief is encrypted
  with AES-256-GCM using a passphrase only Grady and his agents know. The phone asks for it
  once and remembers it. Without it the files are unreadable. Use a long passphrase
  (4+ random words); the salt in `data/crypto.json` is public by design.

## Install on your phone

1. Open the Pages URL in **Safari** (iPhone) or **Chrome** (Android).
2. iPhone: Share → **Add to Home Screen**. Android: ⋮ → **Install app**.
3. Open it from the home screen and enter your passphrase once.

Swipe left/right (or use the arrows) to move between days. Tap a section chip to jump to it.
Settings → **Show demo data** previews the layout with fake data.

## One-time setup

```bash
node tools/brief.mjs init          # creates data/crypto.json (already done)
```

Then in GitHub: Settings → Pages → Deploy from branch → `main` / root.
Give each agent's environment a secret `BRIEF_PASSPHRASE` with the same passphrase.
