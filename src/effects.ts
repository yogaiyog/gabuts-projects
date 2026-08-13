/**
 * effects.ts (PATCHED)
 * ===========
 * Fix: vertex shader sekarang punya DUA bilinear mapping terpisah:
 *   1. uCorner* (world space) → posisi quad di layar, ikut jari.
 *   2. uUv*     (0..1 texture space, dari landmark mentah) → UV yang
 *      dipakai fragment untuk sample texture.
 *
 * Sebelumnya `vUv = uv` (UV plane utuh 0..1) dikirim ke fragment,
 * sehingga fragment selalu sample SELURUH frame webcam lalu di-squeeze
 * ke bentuk quad kecil — bukan meng-crop area yang ada di belakang
 * frame jari. Itu penyebab "instance webcam baru" yang terlihat di
 * dalam rectangle.
 */

import * as THREE from "three";

// ──────────────────────────────────────────────────────────────────────
// Vertex shader (shared) — PATCHED: vSampleUv terpisah dari posisi
// ──────────────────────────────────────────────────────────────────────
const CORNER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vSampleUv;

  // World-space corners (posisi quad di layar, ikut jari)
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerTL;

  // Texture-space UV corners (area video yang di-crop, dari landmark mentah)
  uniform vec2 uUvBL;
  uniform vec2 uUvBR;
  uniform vec2 uUvTR;
  uniform vec2 uUvTL;

  void main() {
    // Bilinear forward mapping dari unit-square UV ke 4-corner quad (posisi).
    vec2 dst =
        (1.0 - uv.x) * (1.0 - uv.y) * uCornerBL
      +        uv.x  * (1.0 - uv.y) * uCornerBR
      + (1.0 - uv.x) *        uv.y  * uCornerTL
      +        uv.x  *        uv.y  * uCornerTR;

    // Bilinear forward mapping dari unit-square UV ke 4-corner UV (sample).
    vSampleUv =
        (1.0 - uv.x) * (1.0 - uv.y) * uUvBL
      +        uv.x  * (1.0 - uv.y) * uUvBR
      + (1.0 - uv.x) *        uv.y  * uUvTL
      +        uv.x  *        uv.y  * uUvTR;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(dst, 0.0, 1.0);
  }
`;

// ──────────────────────────────────────────────────────────────────────
// Fragment shaders — PATCHED: pakai vSampleUv, bukan vUv
// ──────────────────────────────────────────────────────────────────────

const PIXELATE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uBlockH;
  uniform float uBlockV;
  uniform float uMirror;

  void main() {
    vec2 mirrorUv = vec2(mix(vSampleUv.x, 1.0 - vSampleUv.x, uMirror), vSampleUv.y);
    vec2 px = mirrorUv * uTexSize;
    vec2 block = floor(px / vec2(uBlockH, uBlockV)) * vec2(uBlockH, uBlockV);
    vec2 blockCenterUV = (block + vec2(uBlockH, uBlockV) * 0.5) / uTexSize;
    vec3 c = texture2D(uTex, blockCenterUV).rgb;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SOBELX_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uMirror;

  float sampleGray(vec2 uv) {
    vec2 m = vec2(mix(uv.x, 1.0 - uv.x, uMirror), uv.y);
    return texture2D(uTex, m).r;
  }

  void main() {
    vec2 px = 1.0 / uTexSize;
    float tl = sampleGray(vSampleUv + vec2(-px.x,  px.y));
    float t_ = sampleGray(vSampleUv + vec2(   0.0, px.y));
    float tr = sampleGray(vSampleUv + vec2( px.x,  px.y));
    float ml = sampleGray(vSampleUv + vec2(-px.x,   0.0));
    float mr = sampleGray(vSampleUv + vec2( px.x,   0.0));
    float bl = sampleGray(vSampleUv + vec2(-px.x, -px.y));
    float b_ = sampleGray(vSampleUv + vec2(   0.0,-px.y));
    float br = sampleGray(vSampleUv + vec2( px.x, -px.y));

    float gx = 1.0 * tl + 0.0 * t_ + (-1.0) * tr
             + 2.0 * ml             + (-2.0) * mr
             + 1.0 * bl + 0.0 * b_ + (-1.0) * br;

    float bias = 0.5;
    float g = clamp(gx + bias, 0.0, 1.0);
    gl_FragColor = vec4(g, g, g, 1.0);
  }
`;

