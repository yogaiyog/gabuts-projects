/**
 * fingerFrame.ts (PATCHED)
 * ==============
 * Fix: sekarang mengirim DUA set corner ke tiap EffectQuad:
 *   1. World corners (via `v()`) → posisi quad di layar, tetap sama.
 *   2. UV corners (landmark mentah 0..1, dg Y di-flip) → menentukan
 *      area video yang di-crop & ditampilkan di dalam quad.
 *
 * Sebelumnya cuma world corners yang dikirim, dan fragment shader
 * sample dari UV plane utuh (0..1) — sehingga isi quad selalu SELURUH
 * frame webcam yang di-squeeze, bukan crop dari area di balik jari.
 */

import * as THREE from "three";
import { EffectQuad, EdgeQuad, TipDots, type EffectKind } from "./effects.js";
import { PointSmoother } from "./smoothing.js";
import type { MultiHandResult } from "./handTracker.js";

const FRAME_BLUE = 0x2776ea; // #2776EA

interface HandSmoother {
  thumb: PointSmoother;
  index: PointSmoother;
  middle: PointSmoother;
  middleDip: PointSmoother;
}

// Mapping slider 0..100 → minCutoff (Hz), log-scale. Default 50 ≈ 1.55 Hz.
const MIN_CUTOFF_LOW = 0.3; // s=100 (sangat smooth)
const MIN_CUTOFF_HIGH = 8.0; // s=0 (hampir raw)
function minCutoffFromSlider(s: number): number {
  const t = Math.max(0, Math.min(100, s)) / 100;
  return Math.exp(Math.log(MIN_CUTOFF_LOW) + (1 - t) * (Math.log(MIN_CUTOFF_HIGH) - Math.log(MIN_CUTOFF_LOW)));
}

function makeHandSmoother(minCutoff: number): HandSmoother {
  return {
    thumb: new PointSmoother(minCutoff),
    index: new PointSmoother(minCutoff),
    middle: new PointSmoother(minCutoff),
    middleDip: new PointSmoother(minCutoff),
  };
}

interface SmoothHand {
  thumbTip: THREE.Vector2;
  indexTip: THREE.Vector2;
  middleTip: THREE.Vector2;
  middleDip: THREE.Vector2;
}

function smoothHand(
  h: { thumbTip: { x: number; y: number }; indexTip: { x: number; y: number }; middleTip: { x: number; y: number }; middleDip: { x: number; y: number } },
  s: HandSmoother,
  time: number,
): SmoothHand {
  const t = s.thumb.filter(h.thumbTip.x, h.thumbTip.y, time);
  const i = s.index.filter(h.indexTip.x, h.indexTip.y, time);
  const m = s.middle.filter(h.middleTip.x, h.middleTip.y, time);
  const d = s.middleDip.filter(h.middleDip.x, h.middleDip.y, time);
  return {
    thumbTip: new THREE.Vector2(t.x, t.y),
    indexTip: new THREE.Vector2(i.x, i.y),
    middleTip: new THREE.Vector2(m.x, m.y),
    middleDip: new THREE.Vector2(d.x, d.y),
  };
}

export class FingerFrameCompositor {
  readonly pixQuad: EffectQuad;   // corner1 → pixelate
  readonly sobelQuad: EffectQuad; // corner2 → Sobel-X
  readonly edge1: EdgeQuad;       // outline corner1 (biru transparan)
  readonly edge2: EdgeQuad;       // outline corner2 (biru transparan)
  readonly thumbDots: TipDots;    // marker thumb (2 tangan)
  readonly indexDots: TipDots;    // marker index (2 tangan)
  readonly middleDots: TipDots;   // marker middle (2 tangan)

  private visible = false;
  private showThumbIndex = true;  // frame1: thumb↔index (pixelate)
  private showIndexMiddle = true; // frame2: index↔middle (Sobel-X)
  private effect1: EffectKind = "pixelate"; // efek frame1 (thumb↔index)
  private effect2: EffectKind = "sobel-x";  // efek frame2 (index↔middle)
  private smoother1: HandSmoother;
  private smoother2: HandSmoother;
  private smoothingValue = 50;

