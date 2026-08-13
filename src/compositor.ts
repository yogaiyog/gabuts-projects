/**
 * compositor.ts
 * =============
 * Three.js scene + renderer dengan 4 mode:
 *   - "2d"     : webcam + rainbow AR pattern warp (legacy)
 *   - "3d"     : webcam + 3D torus anchor ke palm (legacy)
 *   - "hybrid" : 2D + 3D (legacy)
 *   - "frame"  : webcam + 2 hand-frame window (pixelate + Sobel-X + edge)
 *                mirror comp5 root-project1 flow
 *
 * Render pipeline (mode="frame"):
 *   BG (0) → pixQuad1 (10) → edge1 (11) → sobelQuad2 (20) → edge2 (21)
 */

import * as THREE from "three";
import { WarpQuad } from "./warpQuad.js";
import { Anchored3D } from "./anchored3D.js";
import { EffectQuad, EdgeQuad } from "./effects.js";
import type { MultiHandResult, Pt2 } from "./handTracker.js";

export type RenderMode = "2d" | "3d" | "hybrid" | "frame";

export interface CompositorInit {
  canvas: HTMLCanvasElement;
  patternTexture: THREE.Texture;
}

const BG_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BG_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uOpacity;
  uniform float uMirror;

  void main() {
    vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uMirror), vUv.y);
    vec4 c = texture2D(uTex, uv);
    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }
