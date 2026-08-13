/**
 * main.ts
 * =======
 * Entry point.
 *
 * Boot sequence:
 *   1. Generate AR pattern texture (Canvas2D)
 *   2. Build compositor (Three.js scene, 4 modes)
 *   3. Wire UI handlers (4 buttons: 2D / 3D / Hybrid / Finger Frame)
 *   4. On user click "Start Camera":
 *      a) getUserMedia
 *      b) load MediaPipe HandLandmarker (numHands=2)
 *      c) attach video to compositor
 *      d) start RAF loop: each frame → detectHand → render
 */

import { Camera } from "./camera.js";
import { HandTracker } from "./handTracker.js";
import { Compositor } from "./compositor.js";
import { generateARPatternTexture } from "./arPattern.js";
import { buildUI, setStatus, showModes, hideStart, setFramesVisible, type UIMode, type FrameState } from "./ui.js";
import type { MultiHandResult } from "./handTracker.js";

const DEFAULT_MODE: UIMode = "frame";

async function bootstrap() {
  const canvas = document.getElementById("ar-canvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Missing #ar-canvas element");
  const overlay = document.getElementById("ui-container")!;
  if (!overlay) throw new Error("Missing #ui-container element");

  // 1. Pattern texture
  const patternTexture = generateARPatternTexture({ width: 1280, height: 720 });

  // 2. Compositor
  const compositor = new Compositor({
    canvas,
    patternTexture,
  });

  // 3. UI
  let currentMode: UIMode = DEFAULT_MODE;
  let frameState: FrameState = { thumbIndex: true, indexMiddle: true };
  const ui = buildUI({
    parent: overlay,
    onModeChange: (mode: UIMode) => {
      currentMode = mode;
      compositor.setMode(mode);
      setFramesVisible(ui, mode === "frame");
      updateModeStatus();
    },
    onFramesChange: (state: FrameState) => {
      frameState = state;
      compositor.setFrames(state);
    },
    onStart: () => {
      void startCamera();
    },
  });

  compositor.setMode(DEFAULT_MODE);
  compositor.setFrames(frameState);
  setFramesVisible(ui, DEFAULT_MODE === "frame");

  function updateModeStatus(): void {
    if (!tracker) return;
    const status = currentModeStatus(currentMode, lastHandsResult, lastError);
    setStatus(ui, status.msg, status.kind);
  }

  // Helper: keep canvas matching window size
  const fitCanvas = () => {
    const r = canvas.getBoundingClientRect();
    compositor.resize(r.width, r.height);
  };
  window.addEventListener("resize", fitCanvas);
  fitCanvas();

  // Lazy holders
  let camera: Camera | null = null;
  let tracker: HandTracker | null = null;
  let lastHandsResult: MultiHandResult = emptyHands();
  let lastError: string | null = null;

  // Hidden video element for MediaPipe source + WebGL texture source
  const videoEl = document.createElement("video");
  videoEl.style.position = "absolute";
  videoEl.style.left = "-9999px";
  videoEl.style.width = "1px";
  videoEl.style.height = "1px";
  document.body.appendChild(videoEl);

  async function startCamera() {
    hideStart(ui);
    setStatus(ui, "Requesting camera permission…", "loading");

    try {
      camera = await Camera.open(videoEl, { width: 1280, height: 720 });
      await camera.ready;
      compositor.setVideo(camera.video);

      const fitToVideo = () => {
        const r = canvas.getBoundingClientRect();
        compositor.resize(r.width, r.height);
      };
      camera.video.addEventListener("loadedmetadata", fitToVideo);
      fitToVideo();

      setStatus(ui, "Loading hand tracking model…", "loading");

      tracker = await HandTracker.create({
        modelAssetPath: "/models/hand_landmarker.task",
        wasmBaseUrl: "/wasm",
        numHands: 2,
      });

      setStatus(ui, currentModeStatus(currentMode, lastHandsResult, null).msg, "ok");
      showModes(ui);

      compositor.start((timeSec) => {
        const ts = performance.now();
        const hands = tracker?.detect(camera!.video, ts) ?? lastHandsResult;
        lastHandsResult = hands;
        compositor.render(hands, timeSec);

        // Status message update — throttled to avoid DOM thrash
        const statusEl = ui.statusEl;
        if (!statusEl.dataset.manual) {
          const status = currentModeStatus(currentMode, hands, lastError);
          if (statusEl.textContent !== status.msg) {
            statusEl.textContent = status.msg;
            statusEl.className = `ui-status ui-status--${status.kind}`;
          }
        }
      });

      window.addEventListener("beforeunload", () => {
        camera?.stop();
        tracker?.dispose();
        compositor.dispose();
      });
    } catch (err) {
      console.error(err);
      lastError = err instanceof Error ? err.message : String(err);
      setStatus(ui, `Error: ${lastError}`, "err");
      ui.startBtn.style.display = "";
      ui.startBtn.textContent = "Retry";
    }
  }
}

function currentModeStatus(
  mode: UIMode,
  hands: MultiHandResult,
  err: string | null,
): { msg: string; kind: "idle" | "loading" | "ok" | "err" } {
  if (err) return { msg: `Error: ${err}`, kind: "err" };

  if (mode === "frame") {
    if (hands.numDetected === 0) return { msg: "Show both hands to the camera", kind: "idle" };
    if (hands.numDetected === 1) return { msg: "Need 2 hands for Finger Frame — show the other", kind: "idle" };
    return { msg: "Finger Frame active (2 hands)", kind: "ok" };
  }

  // legacy modes
  if (hands.numDetected === 0) return { msg: "Show your hand to the camera", kind: "idle" };
  return { msg: `Mode: ${modeLabel(mode)}`, kind: "ok" };
}

function modeLabel(mode: UIMode): string {
  if (mode === "2d") return "2D Filter";
  if (mode === "3d") return "3D Only";
  if (mode === "hybrid") return "Hybrid";
  return "Finger Frame";
}

function emptyHands(): MultiHandResult {
  return {
    hands: [
      {
        detected: false,
        landmarks: [],
        thumbTip: { x: 0, y: 0 },
        indexTip: { x: 0, y: 0 },
        middleTip: { x: 0, y: 0 },
        middleDip: { x: 0, y: 0 },
        palmCenter: { x: 0, y: 0 },
        handSize: 0,
        handedness: "",
      },
      {
        detected: false,
        landmarks: [],
        thumbTip: { x: 0, y: 0 },
        indexTip: { x: 0, y: 0 },
        middleTip: { x: 0, y: 0 },
        middleDip: { x: 0, y: 0 },
        palmCenter: { x: 0, y: 0 },
        handSize: 0,
        handedness: "",
      },
    ],
    numDetected: 0,
    videoSize: { width: 1280, height: 720 },
  };
}

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal:", err);
  const overlay = document.getElementById("ui-container");
  if (overlay) {
    overlay.innerHTML = `<div class="ui-fatal">Fatal error: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
});