  constructor(
    scene: THREE.Scene,
    sourceTexture: THREE.Texture,
    texSize: { width: number; height: number },
  ) {
    this.pixQuad = new EffectQuad({
      sourceTexture,
      effect: "pixelate",
      texSize,
      blockH: 28,
      blockV: 27,
      renderOrder: 10,
    });
    scene.add(this.pixQuad.mesh);

    this.edge1 = new EdgeQuad({
      renderOrder: 11,
      edgeWidthPx: 3,
      color: FRAME_BLUE,
      alpha: 0.55,
    });
    scene.add(this.edge1.mesh);

    this.sobelQuad = new EffectQuad({
      sourceTexture,
      effect: "sobel-x",
      texSize,
      renderOrder: 20,
    });
    scene.add(this.sobelQuad.mesh);

    this.edge2 = new EdgeQuad({
      renderOrder: 21,
      edgeWidthPx: 3,
      color: FRAME_BLUE,
      alpha: 0.55,
    });
    scene.add(this.edge2.mesh);

    this.thumbDots = new TipDots(scene, { count: 2, color: FRAME_BLUE, sizePx: 18, renderOrder: 30 });
    this.indexDots = new TipDots(scene, { count: 2, color: FRAME_BLUE, sizePx: 18, renderOrder: 30 });
    this.middleDots = new TipDots(scene, { count: 2, color: FRAME_BLUE, sizePx: 18, renderOrder: 30 });

    const cutoff = minCutoffFromSlider(this.smoothingValue);
    this.smoother1 = makeHandSmoother(cutoff);
    this.smoother2 = makeHandSmoother(cutoff);

    this.setVisible(false);
  }

  setTexture(texture: THREE.Texture, texSize: { width: number; height: number }): void {
    this.pixQuad.setTexture(texture, texSize);
    this.sobelQuad.setTexture(texture, texSize);
  }

  setMirror(_mirror: boolean): void {
    // Effect quad sengaja TIDAK mirror (raw), terlepas dari state mirror BG.
    // Method dipertahankan untuk kompatibilitas API.
  }

  /** State frame: nyalakan/matikan thumb↔index dan index↔middle secara independen. */
  setFrames(state: { thumbIndex: boolean; indexMiddle: boolean }): void {
    this.showThumbIndex = state.thumbIndex;
    this.showIndexMiddle = state.indexMiddle;
  }

  /** Pilih efek untuk tiap frame (thumb↔index / index↔middle). */
  setEffects(state: { thumbIndex: EffectKind; indexMiddle: EffectKind }): void {
    this.effect1 = state.thumbIndex;
    this.effect2 = state.indexMiddle;
    this.pixQuad.setEffect(this.effect1);
    this.sobelQuad.setEffect(this.effect2);
  }

  /** Set teks untuk effect "text" (dipakai saat efek frame = "text"). */
  setText(text: string): void {
    this.pixQuad.setText(text);
    this.sobelQuad.setText(text);
  }

  /** Set kekuatan smoothing (0..100). 0 = raw, 100 = paling smooth. */
  setSmoothing(value: number): void {
    this.smoothingValue = Math.max(0, Math.min(100, value));
    const c = minCutoffFromSlider(this.smoothingValue);
    const set = (s: HandSmoother) => {
      s.thumb.setMinCutoff(c);
      s.index.setMinCutoff(c);
      s.middle.setMinCutoff(c);
      s.middleDip.setMinCutoff(c);
    };
    set(this.smoother1);
    set(this.smoother2);
  }

  private resetSmoothers(): void {
    const reset = (s: HandSmoother) => {
      s.thumb.reset();
      s.index.reset();
      s.middle.reset();
      s.middleDip.reset();
    };
    reset(this.smoother1);
    reset(this.smoother2);
  }

  setVisible(show: boolean): void {
    this.visible = show;
    if (!show) {
      this.hideAll();
    }
  }

