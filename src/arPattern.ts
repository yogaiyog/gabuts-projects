/**
 * arPattern.ts
 * ============
 * Generate the "AR pattern" sebagai THREE.CanvasTexture (RGBA), persis seperti
 * output akhir dari chain circleTOP×4 + composite (Over) di
 * `ar_hand_filter_demo_builder.py` line 100-135:
 *
 *   pattern_outer  : radius 0.45, color rgb(1.0, 0.1, 0.1), alpha 1.0
 *   pattern_mid    : radius 0.32, color rgb(0.1, 0.9, 0.2), alpha 1.0
 *   pattern_inner  : radius 0.20, color rgb(0.2, 0.3, 1.0), alpha 1.0
 *   pattern_dot    : radius 0.06, color rgb(1.0, 0.95, 0.1), alpha 1.0
 *   pattern_text   : "AR",  white, fontsize 0.18
 *
 * Background tiap pattern TRANSPARAN (bgalpha = 0) supaya composite seperti
 * Over dapat menumpuknya sebagai fully-opaque rainbow layer.
 */

import * as THREE from "three";

export interface PatternOptions {
  width?: number;
  height?: number;
}

const PATTERN_PRESET = {
  outer: { radiusFrac: 0.45, r: 1.0, g: 0.1, b: 0.1, alpha: 1.0, soft: 0.05 },
  mid: { radiusFrac: 0.32, r: 0.1, g: 0.9, b: 0.2, alpha: 1.0, soft: 0.05 },
  inner: { radiusFrac: 0.20, r: 0.2, g: 0.3, b: 1.0, alpha: 1.0, soft: 0.05 },
  dot: { radiusFrac: 0.06, r: 1.0, g: 0.95, b: 0.1, alpha: 1.0, soft: 0.02 },
} as const;

export function generateARPatternTexture(opts: PatternOptions = {}): THREE.CanvasTexture {
  const W = opts.width ?? 1280;
  const H = opts.height ?? 720;

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for AR pattern.");

  ctx.clearRect(0, 0, W, H);

  // 4 circleTOP composite chain (Over), BG = outer, FG = dot+text di tengah
  // TD order: outer → mid → inner → dot → text (semua dengan bgalpha=0, jadi
  // setiap layer di-"over" ke sebelumnya).
  //
  // Kita draw secara berurutan dengan globalCompositeOperation='source-over'
  // (default), hanya karena background tiap circle transparent — hasilnya identik.
  drawSoftCircle(ctx, W, H, PATTERN_PRESET.outer);
  drawSoftCircle(ctx, W, H, PATTERN_PRESET.mid);
  drawSoftCircle(ctx, W, H, PATTERN_PRESET.inner);
  drawSoftCircle(ctx, W, H, PATTERN_PRESET.dot);

  drawARText(ctx, W, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function drawSoftCircle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cfg: { radiusFrac: number; r: number; g: number; b: number; alpha: number; soft: number },
): void {
  const radiusPx = cfg.radiusFrac * Math.min(W, H);
  const featherPx = cfg.soft * Math.min(W, H);
  const cx = W / 2;
  const cy = H / 2;

  // Radial gradient (softer edge mirip `softness=0.05` di TouchDesigner).
  const grad = ctx.createRadialGradient(cx, cy, Math.max(0, radiusPx - featherPx), cx, cy, radiusPx);
  grad.addColorStop(0, `rgba(${Math.round(cfg.r * 255)}, ${Math.round(cfg.g * 255)}, ${Math.round(cfg.b * 255)}, ${cfg.alpha})`);
  grad.addColorStop(1, `rgba(${Math.round(cfg.r * 255)}, ${Math.round(cfg.g * 255)}, ${Math.round(cfg.b * 255)}, 0)`);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function drawARText(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const sizePx = 0.18 * H; // mirror fontsizex/y = 0.18
  ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
  ctx.font = `bold ${sizePx}px system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AR", W / 2, H / 2);
}
