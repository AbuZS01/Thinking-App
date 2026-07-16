# Master Thinking Coach

A gamified, long-term training program for critical thinking, reasoning, mental
models, and decision-making — built as a self-contained static web app (no
backend, no build step, no external services). Progress is stored in your
browser's `localStorage`, so it's fully private and works offline.

## What's in it

- **Daily Quest** — 9 exercises a day (warm-up, challenge, real-world case,
  reflection, creativity, logic puzzle, decision scenario, bias detection,
  observation), pulled from a bank of 72 hand-written exercises and weighted
  toward whichever thinking frameworks you're weakest in.
- **Weekly Boss Battle** — a multi-stage, no-perfect-answer scenario (business,
  history, cybersecurity, AI, ethics, economics) that rotates weekly across 9
  battles.
- **Framework Encyclopedia** — 29 thinking styles (critical thinking, first
  principles, Bayesian thinking, game theory, red-team thinking, etc.), each
  covering what problem it solves, why smart people get it wrong, when it's
  dangerous, a famous example, and how an expert applies it.
- **Thinking Toolbox** — 26 quick-reference tools (OODA loop, Five Whys, MECE,
  premortem, base rates, Occam's razor, and more).
- **Leveling & Achievements** — an RPG-style level curve (1 → 100, with titles
  from "Beginner Observer" to "Grand Strategist"), XP, streaks, and 20
  achievements.
- **Calibration training** — auto-graded true/false questions answered with a
  confidence level (scored with a proper scoring rule, so honest confidence
  maximizes XP) plus 90%-confidence-interval estimates, with a personal
  accuracy-vs-confidence curve. No honor system.
- **Spaced review** — the frameworks and toolbox become an SM-2 style
  spaced-repetition deck (Again/Hard/Good/Easy), capped at 5 new cards a day.
- **Weekly Report** — XP, exercises, calibration and review activity this week
  vs last, plus a suggested focus from your weakness data.
- **Journal** — every answer you submit is saved and browsable, so you can
  watch how your reasoning changes over time.
- **Export / Import** — back up all progress (including the journal) to a JSON
  file from the footer, and restore it on any device.

Every exercise uses a self-assessment model: you attempt it, optionally reveal
progressive Socratic hints (each hint costs 20% of the exercise's XP), then
check off a rubric against the model answer and expert note — your XP is
earned from how many criteria you honestly met.

Model answers stay locked until you've written a real attempt — active recall
before explanation. Two mechanics keep the daily habit sustainable: a visible
grace shield absorbs one missed day (spent automatically, re-earned by
finishing the ★ core trio), and each daily quest marks that core trio — the
warm-up plus the two exercises that best target your weakest frameworks — so a
short session still counts.

## Running it

No build step, no dependencies. Any static file server works:

```bash
cd master-thinking-coach
python3 -m http.server 8080
# then open http://localhost:8080
```

Or just open `index.html` directly in a browser (everything is plain
`<script>` tags, no ES modules, so `file://` works too — the service worker
simply stays inactive on `file://`).

## Installing it on your phone (PWA)

The app is an installable Progressive Web App: once it's served over HTTPS
(see hosting below), open it in the browser and:

- **iPhone (Safari):** Share button → "Add to Home Screen"
- **Android (Chrome):** the install prompt, or menu → "Install app"

It gets its own icon, launches full-screen without browser chrome, and works
fully offline (a service worker caches the whole app; your data was always
local).

The quickest free hosting: push this repo to GitHub, enable **GitHub Pages**
on the repository (Settings → Pages → deploy from branch), and it's live over
HTTPS at `https://<you>.github.io/<repo>/`. Netlify/Vercel free tiers work the
same way.

When you change any shipped file, bump `CACHE_VERSION` in `sw.js` so installed
copies pick up the update.

## Pushing this to your own GitHub repo

This project was built locally and isn't pushed anywhere yet. To publish it:

```bash
cd master-thinking-coach
git remote add origin <your-empty-repo-url>
git push -u origin master
```

## Project structure

- `content.js` — the content bank: frameworks, toolbox, exercises, boss
  battles, achievements, level titles. Plain data — edit this to add more
  content.
- `engine.js` — game logic: XP/leveling curve, streaks, daily quest
  generation (with weakness-weighted selection), achievement rules, boss
  battle rotation. Pure functions over a plain state object.
- `app.js` — UI layer: renders screens from engine state, handles all
  interaction via event delegation.
- `style.css`, `index.html` — presentation and shell.

## Extending it

- Add exercises/frameworks/toolbox entries/boss battles by adding objects to
  the arrays in `content.js` — no other file needs to change.
- Add achievements by adding `{ id, name, desc, xp, rule }` to
  `MTC_ACHIEVEMENTS`, where `rule` is a function of the aggregated stats
  object (see existing ones for examples).
