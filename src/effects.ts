/**
 * effects.ts
 * ===========
 * Three.js meshes dengan corner-pin vertex shader + custom fragment shader
 * untuk efek "Finger Frame" mode (mirror comp5 root-project1).
 *
 * Dua komponen:
 *   - `EffectQuad`: corner-pin quad dengan frag pixelate atau Sobel-X
 *                   diaplikasikan ke webcam texture.
 *   - `EdgeQuad`: corner-pin quad yang hanya render outline putih
 *                 (UV proximity test → discard otherwise).
 *
 * Vertex shader identik dengan `warpQuad.ts` (bilinear forward mapping).
 */

import * as THREE from "three";

// ──────────────────────────────────────────────────────────────────────
// Vertex shader (shared)
// ──────────────────────────────────────────────────────────────────────
const CORNER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerTL;

  void main() {
    // Bilinear forward mapping dari unit-square UV ke 4-corner quad.
    vec2 dst =
        (1.0 - uv.x) * (1.0 - uv.y) * uCornerBL
      +        uv.x  * (1.0 - uv.y) * uCornerBR
      + (1.0 - uv.x) *        uv.y  * uCornerTL
      +        uv.x  *        uv.y  * uCornerTR;

    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dst, 0.0, 1.0);
  }
`;

// ──────────────────────────────────────────────────────────────────────
// Fragment shaders
// ──────────────────────────────────────────────────────────────────────

/**
 * Pixelate (mirip TD `pixelate.tox`, Horsize=28, Vertsize=27).
 * Block size dalam pixel; assumes uTexSize = webcam dimensi.
 * uMirror: 1.0 untuk selfie mode (flip X), 0.0 untuk raw.
 */
const PIXELATE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uBlockH;
  uniform float uBlockV;
  uniform float uMirror;

  void main() {
    vec2 mirrorUv = vec2(mix(vUv.x, 1.0 - vUv.x, uMirror), vUv.y);
    vec2 px = mirrorUv * uTexSize;
    vec2 block = floor(px / vec2(uBlockH, uBlockV)) * vec2(uBlockH, uBlockV);
    vec2 blockCenterUV = (block + vec2(uBlockH, uBlockV) * 0.5) / uTexSize;
    vec3 c = texture2D(uTex, blockCenterUV).rgb;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * Sobel-X grayscale (mirip TD `convolve1` kernel
 * [ 1 0 -1 / 2 0 -2 / 1 0 -1 ], divisor 1, offset 0).
 * uMirror: flip X seperti di atas.
 */
const SOBELX_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uMirror;

  float sampleGray(vec2 uv) {
    vec2 m = vec2(mix(uv.x, 1.0 - uv.x, uMirror), uv.y);
    return texture2D(uTex, m).r;
  }

  void main() {
    vec2 px = 1.0 / uTexSize;
    float tl = sampleGray(vUv + vec2(-px.x,  px.y));
    float t_ = sampleGray(vUv + vec2(   0.0, px.y));
    float tr = sampleGray(vUv + vec2( px.x,  px.y));
    float ml = sampleGray(vUv + vec2(-px.x,   0.0));
    float mr = sampleGray(vUv + vec2( px.x,   0.0));
    float bl = sampleGray(vUv + vec2(-px.x, -px.y));
    float b_ = sampleGray(vUv + vec2(   0.0,-px.y));
    float br = sampleGray(vUv + vec2( px.x, -px.y));

    float gx = 1.0 * tl + 0.0 * t_ + (-1.0) * tr
             + 2.0 * ml             + (-2.0) * mr
             + 1.0 * bl + 0.0 * b_ + (-1.0) * br;

    float bias = 0.5;
    float g = clamp(gx + bias, 0.0, 1.0);
    gl_FragColor = vec4(g, g, g, 1.0);
  }
`;

/**
 * Edge outline: render putih hanya untuk frag yang dekat UV border.
 * Min(uv.x, 1-uv.x, uv.y, 1-uv.y) < uEdgeFrac → white, else → discard.
 */
const EDGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uEdgeFrac;

  void main() {
    float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    if (d < uEdgeFrac) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
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
    this.uTexSize = { value: new THREE.Vector2(opts.texSize.width, opts.texSize.height) };
    this.uBlockH = { value: opts.blockH ?? 28 };
    this.uBlockV = { value: opts.blockV ?? 27 };
    this.uTex = { value: opts.sourceTexture };
    this.uMirror = { value: 1.0 };

    const frag = opts.effect === "pixelate" ? PIXELATE_FRAG : SOBELX_FRAG;

    this.material = new THREE.ShaderMaterial({
      vertexShader: CORNER_VERTEX_SHADER,
      fragmentShader: frag,
      uniforms: {
        uCornerBL: this.uCornerBL,
        uCornerBR: this.uCornerBR,
        uCornerTR: this.uCornerTR,
        uCornerTL: this.uCornerTL,
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

  setCorners(bl: THREE.Vector2, br: THREE.Vector2, tr: THREE.Vector2, tl: THREE.Vector2): void {
    this.uCornerBL.value.copy(bl);
    this.uCornerBR.value.copy(br);
    this.uCornerTR.value.copy(tr);
    this.uCornerTL.value.copy(tl);
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
// EdgeQuad
// ──────────────────────────────────────────────────────────────────────

export interface EdgeQuadOptions {
  renderOrder?: number;
  edgeFrac?: number; // 0..0.5
}

export class EdgeQuad {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  private uCornerBL: { value: THREE.Vector2 };
  private uCornerBR: { value: THREE.Vector2 };
  private uCornerTR: { value: THREE.Vector2 };
  private uCornerTL: { value: THREE.Vector2 };
  private uEdgeFrac: { value: number };
  private visible = true;

  constructor(opts: EdgeQuadOptions = {}) {
    this.uCornerBL = { value: new THREE.Vector2(-1, -1) };
    this.uCornerBR = { value: new THREE.Vector2(1, -1) };
    this.uCornerTR = { value: new THREE.Vector2(1, 1) };
    this.uCornerTL = { value: new THREE.Vector2(-1, 1) };
    this.uEdgeFrac = { value: opts.edgeFrac ?? 0.035 };

    this.material = new THREE.ShaderMaterial({
      vertexShader: CORNER_VERTEX_SHADER,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        uCornerBL: this.uCornerBL,
        uCornerBR: this.uCornerBR,
        uCornerTR: this.uCornerTR,
        uCornerTL: this.uCornerTL,
        uEdgeFrac: this.uEdgeFrac,
      },
      transparent: false,
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

  setEdgeWidth(frac: number): void {
    this.uEdgeFrac.value = Math.max(0, Math.min(0.5, frac));
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
