/**
 * carousel.ts
 * ============
 * Teks carousel (array + index wrap-around) + deteksi "two-hand pinch"
 * untuk pindah ke teks berikutnya.
 *
 * Carousel ditampilkan sebagai EFFECT (mirror effect "text" di effects.ts),
 * BUKAN overlay statik — teks hanya muncul saat efek frame = "carousel".
 * Teks di-advance lewat pinch, lalu di-render via EffectQuad.setCarouselText().
 *
 * Pinch metric (two-hand):
 *   dThumb = |h1.thumbTip − h2.thumbTip|
 *   dIndex = |h1.indexTip − h2.indexTip|
 *   avg    = (dThumb + dIndex) / 2
 * Advance saat avg < PINCH_THRESHOLD (debounced: harus lepas dulu).
 *
 * Jarak di-log ke console (throttled) biar gampang trial-error threshold.
 */

import type { Pt2 } from "./handTracker.js";
import type { EffectKind } from "./effects.js";
import type { Texture } from "three";

const LOG_INTERVAL_MS = 400;

export const PINCH_THRESHOLD = 0.1; // normalized 0..1 — placeholder, tune dari log

// ──────────────────────────────────────────────────────────────────────
// Carousel<T> — array + index wrap-around (generic)
// ──────────────────────────────────────────────────────────────────────

export class Carousel<T> {
  readonly items: T[];
  private index = 0;

  constructor(items: T[]) {
    this.items = [...items];
  }

  current(): T {
    return this.items[this.index];
  }

  getIndex(): number {
    return this.index;
  }

  /** Tambah item ke array. */
  add(item: T): void {
    this.items.push(item);
  }

  /** Hapus item berdasarkan index, clamp index bila keluar range. */
  remove(index: number): void {
    if (this.items.length === 0) return;
    this.items.splice(index, 1);
    if (this.index >= this.items.length) this.index = 0;
  }

  /** Maju ke index berikutnya, balik ke 0 setelah elemen terakhir. */
  next(): T {
    if (this.items.length === 0) return this.current();
    this.index = (this.index + 1) % this.items.length;
    return this.current();
  }

  /** Reset index kembali ke 0. */
  reset(): void {
    this.index = 0;
  }
}

// ──────────────────────────────────────────────────────────────────────
// TextCarousel / EffectCycle — spesialisasi Carousel
// ──────────────────────────────────────────────────────────────────────

export class TextCarousel extends Carousel<string> {
  add(text: string): void {
    const t = text.trim();
    if (t) super.add(t);
  }
}

export class EffectCycle extends Carousel<EffectKind> {}

export interface ImageCarouselItem {
  texture: Texture;
  url: string;
  name: string;
}

export class ImageCarousel extends Carousel<ImageCarouselItem> {}

// ──────────────────────────────────────────────────────────────────────
// TwoHandPinchGate — hitung jarak pinch antar dua tangan + debounce advance
// ──────────────────────────────────────────────────────────────────────

export interface PinchResult {
  dThumb: number;
  dIndex: number;
  avg: number;
}

export class TwoHandPinchGate {
  private armed = true; // harus lepas (avg > threshold) dulu sebelum bisa advance lagi
  private lastLogMs = 0;

  /**
   * Ukur jarak pinch antar dua tangan. Return true bila harus advance
   * (pinch < threshold dan gate sudah di-release).
   */
  update(h1: { thumbTip: Pt2; indexTip: Pt2 }, h2: { thumbTip: Pt2; indexTip: Pt2 }): boolean {
    const dThumb = dist(h1.thumbTip, h2.thumbTip);
    const dIndex = dist(h1.indexTip, h2.indexTip);
    const avg = (dThumb + dIndex) / 2;

    this.log(dThumb, dIndex, avg);

    let advance = false;
    if (avg < PINCH_THRESHOLD) {
      if (this.armed) {
        advance = true;
        this.armed = false;
      }
    } else {
      this.armed = true; // lepas → boleh advance lagi
    }

    return advance;
  }

  private log(dThumb: number, dIndex: number, avg: number): void {
    const now = performance.now();
    if (now - this.lastLogMs < LOG_INTERVAL_MS) return;
    this.lastLogMs = now;
    console.log(
      `[carousel] thumb=${dThumb.toFixed(3)} index=${dIndex.toFixed(3)} avg=${avg.toFixed(3)} (threshold=${PINCH_THRESHOLD})`,
    );
  }
}

