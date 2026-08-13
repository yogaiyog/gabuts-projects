/**
 * ui.ts
 * =====
 * Mode toggle UI (4 mode) + frame sub-state toggles + status messages.
 *
 * Mode buttons:
 *   - "2d"   → 2D Filter (rainbow AR pattern)
 *   - "3d"   → 3D Only (torus anchor)
 *   - "hybrid" → Hybrid (2D + 3D)
 *   - "frame" → Finger Frame (mirror comp5: pixelate + Sobel-X windows)
 *
 * Frame toggles (hanya tampil saat mode = "frame"):
 *   - "Thumb+Index"  → thumbIndex  (frame1: pixelate)
 *   - "Index+Middle" → indexMiddle (frame2: Sobel-X)
 */

export type UIMode = "2d" | "3d" | "hybrid" | "frame";

export interface FrameState {
  thumbIndex: boolean;
  indexMiddle: boolean;
}

export interface UIElements {
  container: HTMLElement;
  statusEl: HTMLElement;
  modesEl: HTMLElement;
  framesEl: HTMLElement;
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
  onStart: () => void;
}): UIElements {
  const { parent, onModeChange, onFramesChange, onStart } = opts;

  parent.innerHTML = `
    <div class="ui-overlay">
      <header class="ui-header">
        <div class="ui-title">Web AR — Hand Filter</div>
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
        <div id="ui-modes" class="ui-modes" hidden>
          ${MODE_ORDER.map((m) => {
            const label = MODE_LABELS[m];
            const isDefault = m === DEFAULT_MODE;
            return `<button data-mode="${m}" class="ui-mode-btn ${isDefault ? "active" : ""}">${label}</button>`;
          }).join("")}
        </div>
      </footer>
    </div>
  `;

  const statusEl = parent.querySelector<HTMLElement>("#ui-status")!;
  const modesEl = parent.querySelector<HTMLElement>("#ui-modes")!;
  const framesEl = parent.querySelector<HTMLElement>("#ui-frames")!;
  const startBtn = parent.querySelector<HTMLElement>("#ui-start")!;

  startBtn.addEventListener("click", () => {
    onStart();
  });

  modesEl.querySelectorAll<HTMLButtonElement>(".ui-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as UIMode;
      modesEl.querySelectorAll(".ui-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      onModeChange(mode);
    });
  });

  framesEl.querySelectorAll<HTMLButtonElement>(".ui-frame-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      onFramesChange(readFrameState(framesEl));
    });
  });

  return { container: parent, statusEl, modesEl, framesEl, startBtn };
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
}

export function hideStart(ui: UIElements): void {
  ui.startBtn.style.display = "none";
}

function readFrameState(framesEl: HTMLElement): FrameState {
  const thumbIndex = framesEl.querySelector<HTMLButtonElement>('[data-frame="thumbIndex"]')?.classList.contains("active") ?? false;
  const indexMiddle = framesEl.querySelector<HTMLButtonElement>('[data-frame="indexMiddle"]')?.classList.contains("active") ?? false;
  return { thumbIndex, indexMiddle };
}
