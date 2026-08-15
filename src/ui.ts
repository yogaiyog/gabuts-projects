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

import { EFFECTS, FRAME_EFFECTS, CYCLE_EFFECT_SOURCE, type EffectKind, type FrameEffect } from "./effects.js";

export type UIMode = "2d" | "3d" | "hybrid" | "frame";

export interface FrameState {
  thumbIndex: boolean;
  indexMiddle: boolean;
}

export interface FrameEffects {
  thumbIndex: FrameEffect;
  indexMiddle: FrameEffect;
}

export interface UIElements {
  container: HTMLElement;
  statusEl: HTMLElement;
  modesEl: HTMLElement;
  framesEl: HTMLElement;
  effectsEl: HTMLElement;
  textEl: HTMLInputElement;
  startBtn: HTMLElement;
  recordBtn: HTMLElement;
  processingEl: HTMLElement;
  processingPctEl: HTMLElement;
  carouselRowEl: HTMLElement;
  carouselListEl: HTMLElement;
  carouselInputEl: HTMLInputElement;
  cycleRowEl: HTMLElement;
  cycleListEl: HTMLElement;
  cycleSelectEl: HTMLSelectElement;
  imageCarouselRowEl: HTMLElement;
  imageCarouselListEl: HTMLElement;
  imageCarouselInputEl: HTMLInputElement;
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
  onImageUpload: (file: File) => void;
  onRecordToggle: () => void;
  onTextColorChange: (hex: string) => void;
  onCarouselAdd: (text: string) => void;
  onCarouselRemove: (index: number) => void;
  onCycleAdd: (effect: EffectKind) => void;
  onCycleRemove: (index: number) => void;
  onImageCarouselAdd: (file: File) => void;
  onImageCarouselRemove: (index: number) => void;
  onCarouselReset: () => void;
  onCycleReset: () => void;
  onImageCarouselReset: () => void;
  onStart: () => void;
}): UIElements {
  const { parent, onModeChange, onFramesChange, onEffectsChange, onTextChange, onSmoothChange, onImageUpload, onRecordToggle, onTextColorChange, onCarouselAdd, onCarouselRemove, onCycleAdd, onCycleRemove, onImageCarouselAdd, onImageCarouselRemove, onCarouselReset, onCycleReset, onImageCarouselReset, onStart } = opts;

  const effectOptions = FRAME_EFFECTS.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  const cycleOptions = CYCLE_EFFECT_SOURCE.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  const modeOptions = MODE_ORDER.map(
    (m) => `<option value="${m}" ${m === DEFAULT_MODE ? "selected" : ""}>${MODE_LABELS[m]}</option>`,
  ).join("");

  parent.innerHTML = `
    <div class="ui-overlay">
      <header class="ui-header">
        <div class="ui-header-text">
          <div class="ui-title">mr.iyog gabuts Projects</div>
          <div class="ui-sub">TouchDesigner port · MediaPipe + Three.js</div>
        </div>
        <button id="ui-record" class="ui-record-btn" hidden>
          <span class="ui-record-dot"></span>
          <span class="ui-record-label">Record</span>
        </button>
      </header>

      <div class="ui-center">
        <button id="ui-start" class="ui-start-btn">
          <span class="ui-start-dot"></span>
          Start Camera
        </button>
      </div>

      <div id="ui-processing" class="ui-processing" hidden>
        <div class="ui-processing-card">
          <div class="ui-processing-spinner"></div>
          <div class="ui-processing-text">Processing video…</div>
          <div id="ui-processing-pct" class="ui-processing-pct"></div>
        </div>
      </div>

      <footer class="ui-controls">
        <div class="ui-controls-inner">
        <div id="ui-status" class="ui-status ui-status--idle">Click "Start Camera" to begin</div>
         <button id="ui-toggle-controls" class="ui-hide-btn">Hide</button>
        <div class="ui-settings" id="ui-settings">
          <div class="ui-settings-inner">
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
              <label class="ui-effect-row" id="ui-image-row" hidden>
                <span>Image</span>
                <input id="ui-image-input" class="ui-image-input" type="file" accept="image/*" />
              </label>
              <label class="ui-effect-row" id="ui-text-color-row" hidden>
                <span>Warna</span>
                <input id="ui-text-color" class="ui-text-color" type="color" value="#ffffff" />
              </label>
              <div class="ui-carousel-row" id="ui-carousel-row" hidden>
                <div class="ui-carousel-head">
                  <span>Text Carousel</span>
                  <span class="ui-carousel-hint">pinch → next</span>
                </div>
                <div id="ui-carousel-list" class="ui-carousel-list"></div>
                <div class="ui-carousel-add">
                  <input id="ui-carousel-input" class="ui-carousel-input" type="text" placeholder="Add text…" />
                  <button id="ui-carousel-add" class="ui-carousel-add-btn" title="Add">+</button>
                  <button id="ui-carousel-reset" class="ui-carousel-reset-btn" title="Reset index">↺</button>
                </div>
              </div>
              <div class="ui-carousel-row" id="ui-cycle-row" hidden>
                <div class="ui-carousel-head">
                  <span>Effect Cycle</span>
                  <span class="ui-carousel-hint">pinch → next</span>
                </div>
                <div id="ui-cycle-list" class="ui-carousel-list"></div>
                <div class="ui-carousel-add">
                  <select id="ui-cycle-select" class="ui-effect-select">${cycleOptions}</select>
                  <button id="ui-cycle-add" class="ui-carousel-add-btn" title="Add">+</button>
                  <button id="ui-cycle-reset" class="ui-carousel-reset-btn" title="Reset index">↺</button>
                </div>
              </div>
              <div class="ui-carousel-row" id="ui-image-carousel-row" hidden>
                <div class="ui-carousel-head">
                  <span>Image Carousel</span>
                  <span class="ui-carousel-hint">pinch → next</span>
                </div>
                <div id="ui-image-carousel-list" class="ui-carousel-list"></div>
                <div class="ui-carousel-add">
                  <input id="ui-image-carousel-input" class="ui-carousel-input" type="file" accept="image/*" />
                  <button id="ui-image-carousel-reset" class="ui-carousel-reset-btn" title="Reset index">↺</button>
                </div>
              </div>
              <label class="ui-effect-row">
                <span>Smooth</span>
                <input id="ui-smooth" class="ui-smooth" type="range" min="0" max="100" value="50" />
              </label>
            </div>
            <label class="ui-effect-row" id="ui-mode-row" hidden>
              <span>Mode</span>
              <select id="ui-mode-select" class="ui-effect-select">${modeOptions}</select>
            </label>
          </div>
        </div>
        </div>
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
  const imageRowEl = parent.querySelector<HTMLElement>("#ui-image-row")!;
  const imageInputEl = parent.querySelector<HTMLInputElement>("#ui-image-input")!;
  const textColorRowEl = parent.querySelector<HTMLElement>("#ui-text-color-row")!;
  const textColorEl = parent.querySelector<HTMLInputElement>("#ui-text-color")!;
  const startBtn = parent.querySelector<HTMLElement>("#ui-start")!;
  const recordBtn = parent.querySelector<HTMLElement>("#ui-record")!;
  const processingEl = parent.querySelector<HTMLElement>("#ui-processing")!;
  const processingPctEl = parent.querySelector<HTMLElement>("#ui-processing-pct")!;
  const carouselRowEl = parent.querySelector<HTMLElement>("#ui-carousel-row")!;
  const carouselListEl = parent.querySelector<HTMLElement>("#ui-carousel-list")!;
  const carouselInputEl = parent.querySelector<HTMLInputElement>("#ui-carousel-input")!;
  const carouselAddBtn = parent.querySelector<HTMLElement>("#ui-carousel-add")!;
  const cycleRowEl = parent.querySelector<HTMLElement>("#ui-cycle-row")!;
  const cycleListEl = parent.querySelector<HTMLElement>("#ui-cycle-list")!;
  const cycleSelectEl = parent.querySelector<HTMLSelectElement>("#ui-cycle-select")!;
  const cycleAddBtn = parent.querySelector<HTMLElement>("#ui-cycle-add")!;
  const imageCarouselRowEl = parent.querySelector<HTMLElement>("#ui-image-carousel-row")!;
  const imageCarouselListEl = parent.querySelector<HTMLElement>("#ui-image-carousel-list")!;
  const imageCarouselInputEl = parent.querySelector<HTMLInputElement>("#ui-image-carousel-input")!;
  const carouselResetBtn = parent.querySelector<HTMLElement>("#ui-carousel-reset")!;
  const cycleResetBtn = parent.querySelector<HTMLElement>("#ui-cycle-reset")!;
  const imageCarouselResetBtn = parent.querySelector<HTMLElement>("#ui-image-carousel-reset")!;

  startBtn.addEventListener("click", () => {
    onStart();
  });

  recordBtn.addEventListener("click", () => {
    onRecordToggle();
  });

  function submitCarouselAdd(): void {
    const value = carouselInputEl.value;
    if (value.trim()) {
      onCarouselAdd(value);
      carouselInputEl.value = "";
    }
  }

  carouselAddBtn.addEventListener("click", submitCarouselAdd);
  carouselInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCarouselAdd();
  });
  carouselListEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".ui-carousel-remove");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (!Number.isNaN(idx)) onCarouselRemove(idx);
  });

  cycleAddBtn.addEventListener("click", () => {
    onCycleAdd(cycleSelectEl.value as EffectKind);
  });
  cycleListEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".ui-carousel-remove");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (!Number.isNaN(idx)) onCycleRemove(idx);
  });

  imageCarouselInputEl.addEventListener("change", () => {
    const file = imageCarouselInputEl.files?.[0];
    if (file) onImageCarouselAdd(file);
  });
  imageCarouselListEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".ui-carousel-remove");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (!Number.isNaN(idx)) onImageCarouselRemove(idx);
  });

  carouselResetBtn.addEventListener("click", () => onCarouselReset());
  cycleResetBtn.addEventListener("click", () => onCycleReset());
  imageCarouselResetBtn.addEventListener("click", () => onImageCarouselReset());

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
      syncEffectRows(effectsEl);
      onEffectsChange(readEffectsState(effectsEl));
    });
  });

  textEl.addEventListener("input", () => {
    onTextChange(textEl.value);
  });

  imageInputEl.addEventListener("change", () => {
    const file = imageInputEl.files?.[0];
    if (file) onImageUpload(file);
  });

  textColorEl.addEventListener("input", () => {
    onTextColorChange(textColorEl.value);
  });

  const smoothEl = parent.querySelector<HTMLInputElement>("#ui-smooth")!;
  smoothEl.addEventListener("input", () => {
    onSmoothChange(Number(smoothEl.value));
  });

  const settingsEl = parent.querySelector<HTMLElement>("#ui-settings")!;
  const toggleBtn = parent.querySelector<HTMLElement>("#ui-toggle-controls")!;
  toggleBtn.addEventListener("click", () => {
    const willHide = !settingsEl.classList.contains("collapsed");
    settingsEl.classList.toggle("collapsed", willHide);
    toggleBtn.textContent = willHide ? "Show" : "Hide";
  });

  function updateTextRowVisibility(): void {
    syncEffectRows(effectsEl);
  }

  return {
    container: parent,
    statusEl,
    modesEl,
    framesEl,
    effectsEl,
    textEl,
    startBtn,
    recordBtn,
    processingEl,
    processingPctEl,
    carouselRowEl,
    carouselListEl,
    carouselInputEl,
    cycleRowEl,
    cycleListEl,
    cycleSelectEl,
    imageCarouselRowEl,
    imageCarouselListEl,
    imageCarouselInputEl,
  };
}

export function setStatus(ui: UIElements, message: string, kind: "idle" | "loading" | "ok" | "err" = "idle"): void {
  ui.statusEl.textContent = message;
  ui.statusEl.className = `ui-status ui-status--${kind}`;
}

export function showModes(ui: UIElements): void {
  ui.modesEl.hidden = false;
}

export function showRecord(ui: UIElements): void {
  ui.recordBtn.hidden = false;
}

export function setRecording(ui: UIElements, recording: boolean): void {
  ui.recordBtn.classList.toggle("recording", recording);
  const label = ui.recordBtn.querySelector<HTMLElement>(".ui-record-label");
  if (label) label.textContent = recording ? "Stop" : "Record";
}

export function setProcessing(ui: UIElements, processing: boolean, progress?: number, loading?: boolean): void {
  ui.processingEl.hidden = !processing;
  if (processing) {
    const label = ui.recordBtn.querySelector<HTMLElement>(".ui-record-label");
    if (label) label.textContent = "Stop";
    ui.recordBtn.classList.add("recording");
    const textEl = ui.processingEl.querySelector<HTMLElement>(".ui-processing-text");
    if (textEl) {
      textEl.textContent = loading ? "Downloading video processor…" : "Processing video…";
    }
    if (progress !== undefined) {
      ui.processingPctEl.textContent = `${progress}%`;
    } else {
      ui.processingPctEl.textContent = "";
    }
  } else {
    const label = ui.recordBtn.querySelector<HTMLElement>(".ui-record-label");
    if (label) label.textContent = "Record";
    ui.recordBtn.classList.remove("recording");
    ui.processingPctEl.textContent = "";
  }
}

export function setRecordDisabled(ui: UIElements, disabled: boolean): void {
  (ui.recordBtn as HTMLButtonElement).disabled = disabled;
}

export function renderCarouselList(ui: UIElements, items: string[], activeIndex: number): void {
  if (items.length === 0) {
    ui.carouselListEl.innerHTML = '<div class="ui-carousel-empty">No items — add below</div>';
    return;
  }
  ui.carouselListEl.innerHTML = items
    .map(
      (t, i) => `
        <div class="ui-carousel-item${i === activeIndex ? " active" : ""}">
          <span class="ui-carousel-text">${escapeHtml(t)}</span>
          <button class="ui-carousel-remove" data-index="${i}" title="Remove">−</button>
        </div>`,
    )
    .join("");
}

export function renderCycleList(ui: UIElements, items: EffectKind[], activeIndex: number): void {
  const labelOf = (id: EffectKind): string => EFFECT_LABELS[id] ?? id;
  if (items.length === 0) {
    ui.cycleListEl.innerHTML = '<div class="ui-carousel-empty">No effects — add below</div>';
    return;
  }
  ui.cycleListEl.innerHTML = items
    .map(
      (id, i) => `
        <div class="ui-carousel-item${i === activeIndex ? " active" : ""}">
          <span class="ui-carousel-text">${escapeHtml(labelOf(id))}</span>
          <button class="ui-carousel-remove" data-index="${i}" title="Remove">−</button>
        </div>`,
    )
    .join("");
}

export interface ImageCarouselItemUI {
  url: string;
  name: string;
}

export function renderImageCarouselList(ui: UIElements, items: ImageCarouselItemUI[], activeIndex: number): void {
  if (items.length === 0) {
    ui.imageCarouselListEl.innerHTML = '<div class="ui-carousel-empty">No images — select below</div>';
    return;
  }
  ui.imageCarouselListEl.innerHTML = items
    .map(
      (item, i) => `
        <div class="ui-carousel-item${i === activeIndex ? " active" : ""}">
          <img class="ui-carousel-thumb" src="${item.url}" alt="${escapeHtml(item.name)}" />
          <span class="ui-carousel-text">${escapeHtml(item.name)}</span>
          <button class="ui-carousel-remove" data-index="${i}" title="Remove">−</button>
        </div>`,
    )
    .join("");
}

const EFFECT_LABELS: Record<EffectKind, string> = EFFECTS.reduce(
  (acc, e) => {
    acc[e.id] = e.label;
    return acc;
  },
  {} as Record<EffectKind, string>,
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function setFramesVisible(ui: UIElements, visible: boolean): void {
  ui.framesEl.hidden = !visible;
  ui.effectsEl.hidden = !visible;
}

export function setEffectsUI(ui: UIElements, state: FrameEffects): void {
  const ti = ui.effectsEl.querySelector<HTMLSelectElement>('[data-effect="thumbIndex"]');
  const im = ui.effectsEl.querySelector<HTMLSelectElement>('[data-effect="indexMiddle"]');
  if (ti) ti.value = state.thumbIndex;
  if (im) im.value = state.indexMiddle;
  syncEffectRows(ui.effectsEl);
}

function syncEffectRows(effectsEl: HTMLElement): void {
  const s1 = effectsEl.querySelector<HTMLSelectElement>('[data-effect="thumbIndex"]')?.value as FrameEffect;
  const s2 = effectsEl.querySelector<HTMLSelectElement>('[data-effect="indexMiddle"]')?.value as FrameEffect;

  const textRowEl = effectsEl.querySelector<HTMLElement>("#ui-text-row");
  const imageRowEl = effectsEl.querySelector<HTMLElement>("#ui-image-row");
  const textColorRowEl = effectsEl.querySelector<HTMLElement>("#ui-text-color-row");
  const carouselRowEl = effectsEl.querySelector<HTMLElement>("#ui-carousel-row");
  const cycleRowEl = effectsEl.querySelector<HTMLElement>("#ui-cycle-row");
  const imageCarouselRowEl = effectsEl.querySelector<HTMLElement>("#ui-image-carousel-row");

  if (textRowEl) textRowEl.hidden = !(s1 === "text" || s2 === "text");
  if (imageRowEl) imageRowEl.hidden = !(s1 === "image" || s2 === "image");
  if (textColorRowEl) textColorRowEl.hidden = !(s1 === "text" || s2 === "text" || s1 === "carousel" || s2 === "carousel");
  if (carouselRowEl) carouselRowEl.hidden = !(s1 === "carousel" || s2 === "carousel");
  if (cycleRowEl) cycleRowEl.hidden = !(s1 === "cycle" || s2 === "cycle");
  if (imageCarouselRowEl) imageCarouselRowEl.hidden = !(s1 === "image-carousel" || s2 === "image-carousel");
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
  const thumbIndex = (effectsEl.querySelector<HTMLSelectElement>('[data-effect="thumbIndex"]')?.value ?? "pixelate") as FrameEffect;
  const indexMiddle = (effectsEl.querySelector<HTMLSelectElement>('[data-effect="indexMiddle"]')?.value ?? "sobel-x") as FrameEffect;
  return { thumbIndex, indexMiddle };
}
