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
