/**
 * recorder.ts
 * ============
 * Record output canvas (WebGL) secara client-side — tanpa backend.
 * Pakai `canvas.captureStream()` + `MediaRecorder`.
 *
 * Format dipaksa MP4 (`video/mp4`), fallback ke WebM bila browser
 * tidak mendukung. Setelah stop → Blob siap di-download.
 */

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "";

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.isRecording) return;
    const stream = canvas.captureStream(fps);
    this.mimeType = pickMimeType();
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, options);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // timeslice 1s supaya chunk reguler
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error("Not recording"));
        return;
      }
      const rec = this.recorder;
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/mp4" });
        this.recorder = null;
        resolve(blob);
      };
      rec.stop();
    });
  }

  getExtension(): string {
    return this.mimeType.includes("mp4") ? "mp4" : "webm";
  }
}

/** Paksa MP4 dulu, fallback ke WebM bila tidak didukung. */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/** Trigger download otomatis untuk Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