`;

// Rainbow AR quad corners (legacy 2D Filter mode).
// TD comp5 flow lain; ini hanya untuk mode "2d"/"hybrid" yang replicate
// `ar_hand_filter_demo_builder.py` original (4 ujung jari satu tangan).
const RAINBOW_CORNER_INDEX = {
  BL: 20, // pinky_tip
  BR: 16, // ring_finger_tip
  TR: 12, // middle_finger_tip
  TL: 8, // index_finger_tip
};

export class Compositor {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;

  private videoTexture: THREE.Texture;
  private bgMesh: THREE.Mesh;
  private bgMaterial: THREE.ShaderMaterial;

  readonly warpQuad: WarpQuad;
  readonly anchored3D: Anchored3D;

  // ──────── Finger-Frame mode components ────────
  readonly pixQuad: EffectQuad;   // corner1 → pixelate
  readonly edge1: EdgeQuad;       // outline corner1
  readonly sobelQuad: EffectQuad; // corner2 → Sobel-X
  readonly edge2: EdgeQuad;       // outline corner2

  // state
  private aspect = 1;
  private mode: RenderMode = "hybrid";
  private flipBG = true;
  private texSize = { width: 1280, height: 720 };

  // lifecycle
  private rafId: number | null = null;
  private onFrameHook: ((t: number) => void) | null = null;

  constructor(init: CompositorInit) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: init.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

    // Video texture placeholder (overwritten by setVideo)
    const placeholder = document.createElement("canvas");
    placeholder.width = 1;
    placeholder.height = 1;
    this.videoTexture = new THREE.CanvasTexture(placeholder);
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    // ──────── BG (webcam) ────────
    const bgGeom = new THREE.PlaneGeometry(2, 2);
    this.bgMaterial = new THREE.ShaderMaterial({
      vertexShader: BG_VERTEX_SHADER,
      fragmentShader: BG_FRAGMENT_SHADER,
      uniforms: {
        uTex: { value: this.videoTexture },
        uOpacity: { value: 1.0 },
        uMirror: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.bgMesh = new THREE.Mesh(bgGeom, this.bgMaterial);
    this.bgMesh.position.z = 1.0;
    this.bgMesh.renderOrder = 0;
    this.bgMesh.frustumCulled = false;
    this.scene.add(this.bgMesh);

    // ──────── Legacy 2D/3D/Hybrid ────────
    this.warpQuad = new WarpQuad({
      patternTexture: init.patternTexture,
      width: 2,
      height: 2,
      gridX: 48,
      gridY: 48,
      zLayer: 0,
    });
    this.scene.add(this.warpQuad.mesh);

    this.anchored3D = new Anchored3D({});
    this.scene.add(this.anchored3D.group);

    // ──────── Finger Frame mode (comp5) ────────
    this.pixQuad = new EffectQuad({
      sourceTexture: this.videoTexture,
      effect: "pixelate",
      texSize: this.texSize,
      blockH: 28,
      blockV: 27,
      renderOrder: 10,
    });
    this.scene.add(this.pixQuad.mesh);

    this.edge1 = new EdgeQuad({
      renderOrder: 11,
      edgeFrac: 0.035,
    });
    this.scene.add(this.edge1.mesh);

    this.sobelQuad = new EffectQuad({
      sourceTexture: this.videoTexture,
      effect: "sobel-x",
      texSize: this.texSize,
      renderOrder: 20,
    });
    this.scene.add(this.sobelQuad.mesh);

    this.edge2 = new EdgeQuad({
      renderOrder: 21,
      edgeFrac: 0.035,
    });
    this.scene.add(this.edge2.mesh);

    // default: legacy hybrid mode
    this.setMode("hybrid");
  }

  setVideo(video: HTMLVideoElement): void {
    if (this.videoTexture && "dispose" in this.videoTexture) {
      this.videoTexture.dispose();
    }
    const vt = new THREE.VideoTexture(video);
    vt.minFilter = THREE.LinearFilter;
    vt.magFilter = THREE.LinearFilter;
    vt.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture = vt;
    this.texSize = {
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720,
    };
    (this.bgMaterial.uniforms.uTex as { value: THREE.Texture }).value = vt;
    this.pixQuad.setMirror(this.flipBG);
    this.sobelQuad.setMirror(this.flipBG);
    this.pixQuad.setTexture(vt, this.texSize);
    this.sobelQuad.setTexture(vt, this.texSize);
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;

    // Visibility logic
    const isFrame = mode === "frame";
    const showWarp = mode === "2d" || mode === "hybrid";
    const show3D = mode === "3d" || mode === "hybrid";

    this.warpQuad.setVisible(showWarp);
    this.anchored3D.group.visible = show3D;
    this.pixQuad.setVisible(isFrame);
    this.edge1.setVisible(isFrame);
    this.sobelQuad.setVisible(isFrame);
    this.edge2.setVisible(isFrame);
  }

  setMirrorSelfie(enabled: boolean): void {
    this.flipBG = enabled;
    (this.bgMaterial.uniforms.uMirror as { value: number }).value = enabled ? 1.0 : 0.0;
    this.pixQuad.setMirror(enabled);
    this.sobelQuad.setMirror(enabled);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.camera.left = -this.aspect;
    this.camera.right = this.aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    // Stretch unit BG plane (2×2) ke camera bounds (2*aspect × 2)
    this.bgMesh.scale.set(this.aspect, 1, 1);
  }

  /**
   * Render satu frame. Multi-hand mendukung legacy mode (pakai hand[0])
   * DAN frame mode (pakai hand[0] + hand[1]).
   */
  render(hand: MultiHandResult, timeSeconds: number): void {
    // Coord mapping (tanpa aspect correction) — dipakai untuk mode legacy
    const v = (mx: number, my: number): THREE.Vector2 => {
      const wx = (0.5 - mx) * 2 * this.aspect;
      const wy = (0.5 - my) * 2;
      return new THREE.Vector2(wx, wy);
    };

    if (this.mode === "frame") {
      this.renderFrameMode(hand, v);
    } else {
      this.renderLegacyMode(hand, v, timeSeconds);
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ─── Legacy 2D / 3D / Hybrid (rainbow AR + 3D torus pakai hand[0]) ───
  private renderLegacyMode(
    hand: MultiHandResult,
    v: (mx: number, my: number) => THREE.Vector2,
    timeSeconds: number,
  ): void {
    const h0 = hand.hands.find((h) => h.detected);
    if (!h0) {
      this.warpQuad.setVisible(false);
      this.anchored3D.group.visible = false;
      return;
    }

    // Rainbow AR corners: BL=pinky_tip(20), BR=ring_tip(16), TR=middle_tip(12), TL=index_tip(8)
    const lm = h0.landmarks;
    const cBL = v(lm[RAINBOW_CORNER_INDEX.BL].x, lm[RAINBOW_CORNER_INDEX.BL].y);
    const cBR = v(lm[RAINBOW_CORNER_INDEX.BR].x, lm[RAINBOW_CORNER_INDEX.BR].y);
    const cTR = v(lm[RAINBOW_CORNER_INDEX.TR].x, lm[RAINBOW_CORNER_INDEX.TR].y);
    const cTL = v(lm[RAINBOW_CORNER_INDEX.TL].x, lm[RAINBOW_CORNER_INDEX.TL].y);
    this.warpQuad.setCorners(cBL, cBR, cTR, cTL);
    this.warpQuad.setOpacity(0.92);

    // 3D anchor
    this.anchored3D.update({
      palmX: h0.palmCenter.x,
      palmY: h0.palmCenter.y,
      handSize: h0.handSize,
      aspect: this.aspect,
      timeSeconds,
    });

    const showWarp = this.mode === "2d" || this.mode === "hybrid";
    const show3D = this.mode === "3d" || this.mode === "hybrid";
    this.warpQuad.setVisible(showWarp);
    this.anchored3D.group.visible = show3D;
  }

  // ─── Finger Frame mode (comp5: 2 hand-frame window) ───
  private renderFrameMode(
    hand: MultiHandResult,
    v: (mx: number, my: number) => THREE.Vector2,
  ): void {
    if (hand.numDetected < 2) {
      // Butuh 2 tangan → sembunyikan frame meshes
      this.pixQuad.setVisible(false);
      this.edge1.setVisible(false);
      this.sobelQuad.setVisible(false);
      this.edge2.setVisible(false);
      return;
    }

    const h1 = hand.hands[0];
    const h2 = hand.hands[1];

    // ──────── corner1 = thumb-index frame ────────
    // BL = h1.thumbTip, BR = h2.thumbTip, TL = h1.indexTip, TR = h2.indexTip
    const c1BL = v(h1.thumbTip.x, h1.thumbTip.y);
    const c1BR = v(h2.thumbTip.x, h2.thumbTip.y);
    const c1TL = v(h1.indexTip.x, h1.indexTip.y);
    const c1TR = v(h2.indexTip.x, h2.indexTip.y);
    this.pixQuad.setCorners(c1BL, c1BR, c1TR, c1TL);
    this.edge1.setCorners(c1BL, c1BR, c1TR, c1TL);
    this.pixQuad.setVisible(true);
    this.edge1.setVisible(true);

    // ──────── corner2 = index-middle frame (TD TYPO preserved) ────────
    // BL = h1.indexTip, BR = h2.indexTip,
    // TL: x = h1.middleDip.x  ← TD typo (seharusnya middleTip.x)
    //     y = h1.middleTip.y
    // TR = h2.middleTip
    const c2BL = v(h1.indexTip.x, h1.indexTip.y);
    const c2BR = v(h2.indexTip.x, h2.indexTip.y);
    const c2TL = v(h1.middleDip.x, h1.middleTip.y); // ← typo (TD original)
    const c2TR = v(h2.middleTip.x, h2.middleTip.y);
    this.sobelQuad.setCorners(c2BL, c2BR, c2TR, c2TL);
    this.edge2.setCorners(c2BL, c2BR, c2TR, c2TL);
    this.sobelQuad.setVisible(true);
    this.edge2.setVisible(true);
  }

  // ──────────────────── lifecycle ────────────────────
  start(onFrame?: (t: number) => void): void {
    if (this.rafId !== null) return;
    this.onFrameHook = onFrame ?? null;
    const startMs = performance.now();
    const tick = () => {
      const t = (performance.now() - startMs) / 1000;
      this.onFrameHook?.(t);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.stop();
    if ("dispose" in this.videoTexture) {
      this.videoTexture.dispose();
    }
    this.bgMaterial.dispose();
    this.bgMesh.geometry.dispose();
    this.warpQuad.dispose();
    this.anchored3D.dispose();
    this.pixQuad.dispose();
    this.edge1.dispose();
    this.sobelQuad.dispose();
    this.edge2.dispose();
    this.renderer.dispose();
  }

  getAspect(): number {
    return this.aspect;
  }
}

// Type export untuk konsumer lain (debug/misc)
export type { Pt2 };
