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
import { EffectQuad, EdgeQuad, TipDots } from "./effects.js";
import type { MultiHandResult } from "./handTracker.js";

const FRAME_BLUE = 0x2776ea; // #2776EA

export class FingerFrameCompositor {
  readonly pixQuad: EffectQuad;   // corner1 → pixelate
  readonly sobelQuad: EffectQuad; // corner2 → Sobel-X
  readonly edge1: EdgeQuad;       // outline corner1 (biru transparan)
  readonly edge2: EdgeQuad;       // outline corner2 (biru transparan)
  readonly dots: TipDots;         // marker tiap ujung jari

  private visible = false;

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

    this.dots = new TipDots(scene, {
      count: 6,
      color: FRAME_BLUE,
      sizePx: 18,
      renderOrder: 30,
    });

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

  setVisible(show: boolean): void {
    this.visible = show;
    if (!show) {
      this.hideAll();
    }
  }

  /**
   * Render 2 hand-frame windows. `aspect` = canvas width/height untuk
   * mapping normalized landmark → world coords (ortho bounds ±aspect × ±1).
   */
  render(hand: MultiHandResult, aspect: number): void {
    if (!this.visible) {
      this.hideAll();
      return;
    }
    if (hand.numDetected < 2) {
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

    const h1 = hand.hands[0];
    const h2 = hand.hands[1];

    // ──────── corner1 = thumb-index frame ────────
    const c1BL = v(h1.thumbTip.x, h1.thumbTip.y);
    const c1BR = v(h2.thumbTip.x, h2.thumbTip.y);
    const c1TL = v(h1.indexTip.x, h1.indexTip.y);
    const c1TR = v(h2.indexTip.x, h2.indexTip.y);
    this.pixQuad.setCorners(c1BL, c1BR, c1TR, c1TL);
    this.pixQuad.setUvCorners(
      uvOf(h1.thumbTip.x, h1.thumbTip.y),
      uvOf(h2.thumbTip.x, h2.thumbTip.y),
      uvOf(h2.indexTip.x, h2.indexTip.y),
      uvOf(h1.indexTip.x, h1.indexTip.y),
    );
    this.edge1.setCorners(c1BL, c1BR, c1TR, c1TL);
    this.pixQuad.setVisible(true);
    this.edge1.setVisible(true);

    // ──────── corner2 = index-middle frame (TD TYPO preserved) ────────
    const c2BL = v(h1.indexTip.x, h1.indexTip.y);
    const c2BR = v(h2.indexTip.x, h2.indexTip.y);
    const c2TL = v(h1.middleDip.x, h1.middleTip.y); // ← typo (TD original), tetap dipertahankan
    const c2TR = v(h2.middleTip.x, h2.middleTip.y);
    this.sobelQuad.setCorners(c2BL, c2BR, c2TR, c2TL);
    this.sobelQuad.setUvCorners(
      uvOf(h1.indexTip.x, h1.indexTip.y),
      uvOf(h2.indexTip.x, h2.indexTip.y),
      uvOf(h2.middleTip.x, h2.middleTip.y),
      uvOf(h1.middleDip.x, h1.middleTip.y), // ← typo dipertahankan biar konsisten dg posisi
    );
    this.edge2.setCorners(c2BL, c2BR, c2TR, c2TL);
    this.sobelQuad.setVisible(true);
    this.edge2.setVisible(true);

    // ──────── Marker di tiap ujung jari (thumb/index/middle × 2 tangan) ────────
    this.dots.setPositions([
      v(h1.thumbTip.x, h1.thumbTip.y),
      v(h1.indexTip.x, h1.indexTip.y),
      v(h1.middleTip.x, h1.middleTip.y),
      v(h2.thumbTip.x, h2.thumbTip.y),
      v(h2.indexTip.x, h2.indexTip.y),
      v(h2.middleTip.x, h2.middleTip.y),
    ]);
    this.dots.setVisible(true);
  }

  dispose(): void {
    this.pixQuad.dispose();
    this.edge1.dispose();
    this.sobelQuad.dispose();
    this.edge2.dispose();
    this.dots.dispose();
  }

  private hideAll(): void {
    this.pixQuad.setVisible(false);
    this.edge1.setVisible(false);
    this.sobelQuad.setVisible(false);
    this.edge2.setVisible(false);
    this.dots.setVisible(false);
  }
}
