/**
 * anchored3D.ts
 * ==============
 * 3D geometric primitive (glowing torus) yang di-anchor ke posisi palm tangan.
 *
 * Karena target device adalah desktop browser (tanpa WebXR passthrough),
 * "anchored" di sini berarti: posisi, rotasi, dan skala 3D object dihitung
 * dari MediaPipe landmarks (palm center + hand size + orientation), lalu
 * dirender bersama 2D warp dalam satu Three.js scene.
 *
 * Scaling:
 *   - ukuran torus ∝ handSize (tangan besar → torus besar)
 *   - posisi palm di NDC → world units (mengikuti aspect + ortho bounds)
 *   - rotasi: hadap camera; opsional spin slow-rotation untuk "feel" 3D
 */

import * as THREE from "three";

export interface Anchored3DOptions {
  baseRadius?: number;
  tubeRadius?: number;
}

export class Anchored3D {
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private ambient: THREE.AmbientLight;
  private directional: THREE.DirectionalLight;
  private rim: THREE.PointLight;

  // Animated
  private spinSpeed = 0.6; // rad/sec
  private breathBase = 1.0;
  private breathAmp = 0.06;

  constructor(opts: Anchored3DOptions = {}) {
    const ringRadius = opts.baseRadius ?? 0.12;
    const tubeRadius = opts.tubeRadius ?? 0.025;

    this.group = new THREE.Group();

    const geom = new THREE.TorusGeometry(ringRadius, tubeRadius, 32, 96);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x6ad6ff,
      metalness: 0.6,
      roughness: 0.25,
      emissive: 0x1f3b66,
      emissiveIntensity: 0.6,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = 5; // opaque pass, after BG (renderOrder=0)
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Inline glow ring (outer transparent shell) untuk "halo" effect.
    const glowGeom = new THREE.TorusGeometry(ringRadius * 1.35, tubeRadius * 0.35, 16, 64);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x9be0ff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.renderOrder = 6; // transparent, after opaque pass
    glow.frustumCulled = false;
    this.group.add(glow);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.directional = new THREE.DirectionalLight(0xfff7d6, 0.85);
    this.directional.position.set(0.5, 0.7, 0.6);
    this.rim = new THREE.PointLight(0x4ac8ff, 1.4, 1.2);
    this.rim.position.set(-0.4, -0.3, 0.2);
    this.group.add(this.ambient);
    this.group.add(this.directional);
    this.group.add(this.rim);

    this.group.visible = false;
  }

  /**
   * Update posisi & skala sesuai palm center & hand size dari HandState.
   * `worldPerUnit` = unit conversion dari normalized (0..1) ke world units
   * untuk kamera ortho dengan bounds left=-aspect, right=aspect, top=1, bottom=-1.
   *
   * Convert:
   *   worldX = (0.5 - palmX_normalized) * 2 * aspect
   *   worldY = (0.5 - palmY_normalized) * 2     (image y=0 top → ortho y=+1 top)
   *
   * 'noHand' flag sembunyikan group.
   */
  update(opts: {
    palmX: number;
    palmY: number;
    handSize: number;
    aspect: number;
    timeSeconds: number;
  }): void {
    const { palmX, palmY, handSize, aspect, timeSeconds } = opts;

    if (handSize < 0.04) {
      this.group.visible = false;
      return;
    }

    const worldX = (0.5 - palmX) * 2 * aspect;
    const worldY = (0.5 - palmY) * 2;

    this.group.position.set(worldX, worldY, -0.5); // z=-0.5 = di depan BG & warp

    // Scale: handSize ~ 0.10..0.30 normalized → target visual diameter ~ 0.45..1.0 world units
    // Gunakan square-root agar scaling tetap smooth.
    const sizeFactor = Math.sqrt(handSize / 0.18); // 1.0 saat handSize=0.18
    const breath = this.breathBase + this.breathAmp * Math.sin(timeSeconds * 1.8);
    const s = Math.max(0.5, Math.min(3.5, sizeFactor)) * breath;

    this.group.scale.setScalar(s);
    this.group.visible = true;

    // Spin axis Y (vertical) + sedikit wobble di X untuk "alive" feel.
    this.mesh.rotation.y = timeSeconds * this.spinSpeed;
    this.mesh.rotation.x = 0.15 * Math.sin(timeSeconds * 0.6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.children.forEach((c) => {
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
      const mat = (c as THREE.Mesh).material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}
