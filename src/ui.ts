/**
 * ui.ts
 * =====
 * Mode toggle UI (4 mode) + frame sub-state toggles + effect selectors + text input.
 *
 * Mode buttons:
 *   - "2d"   → 2D Filter (rainbow AR pattern)
 *   - "3d"   → 3D Only (torus anchor)
 *   - "hybrid" → Hybrid (2D + 3D)
 *   - "frame" → Finger Frame (pixelate / Sobel-X / ... windows)
 *
 * Frame controls (hanya tampil saat mode = "frame"):
 *   - Toggle: "Thumb+Index", "Index+Middle"
 *   - Effect select per frame (11 efek)
 *   - Text input (untuk effect "text")
 */

import { EFFECTS, type EffectKind } from "./effects.js";

export type UIMode = "2d" | "3d" | "hybrid" | "frame";

export interface FrameState {
  thumbIndex: boolean;
  indexMiddle: boolean;
}

export interface FrameEffects {
  thumbIndex: EffectKind;
  indexMiddle: EffectKind;
}

export interface UIElements {
  container: HTMLElement;
  statusEl: HTMLElement;
  modesEl: HTMLElement;
  framesEl: HTMLElement;
  effectsEl: HTMLElement;
  textEl: HTMLInputElement;
  startBtn: HTMLElement;
}

const MODE_LABELS: Record<UIMode, string> = {
  "2d": "2D Filter",
  "3d": "3D Only",
  "hybrid": "Hybrid",
  "frame": "Finger Frame",
};

const MODE_ORDER: UIMode[] = ["2d", "3d", "hybrid", "frame"];
const DEFAULT_MODE: UIMode = "frame"; // mode terbaru yang menarik, jadi default