function dist(a: Pt2, b: Pt2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ──────────────────────────────────────────────────────────────────────
// TwoHandFistGate — deteksi kedua tangan mengepal (clenched fist)
// ──────────────────────────────────────────────────────────────────────

export const TWO_HAND_FIST_THRESHOLD = 0.5;   // fist score < ini = mengepal
export const TWO_HAND_FIST_RELEASE = 0.7;     // fist score > ini = sudah lepas (re-arm)
const FIST_LOG_INTERVAL_MS = 400;

/**
 * Deteksi clenched fist pada satu tangan.
 * Fist score = avg(dist(5 tips, palmCenter)) / handSize.
 * Semakin kecil → semakin mengepal.
 */
export function fistScore(h: { thumbTip: Pt2; indexTip: Pt2; middleTip: Pt2; palmCenter: Pt2; handSize: number; landmarks: Pt2[] }): number {
  if (h.handSize < 0.04) return 999; // tangan tidak terdeteksi

  const tips = [
    h.thumbTip,
    h.indexTip,
    h.middleTip,
    h.landmarks[16], // ring_finger_tip
    h.landmarks[20], // pinky_tip
  ];

  const avgDist = tips.reduce((sum, tip) => sum + dist(tip, h.palmCenter), 0) / tips.length;
  return avgDist / h.handSize;
}

export class TwoHandFistGate {
  private armed = true;
  private lastLogMs = 0;

  /**
   * Cek apakah kedua tangan mengepal. Return true bila harus advance
   * (kedua fist terdeteksi dan gate sudah di-release).
   */
  update(h1: { thumbTip: Pt2; indexTip: Pt2; middleTip: Pt2; palmCenter: Pt2; handSize: number; landmarks: Pt2[] },
         h2: { thumbTip: Pt2; indexTip: Pt2; middleTip: Pt2; palmCenter: Pt2; handSize: number; landmarks: Pt2[] }): boolean {
    const s1 = fistScore(h1);
    const s2 = fistScore(h2);

    this.log(s1, s2);

    const bothFists = s1 < TWO_HAND_FIST_THRESHOLD && s2 < TWO_HAND_FIST_THRESHOLD;
    const bothReleased = s1 > TWO_HAND_FIST_RELEASE && s2 > TWO_HAND_FIST_RELEASE;

    let advance = false;
    if (bothFists) {
      if (this.armed) {
        advance = true;
        this.armed = false;
      }
    } else if (bothReleased) {
      this.armed = true;
    }

    return advance;
  }

  private log(s1: number, s2: number): void {
    const now = performance.now();
    if (now - this.lastLogMs < FIST_LOG_INTERVAL_MS) return;
    this.lastLogMs = now;
    console.log(
      `[fist] s1=${s1.toFixed(3)} s2=${s2.toFixed(3)} (threshold=${TWO_HAND_FIST_THRESHOLD} release=${TWO_HAND_FIST_RELEASE})`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// OneHandFistGate — deteksi tepat 1 tangan mengepal (tangan lain open)
// ──────────────────────────────────────────────────────────────────────

export class OneHandFistGate {
  private armed = true;
  private lastLogMs = 0;

  /**
   * Cek apakah tepat 1 tangan mengepal. Return true bila harus advance
   * (1 fist terdeteksi dan gate sudah di-release).
   */
  update(h1: { thumbTip: Pt2; indexTip: Pt2; middleTip: Pt2; palmCenter: Pt2; handSize: number; landmarks: Pt2[] },
         h2: { thumbTip: Pt2; indexTip: Pt2; middleTip: Pt2; palmCenter: Pt2; handSize: number; landmarks: Pt2[] }): boolean {
    const s1 = fistScore(h1);
    const s2 = fistScore(h2);

    this.log(s1, s2);

    const oneFist = (s1 < TWO_HAND_FIST_THRESHOLD && s2 > TWO_HAND_FIST_RELEASE)
                 || (s2 < TWO_HAND_FIST_THRESHOLD && s1 > TWO_HAND_FIST_RELEASE);
    const bothReleased = s1 > TWO_HAND_FIST_RELEASE && s2 > TWO_HAND_FIST_RELEASE;

    let advance = false;
    if (oneFist) {
      if (this.armed) {
        advance = true;
        this.armed = false;
      }
    } else if (bothReleased) {
      this.armed = true;
    }

    return advance;
  }

  private log(s1: number, s2: number): void {
    const now = performance.now();
    if (now - this.lastLogMs < FIST_LOG_INTERVAL_MS) return;
    this.lastLogMs = now;
    console.log(
      `[oneFist] s1=${s1.toFixed(3)} s2=${s2.toFixed(3)} (threshold=${TWO_HAND_FIST_THRESHOLD} release=${TWO_HAND_FIST_RELEASE})`,
    );
  }
}
