/**
 * camera.ts
 * =========
 * Wrapper untuk `getUserMedia` yang:
 *   - minta izin kamera depan (selfie)
 *   - set `<video>` element ke mode mute+autoplay+playsInline (wajib untuk iOS)
 *   - tunggu `loadedmetadata` agar `videoWidth/videoHeight` tersedia
 *   - expose promise `ready` yang baru resolve setelah stream aktif
 *
 * Default constraints cocok untuk desktop browser.
 */

export interface CameraOptions {
  width?: number;
  height?: number;
  facingMode?: "user" | "environment";
}

export class Camera {
  readonly video: HTMLVideoElement;
  readonly stream: MediaStream;
  ready: Promise<void>;

  constructor(video: HTMLVideoElement, stream: MediaStream, opts: CameraOptions = {}) {
    this.video = video;
    this.stream = stream;

    video.srcObject = stream;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onErr);
        video
          .play()
          .then(() => resolve())
          .catch((err) => reject(err));
      };
      const onErr = (e: Event) => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onErr);
        reject(new Error(`Camera video error: ${(e as ErrorEvent).message ?? e}`));
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onErr);
    });
  }

  static async open(video: HTMLVideoElement, opts: CameraOptions = {}): Promise<Camera> {
    const width = opts.width ?? 1280;
    const height = opts.height ?? 720;
    const facingMode = opts.facingMode ?? "user";

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser tidak mendukung getUserMedia (perlu HTTPS / modern browser).");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode,
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30, max: 60 },
      },
    });

    return new Camera(video, stream, opts);
  }

  get width(): number {
    return this.video.videoWidth || 1280;
  }

  get height(): number {
    return this.video.videoHeight || 720;
  }

  stop(): void {
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
