# Drawing

Neon on black. Pick up an Apple Pencil, draw, and watch the line light up.

![Neon strokes glowing on a black canvas](docs/screenshots/demo.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-22c55e)

**[Draw something now](https://drawing-bheng.vercel.app)**

## What it does

- **Draws light.** Real neon, not a glow filter: a white hot core inside a saturated halo. 4 styles, 8 gradient inks, and every line shifts colour as it travels.
- **Gets out of the way.** Pure black canvas, one small toolbar that fades while you draw.
- **Lets you rest your hand.** Once it has seen a Pencil, your palm is ignored.
- **Comes alive.** Fireflies drift past your lines, sparks glint off them, a current runs through the tube. Or switch it off and let it sit still.
- **Plays itself back.** Press play and the drawing redraws itself, slowly enough for a kid to follow, then saves the whole thing as an MP4.
- **Saves it.** PNG at full resolution, straight into the share sheet.

![The four neon styles](docs/screenshots/styles.png)

## Run it

```bash
git clone https://github.com/bunlongheng/drawing.git
cd drawing
npm install
npm run dev
```

Open <http://localhost:3049>. For an iPad on the same network, `npm run dev -- -H 0.0.0.0` and browse to your machine's address, then Add to Home Screen for a fullscreen pad.

No environment variables, no accounts, no database. Nothing you draw leaves your device.

## Controls

| | |
|---|---|
| Draw | Pencil, finger or mouse |
| Undo, redo | `Cmd+Z`, `Cmd+Shift+Z` |
| Save a PNG | `Cmd+S` |
| Clear | Tap the bin twice |
| Replay, record | Play, then the camera |

## Under the hood

Zero runtime dependencies beyond Next and React. The glow is additive bloom on a small canvas engine that keeps React out of the hot path, which is how it keeps up with a Pencil at 120Hz.

```bash
npm run test:all   # 70 unit tests, 34 end to end on Chromium and WebKit
```

## Licence

[MIT](LICENSE) (c) 2026 Bunlong Heng