// Edge outline tetap pakai UV unit-square lokal (posisi border quad itu
// sendiri), jadi TIDAK perlu diubah — biarkan pakai vUv dari uv plane.
const EDGE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerTL;

  void main() {
    vec2 dst =
        (1.0 - uv.x) * (1.0 - uv.y) * uCornerBL
      +        uv.x  * (1.0 - uv.y) * uCornerBR
      + (1.0 - uv.x) *        uv.y  * uCornerTL
      +        uv.x  *        uv.y  * uCornerTR;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dst, 0.0, 1.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uEdgeWidthPx;
  uniform vec3 uEdgeColor;
  uniform float uEdgeAlpha;

  void main() {
    // Jarak ke pinggir quad dikonversi ke pixel via fwidth (screen-space
    // derivative) supaya ketebalan outline TETAP (fixed px) berapa pun
    // ukuran quad / jarak tangan.
    vec2 duv = min(vUv, 1.0 - vUv);
    vec2 dpx = duv / max(fwidth(vUv), vec2(1e-4));
    float d = min(dpx.x, dpx.y);
    if (d < uEdgeWidthPx) {
      gl_FragColor = vec4(uEdgeColor, uEdgeAlpha);
    } else {
      discard;
    }
  }
`;

// ──────────────────────────────────────────────────────────────────────
// EffectQuad
// ──────────────────────────────────────────────────────────────────────

export type EffectKind = "pixelate" | "sobel-x";

export interface EffectQuadOptions {
  sourceTexture: THREE.Texture;
  effect: EffectKind;
  texSize: { width: number; height: number };
  renderOrder?: number;
  blockH?: number;
  blockV?: number;
}

export class EffectQuad {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  private uCornerBL: { value: THREE.Vector2 };
  private uCornerBR: { value: THREE.Vector2 };
  private uCornerTR: { value: THREE.Vector2 };
  private uCornerTL: { value: THREE.Vector2 };
  private uUvBL: { value: THREE.Vector2 };
  private uUvBR: { value: THREE.Vector2 };
  private uUvTR: { value: THREE.Vector2 };
  private uUvTL: { value: THREE.Vector2 };
  private uTexSize: { value: THREE.Vector2 };
  private uBlockH: { value: number };
  private uBlockV: { value: number };
  private uTex: { value: THREE.Texture };
  private uMirror: { value: number };
  private visible = true;

  constructor(opts: EffectQuadOptions) {
    this.uCornerBL = { value: new THREE.Vector2(-1, -1) };
    this.uCornerBR = { value: new THREE.Vector2(1, -1) };
    this.uCornerTR = { value: new THREE.Vector2(1, 1) };
    this.uCornerTL = { value: new THREE.Vector2(-1, 1) };
    // Default UV corners = seluruh texture (fallback aman sebelum setUvCorners dipanggil)
    this.uUvBL = { value: new THREE.Vector2(0, 1) };
    this.uUvBR = { value: new THREE.Vector2(1, 1) };
    this.uUvTR = { value: new THREE.Vector2(1, 0) };
    this.uUvTL = { value: new THREE.Vector2(0, 0) };
    this.uTexSize = { value: new THREE.Vector2(opts.texSize.width, opts.texSize.height) };
    this.uBlockH = { value: opts.blockH ?? 28 };
    this.uBlockV = { value: opts.blockV ?? 27 };
    this.uTex = { value: opts.sourceTexture };
    this.uMirror = { value: 0.0 };

    const frag = opts.effect === "pixelate" ? PIXELATE_FRAG : SOBELX_FRAG;

    this.material = new THREE.ShaderMaterial({
      vertexShader: CORNER_VERTEX_SHADER,
      fragmentShader: frag,
      uniforms: {
        uCornerBL: this.uCornerBL,
        uCornerBR: this.uCornerBR,
        uCornerTR: this.uCornerTR,
        uCornerTL: this.uCornerTL,
        uUvBL: this.uUvBL,
        uUvBR: this.uUvBR,
        uUvTR: this.uUvTR,
        uUvTL: this.uUvTL,
        uTexSize: this.uTexSize,
        uBlockH: this.uBlockH,
        uBlockV: this.uBlockV,
        uTex: this.uTex,
        uMirror: this.uMirror,
      },
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const geom = new THREE.PlaneGeometry(2, 2, 32, 32);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.frustumCulled = false;
  }

  /** Posisi quad di layar (world coords), ikut jari. */
  setCorners(bl: THREE.Vector2, br: THREE.Vector2, tr: THREE.Vector2, tl: THREE.Vector2): void {
    this.uCornerBL.value.copy(bl);
    this.uCornerBR.value.copy(br);
    this.uCornerTR.value.copy(tr);
    this.uCornerTL.value.copy(tl);
  }

  /**
   * Area video yang di-crop (texture-space UV, 0..1), dari landmark
   * mentah — INI yang menentukan konten apa yang muncul di dalam quad,
   * bukan `setCorners`.
   */
  setUvCorners(bl: THREE.Vector2, br: THREE.Vector2, tr: THREE.Vector2, tl: THREE.Vector2): void {
    this.uUvBL.value.copy(bl);
    this.uUvBR.value.copy(br);
    this.uUvTR.value.copy(tr);
    this.uUvTL.value.copy(tl);
  }

  setMirror(mirror: boolean): void {
    this.uMirror.value = mirror ? 1.0 : 0.0;
  }

  setTexture(texture: THREE.Texture, texSize: { width: number; height: number }): void {
    this.uTex.value = texture;
    this.uTexSize.value.set(texSize.width, texSize.height);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.mesh.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ──────────────────────────────────────────────────────────────────────
// EdgeQuad (tidak berubah secara fungsional — tetap pakai plain uv)
// ──────────────────────────────────────────────────────────────────────

export interface EdgeQuadOptions {
  renderOrder?: number;
  edgeWidthPx?: number; // ketebalan outline (fixed pixel, tipis)
  color?: number;       // hex RGB (e.g. 0x2776EA)
  alpha?: number;       // 0..1 (transparan)
}

export class EdgeQuad {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  private uCornerBL: { value: THREE.Vector2 };
  private uCornerBR: { value: THREE.Vector2 };
  private uCornerTR: { value: THREE.Vector2 };
  private uCornerTL: { value: THREE.Vector2 };
  private uEdgeWidthPx: { value: number };
  private uEdgeColor: { value: THREE.Color };
  private uEdgeAlpha: { value: number };
  private visible = true;

  constructor(opts: EdgeQuadOptions = {}) {
    this.uCornerBL = { value: new THREE.Vector2(-1, -1) };
    this.uCornerBR = { value: new THREE.Vector2(1, -1) };
    this.uCornerTR = { value: new THREE.Vector2(1, 1) };
    this.uCornerTL = { value: new THREE.Vector2(-1, 1) };
    this.uEdgeWidthPx = { value: opts.edgeWidthPx ?? 2.0 };
    this.uEdgeColor = { value: new THREE.Color(opts.color ?? 0xffffff) };
    this.uEdgeAlpha = { value: opts.alpha ?? 1.0 };

    this.material = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERTEX_SHADER,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        uCornerBL: this.uCornerBL,
        uCornerBR: this.uCornerBR,
        uCornerTR: this.uCornerTR,
        uCornerTL: this.uCornerTL,
        uEdgeWidthPx: this.uEdgeWidthPx,
        uEdgeColor: this.uEdgeColor,
        uEdgeAlpha: this.uEdgeAlpha,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const geom = new THREE.PlaneGeometry(2, 2, 32, 32);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = opts.renderOrder ?? 11;
    this.mesh.frustumCulled = false;
  }

  setCorners(bl: THREE.Vector2, br: THREE.Vector2, tr: THREE.Vector2, tl: THREE.Vector2): void {
    this.uCornerBL.value.copy(bl);
    this.uCornerBR.value.copy(br);
    this.uCornerTR.value.copy(tr);
    this.uCornerTL.value.copy(tl);
  }

  setColor(color: number, alpha: number): void {
    this.uEdgeColor.value.setHex(color);
    this.uEdgeAlpha.value = Math.max(0, Math.min(1, alpha));
  }

  setEdgeWidthPx(px: number): void {
    this.uEdgeWidthPx.value = Math.max(0.5, px);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.mesh.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TipDots
// ──────────────────────────────────────────────────────────────────────

export interface TipDotsOptions {
  count?: number;
  color?: number;     // hex RGB (e.g. 0x2776EA)
  sizePx?: number;    // diameter titik di layar (fixed, sizeAttenuation false)
  renderOrder?: number;
}

/**
 * Titik-titik bulat (marker) yang menandai ujung jari. Pakai THREE.Points
 * + sprite lingkaran (Canvas2D radial gradient) dengan ukuran tetap di layar.
 */
export class TipDots {
  readonly points: THREE.Points;
  private material: THREE.PointsMaterial;
  private geometry: THREE.BufferGeometry;
  private count: number;
  private visible = true;

  constructor(scene: THREE.Scene, opts: TipDotsOptions = {}) {
    this.count = opts.count ?? 6;
    const sizePx = opts.sizePx ?? 18;
    const color = opts.color ?? 0x2776ea;

    const sprite = makeCircleSprite(64);

    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      size: sizePx,
      sizeAttenuation: false,
      map: sprite,
      color,
      transparent: true,
      alphaTest: 0.01,
      depthTest: false,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.renderOrder = opts.renderOrder ?? 30;
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Update posisi tiap titik (world coords). z default 0. */
  setPositions(worldPts: THREE.Vector2[]): void {
    const attr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      const p = worldPts[i];
      attr.setXYZ(i, p ? p.x : 0, p ? p.y : 0, 0);
    }
    attr.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.points.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    if (this.material.map) this.material.map.dispose();
  }
}

/**
 * Buat sprite lingkaran (putih dg alpha radial falloff) via Canvas2D.
 * Warna final di-tint oleh PointsMaterial.color.
 */
function makeCircleSprite(size: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d")!;
  const r = size / 2;

  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.6, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
