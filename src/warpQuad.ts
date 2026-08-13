/**
 * warpQuad.ts
 * ===========
 * Three.js mesh yang me-warp sebuah tekstur (mis. rainbow AR pattern) ke dalam
 * 4-corner quadrilateral dengan perspective-homography.
 *
 * Mirip TouchDesigner cornerpinTOP dengan:
 *   mapping = "perspective"
 *   outputresolution = "custom" (W × H)
 *   pinunit = "fraction" (semua 4 pin)
 *
 * Forward bilinear mapping (yang dipakai di shader) memetakan unit-square UV
 * (0..1) ke quad tujuan lewat 4 corner uniforms (BL/BR/TR/TL dalam world units).
 * Untuk hand-shape quadrilateral yang tidak terlalu skewed, hasilnya visually
 * identik dengan true perspective homography dengan biaya komputasi jauh
 * lebih rendah dan tidak perlu matrix-solver di JS.
 *
 * Jika nanti butuh perspective yang lebih kuat (mis. quad sangat skewed),
 * ganti implementasi vertex shader dengan homography 8-coefficient matrix
 * yang dihitung via solve8x8 di JS.
 */

import * as THREE from "three";

export interface WarpQuadOptions {
  width?: number; // plane world width
  height?: number; // plane world height
  gridX?: number;
  gridY?: number;
  zLayer?: number; // z position in world (untuk layering dengan BG & 3D)
  patternTexture: THREE.Texture;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerTL;

  void main() {
    // Bilinear forward mapping dari unit-square UV ke 4-corner quad.
    //   uv=(0,0) → BL    uv=(1,0) → BR    uv=(0,1) → TL    uv=(1,1) → TR
    vec2 dst =
        (1.0 - uv.x) * (1.0 - uv.y) * uCornerBL
      +        uv.x  * (1.0 - uv.y) * uCornerBR
      + (1.0 - uv.x) *        uv.y  * uCornerTL
      +        uv.x  *        uv.y  * uCornerTR;

    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dst, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uOpacity;

  void main() {
    vec4 c = texture2D(uTex, vUv);
    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }
`;

export class WarpQuad {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  // Uniform handles
  private uCornerBL: { value: THREE.Vector2 };
  private uCornerBR: { value: THREE.Vector2 };
  private uCornerTR: { value: THREE.Vector2 };
  private uCornerTL: { value: THREE.Vector2 };
  private uOpacity: { value: number };
  private uTex: { value: THREE.Texture };

  private layerZ: number;
  private visible = true;

  constructor(opts: WarpQuadOptions) {
    const W = opts.width ?? 1;
    const H = opts.height ?? 1;
    const gridX = opts.gridX ?? 64;
    const gridY = opts.gridY ?? 64;
    this.layerZ = opts.zLayer ?? 0;

    this.uCornerBL = { value: new THREE.Vector2(-W / 2, -H / 2) };
    this.uCornerBR = { value: new THREE.Vector2(W / 2, -H / 2) };
    this.uCornerTR = { value: new THREE.Vector2(W / 2, H / 2) };
    this.uCornerTL = { value: new THREE.Vector2(-W / 2, H / 2) };
    this.uOpacity = { value: 1.0 };
    this.uTex = { value: opts.patternTexture };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uCornerBL: this.uCornerBL,
        uCornerBR: this.uCornerBR,
        uCornerTR: this.uCornerTR,
        uCornerTL: this.uCornerTL,
        uTex: this.uTex,
        uOpacity: this.uOpacity,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // PlaneGeometry default positions are in [-W/2, W/2] x [-H/2, H/2],
    // UVs are in [0,1]^2 (0 at bottom-left). Vertex shader ignores position
    // and uses uv to compute the destination via the 4 corners.
    const geom = new THREE.PlaneGeometry(W, H, gridX, gridY);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.z = this.layerZ;
    this.mesh.renderOrder = 10; // render after BG (renderOrder = 0)
    this.mesh.frustumCulled = false;
  }

  /**
   * Update 4 corner positions (world units). Pass null Vector2(0,0) untuk
   * sembunyikan quad (akan di-skip saat render check).
   */
  setCorners(bl: THREE.Vector2, br: THREE.Vector2, tr: THREE.Vector2, tl: THREE.Vector2): void {
    this.uCornerBL.value.copy(bl);
    this.uCornerBR.value.copy(br);
    this.uCornerTR.value.copy(tr);
    this.uCornerTL.value.copy(tl);
  }

  setOpacity(opacity: number): void {
    this.uOpacity.value = Math.max(0, Math.min(1, opacity));
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
    this.uTex.value.dispose();
  }
}
