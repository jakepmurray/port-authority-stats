# Port Authority Stats

Free, open-source ultimate frisbee stats for **Port Authority** (club Mixed), built around **game film**.
Paste a YouTube link, watch the game beside a stat panel, and every stat you enter is stamped with the video time.

**Try it:** https://jakepmurray.github.io/port-authority-stats/

- Local-first PWA: data lives in your browser (IndexedDB). Installable, works offline.
- React + TypeScript + Vite, Tailwind, Dexie + Zod.
- Free tools only. MIT licensed.

See [PLAN.md](PLAN.md) for the product plan and roadmap.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173/port-authority-stats/
npm test           # Vitest
npm run lint       # oxlint
npm run typecheck  # tsc
npm run build
```

Pushes to `main` run CI (lint, typecheck, tests) and deploy to GitHub Pages.
