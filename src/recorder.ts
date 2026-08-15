/**
 * recorder.ts
 * ============
 * Record canvas (WebGL) → WebM via MediaRecorder → H.264 MP4 via FFmpeg.wasm.
 * All processing happens client-side. No backend.
 *
 * Pipeline:
 *   canvas.captureStream(fps)
 *   → MediaRecorder → WebM temporary blob
 *   → FFmpeg.wasm (browser) → libx264 ultrafast / yuv420p
 *   → H.264 MP4 blob → download
 *
 * Mobile compatibility:
 *   - Detects SharedArrayBuffer availability
 *   - Multi-thread (@ffmpeg/core-mt) if available (Android Chrome, desktop)
 *   - Single-thread (@ffmpeg/core) fallback if not (iOS Safari)
 *
 * Fixes:
 *   - Progress uses time/duration (ffmpeg.wasm progress field is broken since 0.12.6)
 *   - -preset ultrafast for x264
 *   - Pre-warm function to load FFmpeg core early
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
// @ts-expect-error — Vite worker import for classWorkerURL (used only in multi-thread mode)
import classWorkerUrl from "@ffmpeg/ffmpeg/worker?worker&url";

export type RecorderStatus = "idle" | "recording" | "loading" | "processing" | "completed" | "error";

const HAS_SAB = typeof SharedArrayBuffer !== "undefined";

const FFMPEG_CDN_BASE = HAS_SAB
  ? "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm"
  : "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

/**
 * Extract duration from a video blob in microseconds.
 * Used for accurate progress calculation since ffmpeg.wasm's progress field
 * returns garbage values since v0.12.6+.
 */
function getVideoDurationMicroseconds(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(Math.round(v.duration * 1_000_000));
    };
    v.onerror = () => {
      URL.revokeObjectURL(v.src);
      resolve(0);
    };
    v.src = URL.createObjectURL(blob);
  });
}

async function getFFmpegInstance(
  onStatus?: (s: RecorderStatus) => void,
): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (ffmpegLoading) return ffmpegLoading;

  onStatus?.("loading");

  ffmpegLoading = (async () => {
    const ffmpeg = new FFmpeg();

    const config: Record<string, string> = {
      coreURL: await toBlobURL(`${FFMPEG_CDN_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CDN_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    };

    // Multi-thread: also load worker files
    if (HAS_SAB) {
      config.workerURL = await toBlobURL(`${FFMPEG_CDN_BASE}/ffmpeg-core.worker.js`, "text/javascript");
      config.classWorkerURL = new URL(classWorkerUrl, import.meta.url).toString();
    }

    await ffmpeg.load(config);
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

/**
 * Pre-warm FFmpeg.wasm core in the background.
 * Call this early (e.g. when camera starts) so the first transcode is fast.
 */
export async function warmupFFmpeg(): Promise<void> {
  try {
    await getFFmpegInstance();
  } catch {
    // Non-critical — will retry on first transcode
  }
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "";
  private _status: RecorderStatus = "idle";

  onStatusChange?: (status: RecorderStatus) => void;
  onProgress?: (percent: number) => void;

  get status(): RecorderStatus {
    return this._status;
  }

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  get isProcessing(): boolean {
    return this._status === "processing" || this._status === "loading";
  }

  get canToggle(): boolean {
    return this._status === "idle" || this._status === "completed" || this._status === "error";
  }

  private setStatus(s: RecorderStatus): void {
    this._status = s;
    this.onStatusChange?.(s);
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.isRecording) return;
    if (this._status === "processing" || this._status === "loading") return;

    if (typeof canvas.captureStream !== "function") {
      throw new Error("canvas.captureStream() is not supported in this browser.");
    }

    const stream = canvas.captureStream(fps);

    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not supported in this browser.");
    }

    this.mimeType = pickMimeType();
    if (!this.mimeType) {
      throw new Error("This browser does not support WebM recording.");
    }

    const options = { mimeType: this.mimeType };
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, options);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.setStatus("recording");
  }

  async stop(): Promise<Blob> {
    if (!this.recorder) {
      throw new Error("Not recording");
    }

    const rec = this.recorder;
    const webmBlob = await new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType || "video/webm" }));
        this.recorder = null;
      };
      rec.onerror = () => reject(new Error("MediaRecorder error"));
      rec.stop();
    });

    this.setStatus("processing");

    try {
      const mp4Blob = await this.transcode(webmBlob);
      this.setStatus("completed");
      return mp4Blob;
    } catch (err) {
      this.setStatus("error");
      throw err;
    }
  }

  private async transcode(webmBlob: Blob): Promise<Blob> {
    // Pre-warm or reuse existing instance
    const ffmpeg = await getFFmpegInstance((s) => this.setStatus(s));

    // Get actual video duration for progress calculation
    const durationUs = await getVideoDurationMicroseconds(webmBlob);

    // Listen for progress using `time` field (progress field is broken since 0.12.6+)
    const onProgressHandler = ({ time }: { progress: number; time: number }) => {
      if (durationUs > 0 && time > 0) {
        const pct = Math.round((time / durationUs) * 100);
        this.onProgress?.(Math.min(Math.max(pct, 0), 100));
      }
    };
    ffmpeg.on("progress", onProgressHandler);
    this.onProgress?.(0);

    const inputName = "input.webm";
    const outputName = "output.mp4";

    // Cleanup any leftover files from previous runs
    try { await ffmpeg.deleteFile(inputName); } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* ignore */ }

    // Write WebM blob to FFmpeg virtual filesystem
    const webmData = new Uint8Array(await webmBlob.arrayBuffer());
    await ffmpeg.writeFile(inputName, webmData);

    // Transcode: WebM (VP8) → H.264 MP4 (yuv420p, ultrafast preset)
    await ffmpeg.exec([
      "-i", inputName,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputName,
    ]);

    // Read output MP4
    const outputData = await ffmpeg.readFile(outputName);
    let mp4Blob: Blob;
    if (outputData instanceof Uint8Array) {
      const buf = new ArrayBuffer(outputData.byteLength);
      new Uint8Array(buf).set(outputData);
      mp4Blob = new Blob([new Uint8Array(buf)], { type: "video/mp4" });
    } else {
      mp4Blob = new Blob([new TextEncoder().encode(outputData)], { type: "video/mp4" });
    }

    // Cleanup
    ffmpeg.off("progress", onProgressHandler);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    this.chunks = [];
    this.onProgress?.(100);

    return mp4Blob;
  }

  getExtension(): string {
    return "mp4";
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
