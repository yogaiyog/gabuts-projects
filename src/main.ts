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
import { buildUI, setStatus, showModes, hideStart, setFramesVisible, showRecord, setRecording, setProcessing, setRecordDisabled, renderCarouselList, renderCycleList, renderImageCarouselList, setEffectsUI, type UIMode, type FrameState, type FrameEffects, type ImageCarouselItemUI } from "./ui.js";
import { CanvasRecorder, downloadBlob, warmupFFmpeg } from "./recorder.js";
import { TextCarousel, EffectCycle, ImageCarousel, OneHandFistGate, fistScore } from "./carousel.js";
import type { EffectKind } from "./effects.js";
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
  let effectsState: FrameEffects = { thumbIndex: "text", indexMiddle: "cycle" };
  const DEFAULT_TEXT = "fist + openhand to change effect";

  // ──────── Teks carousel + effect cycle + image carousel + pinch (two-hand) ────────
  const carousel = new TextCarousel(["kepal untuk next effect", "tempel jari kiri dan kanan ganti teks", "jan lupa follow ya"]);
  const cycle = new EffectCycle(["pixelate", "sobel-x", "invert", "blur"]);
  const imageCarousel = new ImageCarousel([]);
  const oneFistGate = new OneHandFistGate();
  let twoFistDebounce = false; // prevent 1-fist clear right after 2-fist release

  function resolveEffects(state: FrameEffects): { thumbIndex: EffectKind; indexMiddle: EffectKind } {
    const cur = cycle.current() ?? "pixelate";
    return {
      thumbIndex: state.thumbIndex === "cycle" ? cur : state.thumbIndex,
      indexMiddle: state.indexMiddle === "cycle" ? cur : state.indexMiddle,
    };
  }

  function applyEffects(): void {
    compositor.setEffects(resolveEffects(effectsState));
  }

  function syncCarousel(): void {
    compositor.setCarouselText(carousel.current());
    renderCarouselList(ui, carousel.items, carousel.getIndex());
  }

  function syncCycle(): void {
    renderCycleList(ui, cycle.items, cycle.getIndex());
  }

  function syncImageCarousel(): void {
    const cur = imageCarousel.current();
    compositor.setImageCarousel(cur?.texture ?? null);
    const uiItems: ImageCarouselItemUI[] = imageCarousel.items.map((it) => ({ url: it.url, name: it.name }));
    renderImageCarouselList(ui, uiItems, imageCarousel.getIndex());
  }

  const recorder = new CanvasRecorder();
  recorder.onProgress = (percent) => {
    setProcessing(ui, true, percent);
  };
  recorder.onStatusChange = (status) => {
    if (status === "loading") {
      setProcessing(ui, true, undefined, true);
    } else if (status === "processing") {
      setProcessing(ui, true);
    }
  };
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
    onEffectsChange: (state: FrameEffects) => {
      effectsState = state;
      applyEffects();
    },
    onTextChange: (text: string) => {
      compositor.setText(text);
    },
    onSmoothChange: (value: number) => {
      compositor.setSmoothing(value);
    },
    onImageUpload: (file: File) => {
      compositor.setImageFromFile(file);
    },
    onTextColorChange: (hex: string) => {
      compositor.setTextColor(hex);
    },
    onRecordToggle: async () => {
      if (recorder.isProcessing) return;
      if (recorder.isRecording) {
        setRecording(ui, false);
        setStatus(ui, "Processing video…", "loading");
        setProcessing(ui, true);
        setRecordDisabled(ui, true);
        try {
          const blob = await recorder.stop();
          setProcessing(ui, false);
          setRecordDisabled(ui, false);
          setStatus(ui, "Video ready ✓", "ok");
          setRecording(ui, false);
          downloadBlob(blob, `recording-${Date.now()}.mp4`);
        } catch (err) {
          setProcessing(ui, false);
          setRecordDisabled(ui, false);
          const msg = err instanceof Error ? err.message : String(err);
          setStatus(ui, `Processing failed: ${msg}`, "err");
          setRecording(ui, false);
        }
      } else {
        recorder.start(canvas, 30);
        setRecording(ui, true);
      }
    },
    onCarouselAdd: (text: string) => {
      carousel.add(text);
      syncCarousel();
    },
    onCarouselRemove: (index: number) => {
      carousel.remove(index);
      syncCarousel();
    },
    onCycleAdd: (effect: EffectKind) => {
      cycle.add(effect);
      applyEffects();
      syncCycle();
    },
    onCycleRemove: (index: number) => {
      cycle.remove(index);
      applyEffects();
      syncCycle();
    },
    onImageCarouselAdd: (file: File) => {
      compositor.loadImageCarouselTexture(file).then(({ texture, url }) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        imageCarousel.add({ texture, url, name });
        syncImageCarousel();
      }).catch((err) => console.error("Failed to load image carousel:", err));
    },
    onImageCarouselRemove: (index: number) => {
      imageCarousel.remove(index);
      syncImageCarousel();
    },
    onCarouselReset: () => {
      carousel.reset();
      syncCarousel();
    },
    onCycleReset: () => {
      cycle.reset();
      applyEffects();
      syncCycle();
    },
    onImageCarouselReset: () => {
      imageCarousel.reset();
      syncImageCarousel();
    },
    onStart: () => {
      void startCamera();
    },
  });

  compositor.setMode(DEFAULT_MODE);
  compositor.setFrames(frameState);
  applyEffects();
  setEffectsUI(ui, effectsState);
  setFramesVisible(ui, DEFAULT_MODE === "frame");
  compositor.setText(DEFAULT_TEXT);
  ui.textEl.value = DEFAULT_TEXT;
  syncCarousel();
  syncCycle();
  syncImageCarousel();

  // Load gambar default untuk effect "image".
  compositor.loadImageFromUrl("/juaraku-text-2.png");

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

  // ──────── Rainbow Tone Color Tint ────────
  const RAINBOW_COLORS = [
    0xFF0000, // Red
    0xFF7F00, // Orange
    0xFFFF00, // Yellow
    0x00FF00, // Green
    0x0000FF, // Blue
    0x4B0082, // Indigo
    0x9400D3, // Violet
  ];
  let tintActive = false;
  let prevBothFists = false;

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

    // Pre-warm FFmpeg.wasm in background (loads ~31MB WASM core)
    void warmupFFmpeg();

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
      showRecord(ui);

      compositor.start((timeSec) => {
        const ts = performance.now();
        const hands = tracker?.detect(camera!.video, ts) ?? lastHandsResult;
        lastHandsResult = hands;

        // ──────── Gesture logic (swapped: 1 fist = effect cycle, 2 fists = tint) ────────
        if (currentMode === "frame" && hands.numDetected === 2) {
          let [h1, h2] = [hands.hands[0], hands.hands[1]];
          if (h1.palmCenter.x < h2.palmCenter.x) [h1, h2] = [h2, h1];

          const s1 = fistScore(h1);
          const s2 = fistScore(h2);
          const oneFistOneOpen = (s1 < 0.5 && s2 > 0.7) || (s2 < 0.5 && s1 > 0.7);
          const bothFists = s1 < 0.5 && s2 < 0.5;
          const bothReleased = s1 > 0.7 && s2 > 0.7;

          // ── 2 fists → apply random tint (latching), set debounce ──
          if (bothFists && !prevBothFists) {
            const shuffled = [...RAINBOW_COLORS].sort(() => Math.random() - 0.5);
            compositor.fingerFrame.setTintColor(shuffled[0], shuffled[1]);
            compositor.fingerFrame.setTintAlpha(0.35);
            tintActive = true;
            twoFistDebounce = true;
          }

          // ── Release from 2 fists → debounce ON (block 1-fist clear) ──
          if (!bothFists && prevBothFists) {
            // Don't clear tint, keep debounce active
          }

          // ── Both fully released → clear debounce ──
          if (bothReleased) {
            twoFistDebounce = false;
          }

          // ── 1 fist + 1 open (with debounce guard) ──
          if (oneFistOneOpen && !twoFistDebounce) {
            // Clear tint if active
            if (tintActive) {
              compositor.fingerFrame.clearTint();
              tintActive = false;
            }
          }

          prevBothFists = bothFists;

        } else if (currentMode === "frame" && hands.numDetected !== 2) {
          // Tangan berkurang (< 2) → reset tint
          if (tintActive) {
            compositor.fingerFrame.clearTint();
            tintActive = false;
          }
          prevBothFists = false;
          twoFistDebounce = false;
        }

        // Advance effect cycle: tepat 1 tangan mengepal (debounced via OneHandFistGate).
        // Tidak advance carousel / imageCarousel — hanya EffectCycle.
        if (hands.numDetected >= 2 && !twoFistDebounce) {
          let [h1, h2] = [hands.hands[0], hands.hands[1]];
          if (h1.palmCenter.x < h2.palmCenter.x) [h1, h2] = [h2, h1];
          if (oneFistGate.update(h1, h2)) {
            cycle.next();
            applyEffects();
            syncCycle();
          }
        }

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