  /**
   * Render 2 hand-frame windows. `aspect` = canvas width/height untuk
   * mapping normalized landmark → world coords (ortho bounds ±aspect × ±1).
   * `timeSeconds` untuk dt One Euro filter.
   */
  render(hand: MultiHandResult, aspect: number, timeSeconds: number): void {
    if (!this.visible) {
      this.hideAll();
      return;
    }
    if (hand.numDetected < 2) {
      this.resetSmoothers();
      this.hideAll();
      return;
    }

    // World-space position mapping (posisi quad di layar — TIDAK berubah)
    const v = (mx: number, my: number): THREE.Vector2 => {
      const wx = (0.5 - mx) * 2 * aspect;
      const wy = (0.5 - my) * 2;
      return new THREE.Vector2(wx, wy);
    };

    // Texture-sample UV mapping (area video yang di-crop — BARU).
    // Landmark: x 0..1 kiri→kanan, y 0..1 atas→bawah (image space).
    // PlaneGeometry UV: y=0 bawah, y=1 atas → makanya y di-flip.
    // Mirror TIDAK diterapkan di sini karena sudah dihandle uMirror di shader.
    const uvOf = (mx: number, my: number): THREE.Vector2 => {
      return new THREE.Vector2(mx, 1.0 - my);
    };

    let [h1, h2] = [hand.hands[0], hand.hands[1]];
    // Di raw camera, tangan kiri user ada di sisi KANAN gambar (x mentah lebih besar).
    // Sort supaya h1 = kiri (x besar), h2 = kanan (x kecil) → BL selalu di kiri layar
    // → teks tidak terbalik, apapun urutan tangan masuk kamera.
    if (h1.palmCenter.x < h2.palmCenter.x) {
      [h1, h2] = [h2, h1];
    }

    // Smoothing (One Euro) — hilangkan jitter, diterapkan setelah sort.
    const sh1 = smoothHand(h1, this.smoother1, timeSeconds);
    const sh2 = smoothHand(h2, this.smoother2, timeSeconds);

    // ──────── corner1 = thumb-index frame ────────
    if (this.showThumbIndex) {
      const c1BL = v(sh1.thumbTip.x, sh1.thumbTip.y);
      const c1BR = v(sh2.thumbTip.x, sh2.thumbTip.y);
      const c1TL = v(sh1.indexTip.x, sh1.indexTip.y);
      const c1TR = v(sh2.indexTip.x, sh2.indexTip.y);
      this.pixQuad.setCorners(c1BL, c1BR, c1TR, c1TL);
      this.pixQuad.setUvCorners(
        uvOf(sh1.thumbTip.x, sh1.thumbTip.y),
        uvOf(sh2.thumbTip.x, sh2.thumbTip.y),
        uvOf(sh2.indexTip.x, sh2.indexTip.y),
        uvOf(sh1.indexTip.x, sh1.indexTip.y),
      );
      this.edge1.setCorners(c1BL, c1BR, c1TR, c1TL);
      this.pixQuad.setVisible(true);
      this.edge1.setVisible(true);
    } else {
      this.pixQuad.setVisible(false);
      this.edge1.setVisible(false);
    }

    // ──────── corner2 = index-middle frame (TD TYPO preserved) ────────
    if (this.showIndexMiddle) {
      const c2BL = v(sh1.indexTip.x, sh1.indexTip.y);
      const c2BR = v(sh2.indexTip.x, sh2.indexTip.y);
      const c2TL = v(sh1.middleDip.x, sh1.middleTip.y); // ← typo (TD original), tetap dipertahankan
      const c2TR = v(sh2.middleTip.x, sh2.middleTip.y);
      this.sobelQuad.setCorners(c2BL, c2BR, c2TR, c2TL);
      this.sobelQuad.setUvCorners(
        uvOf(sh1.indexTip.x, sh1.indexTip.y),
        uvOf(sh2.indexTip.x, sh2.indexTip.y),
        uvOf(sh2.middleTip.x, sh2.middleTip.y),
        uvOf(sh1.middleDip.x, sh1.middleTip.y), // ← typo dipertahankan biar konsisten dg posisi
      );
      this.edge2.setCorners(c2BL, c2BR, c2TR, c2TL);
      this.sobelQuad.setVisible(true);
      this.edge2.setVisible(true);
    } else {
      this.sobelQuad.setVisible(false);
      this.edge2.setVisible(false);
    }

    // ──────── Marker ujung jari (per group, ikut state frame) ────────
    this.thumbDots.setPositions([
      v(sh1.thumbTip.x, sh1.thumbTip.y),
      v(sh2.thumbTip.x, sh2.thumbTip.y),
    ]);
    this.thumbDots.setVisible(this.showThumbIndex);

    this.indexDots.setPositions([
      v(sh1.indexTip.x, sh1.indexTip.y),
      v(sh2.indexTip.x, sh2.indexTip.y),
    ]);
    this.indexDots.setVisible(this.showThumbIndex || this.showIndexMiddle);

    this.middleDots.setPositions([
      v(sh1.middleTip.x, sh1.middleTip.y),
      v(sh2.middleTip.x, sh2.middleTip.y),
    ]);
    this.middleDots.setVisible(this.showIndexMiddle);
  }

  dispose(): void {
    this.pixQuad.dispose();
    this.edge1.dispose();
    this.sobelQuad.dispose();
    this.edge2.dispose();
    this.thumbDots.dispose();
    this.indexDots.dispose();
    this.middleDots.dispose();
  }

  private hideAll(): void {
    this.pixQuad.setVisible(false);
    this.edge1.setVisible(false);
    this.sobelQuad.setVisible(false);
    this.edge2.setVisible(false);
    this.thumbDots.setVisible(false);
    this.indexDots.setVisible(false);
    this.middleDots.setVisible(false);
  }
}
