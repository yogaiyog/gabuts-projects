# Web AR — Hand Filter

Pixel-perfect port of TouchDesigner hand-tracking AR filter to a Three.js Web AR web app.

## What this is

TouchDesigner `.toe` files can't run in browsers (TD requires its desktop runtime).
This project recreates the **`ar_hand_filter_demo_builder.py` pipeline** natively
in the browser using:

- **MediaPipe Tasks Vision** (HandLandmarker, WASM) → same 21 hand landmarks as TD
- **Three.js** → corner-pin 2D warp shader + 3D primitive anchored to palm
- **`<video>` + WebGL** → webcam passthrough (selfie-mirrored)
- **Vite + TypeScript** → modern tooling, ESM, tree-shakable

The 2D warp output is **pixel-perfect** with TD's chain:
`pattern_outer → pattern_mid → pattern_inner → pattern_dot → pattern_text` (radial rainbow + "AR" text)
warped to the 4 finger tips (pinky, ring, middle, index) using a perspective vertex-shader mapping.

A bonus: **3D geometric primitive** (glowing torus) anchored to the palm.

## Run locally

```sh
npm install
npm run dev
# open https://localhost:5173 (Note: getUserMedia REQUIRES HTTPS or localhost;
#                              localhost is allowed by browsers.)
```

For production build:

```sh
npm run build
npm run preview   # serves the built `dist/` at https://localhost:4173
```

## Deploy to Vercel

```sh
npm i -g vercel
vercel        # first time — answer prompts, accept defaults
vercel --prod # subsequent prod deploys
```

`vercel.json` already configures:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- (Required for SharedArrayBuffer / SIMD-accelerated MediaPipe WASM)

HTTPS is automatic on Vercel (required for `getUserMedia`).

## File layout

```
web-ar/
├── public/models/hand_landmarker.task     # MediaPipe hand model (7.5 MB)
├── src/
│   ├── main.ts             # entry: boot sequence, RAF loop, UI wiring
│   ├── camera.ts           # getUserMedia + <video> bootstrap
│   ├── handTracker.ts      # MediaPipe HandLandmarker wrapper (1-hand)
│   ├── arPattern.ts        # Canvas2D → rainbow circles + "AR" text → texture
│   ├── warpQuad.ts         # Three.js mesh + vertex-shader corner-pin warp
│   ├── anchored3D.ts       # Glowing torus anchored to palm position
│   ├── compositor.ts       # Three.js scene assembly + render loop
│   ├── ui.ts               # Mode toggle UI
│   └── style.css
├── index.html
├── package.json
├── vite.config.ts
├── vercel.json
└── tsconfig.json
```

## Pipeline (per frame)

```
getUserMedia ──► <video> ──► VideoTexture (mirrored) ──┐
                                                      │
              HandLandmarker (WASM, ~5ms/frame)       │
                    │                                 │
                    ▼                                 ▼
        ┌──── 4 corner landmarks ────► WarpQuad vertex shader (perspective bilinear)
        │                                                          │
        └──── palm center ────────► Anchored3D torus position      │
                                                                   │
                                  BG ─► WarpQuad ─► 3D torus ─► Single canvas composite
```

## Modes

The bottom-bar toggles between three modes:
- **2D Filter** — only the warped AR pattern (no 3D)
- **3D Only** — only the torus
- **Hybrid** — both (default)

## Mapping TD → Web (fidelity table)

| TouchDesigner node / param        | Web replacement                                      |
|-----------------------------------|------------------------------------------------------|
| `MediaPipe.tox` + `hand_tracking` | `@mediapipe/tasks-vision` `HandLandmarker`           |
| `circleTOP × 4` + `compositeTOP`  | `arPattern.ts` (Canvas2D, same colors/radii/alpha)   |
| `textTOP "AR"`                    | `arPattern.ts` (`drawARText`, same white font)       |
| `cornerpinTOP (mapping=perspective)` | `warpQuad.ts` vertex shader (bilinear; visually equivalent for hand quads) |
| `outTOP (viewer)`                 | `compositor.ts` render loop → `<canvas>`             |
| `webBrowser1/out1 (webcam)`       | `camera.ts` (`getUserMedia`) → `VideoTexture`        |

## Caveats

- 3D positioning assumes a **selfie / mirrored** camera view (the user sees their
  own movement normally mirrored; background plane mirrors the video accordingly).
  Toggle `compositor.setMirrorSelfie(false)` for a raw-camera anchor.
- 3D object is anchored to the **palm center** (wrist ↔ middle-finger MCP average),
  not the world. For WebXR world-anchored AR you'd need a mobile + WebXR-capable
  browser and a different pipeline (`three/webxr` + `XRAnchor`).