export function buildUI(opts: {
  parent: HTMLElement;
  onModeChange: (mode: UIMode) => void;
  onFramesChange: (state: FrameState) => void;
  onEffectsChange: (state: FrameEffects) => void;
  onTextChange: (text: string) => void;
  onSmoothChange: (value: number) => void;
  onStart: () => void;
}): UIElements {
  const { parent, onModeChange, onFramesChange, onEffectsChange, onTextChange, onSmoothChange, onStart } = opts;

  const effectOptions = EFFECTS.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  const modeOptions = MODE_ORDER.map(
    (m) => `<option value="${m}" ${m === DEFAULT_MODE ? "selected" : ""}>${MODE_LABELS[m]}</option>`,
  ).join("");

  parent.innerHTML = `
    <div class="ui-overlay">
      <header class="ui-header">
        <div class="ui-title">mr.iyog gabuts Projects</div>
        <div class="ui-sub">TouchDesigner port · MediaPipe + Three.js</div>
      </header>

      <div class="ui-center">
        <button id="ui-start" class="ui-start-btn">
          <span class="ui-start-dot"></span>
          Start Camera
        </button>
      </div>

      <footer class="ui-controls">
        <div id="ui-status" class="ui-status ui-status--idle">Click "Start Camera" to begin</div>
        <div id="ui-frames" class="ui-frames" hidden>
          <button data-frame="thumbIndex" class="ui-frame-btn active">Thumb+Index</button>
          <button data-frame="indexMiddle" class="ui-frame-btn active">Index+Middle</button>
        </div>
        <div id="ui-effects" class="ui-effects" hidden>
          <label class="ui-effect-row">
            <span>Index+Middle</span>
            <select data-effect="indexMiddle" class="ui-effect-select">${effectOptions}</select>
          </label>
          <label class="ui-effect-row">
            <span>Thumb+Index</span>
            <select data-effect="thumbIndex" class="ui-effect-select">${effectOptions}</select>
          </label>
          <label class="ui-effect-row" id="ui-text-row" hidden>
            <span>Text</span>
            <input id="ui-text-input" class="ui-text-input" type="text" placeholder="Type text…" />
          </label>
          <label class="ui-effect-row">
            <span>Smooth</span>
            <input id="ui-smooth" class="ui-smooth" type="range" min="0" max="100" value="50" />
          </label>
        </div>
        <label class="ui-effect-row" id="ui-mode-row" hidden>
          <span>Mode</span>
          <select id="ui-mode-select" class="ui-effect-select">${modeOptions}</select>
        </label>
      </footer>
    </div>
  `;

  const statusEl = parent.querySelector<HTMLElement>("#ui-status")!;
  const modesEl = parent.querySelector<HTMLElement>("#ui-mode-row")!;
  const modeSelect = parent.querySelector<HTMLSelectElement>("#ui-mode-select")!;
  const framesEl = parent.querySelector<HTMLElement>("#ui-frames")!;
  const effectsEl = parent.querySelector<HTMLElement>("#ui-effects")!;
  const textRowEl = parent.querySelector<HTMLElement>("#ui-text-row")!;
  const textEl = parent.querySelector<HTMLInputElement>("#ui-text-input")!;
  const startBtn = parent.querySelector<HTMLElement>("#ui-start")!;

  startBtn.addEventListener("click", () => {
    onStart();
  });

  modeSelect.addEventListener("change", () => {
    onModeChange(modeSelect.value as UIMode);
  });

  framesEl.querySelectorAll<HTMLButtonElement>(".ui-frame-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      onFramesChange(readFrameState(framesEl));
    });
  });

  effectsEl.querySelectorAll<HTMLSelectElement>(".ui-effect-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      updateTextRowVisibility();
      onEffectsChange(readEffectsState(effectsEl));
    });
  });

  textEl.addEventListener("input", () => {
    onTextChange(textEl.value);
  });

  const smoothEl = parent.querySelector<HTMLInputElement>("#ui-smooth")!;
  smoothEl.addEventListener("input", () => {
    onSmoothChange(Number(smoothEl.value));
  });

  function updateTextRowVisibility(): void {
    const s1 = effectsEl.querySelector<HTMLSelectElement>('[data-effect="thumbIndex"]')?.value as EffectKind;
    const s2 = effectsEl.querySelector<HTMLSelectElement>('[data-effect="indexMiddle"]')?.value as EffectKind;
    textRowEl.hidden = !(s1 === "text" || s2 === "text");
  }

  return { container: parent, statusEl, modesEl, framesEl, effectsEl, textEl, startBtn };
}

export function setStatus(ui: UIElements, message: string, kind: "idle" | "loading" | "ok" | "err" = "idle"): void {
  ui.statusEl.textContent = message;
  ui.statusEl.className = `ui-status ui-status--${kind}`;
}

export function showModes(ui: UIElements): void {
  ui.modesEl.hidden = false;
}

export function setFramesVisible(ui: UIElements, visible: boolean): void {
  ui.framesEl.hidden = !visible;
  ui.effectsEl.hidden = !visible;
}

export function hideStart(ui: UIElements): void {
  ui.startBtn.style.display = "none";
}

function readFrameState(framesEl: HTMLElement): FrameState {
  const thumbIndex = framesEl.querySelector<HTMLButtonElement>('[data-frame="thumbIndex"]')?.classList.contains("active") ?? false;
  const indexMiddle = framesEl.querySelector<HTMLButtonElement>('[data-frame="indexMiddle"]')?.classList.contains("active") ?? false;
  return { thumbIndex, indexMiddle };
}

function readEffectsState(effectsEl: HTMLElement): FrameEffects {
  const thumbIndex = (effectsEl.querySelector<HTMLSelectElement>('[data-effect="thumbIndex"]')?.value ?? "pixelate") as EffectKind;
  const indexMiddle = (effectsEl.querySelector<HTMLSelectElement>('[data-effect="indexMiddle"]')?.value ?? "sobel-x") as EffectKind;
  return { thumbIndex, indexMiddle };
}
