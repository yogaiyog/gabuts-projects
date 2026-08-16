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
  varying vec2 vUv;

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

    vUv = uv;
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
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec2 mirrorUv = vec2(mix(vSampleUv.x, 1.0 - vSampleUv.x, uMirror), vSampleUv.y);
    vec2 px = mirrorUv * uTexSize;
    vec2 block = floor(px / vec2(uBlockH, uBlockV)) * vec2(uBlockH, uBlockV);
    vec2 blockCenterUV = (block + vec2(uBlockH, uBlockV) * 0.5) / uTexSize;
    vec3 c = texture2D(uTex, blockCenterUV).rgb;
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SOBELX_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uMirror;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

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
    vec3 c = mix(vec3(g), uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ──────────────────────────────────────────────────────────────────────
// Additional effect fragment shaders (sample vSampleUv = webcam crop)
// ──────────────────────────────────────────────────────────────────────

// Helper snippet: mirror-aware sample (duplicated per shader untuk kemudahan)
// uMirror=0.0 (raw) untuk semua effect quad sekarang.

const INVERT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    c = 1.0 - c;
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const GRAYSCALE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec2 px = 1.0 / uTexSize;
    vec3 sum = vec3(0.0);
    for (int y = -6; y <= 6; y++) {
      for (int x = -6; x <= 6; x++) {
        sum += texture2D(uTex, vSampleUv + vec2(float(x), float(y)) * px).rgb;
      }
    }
    vec3 c = mix(sum / 169.0, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const EMBOSS_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec2 px = 1.0 / uTexSize;
    float tl = texture2D(uTex, vSampleUv + vec2(-px.x,  px.y)).r;
    float t  = texture2D(uTex, vSampleUv + vec2(   0.0, px.y)).r;
    float tr = texture2D(uTex, vSampleUv + vec2( px.x,  px.y)).r;
    float l  = texture2D(uTex, vSampleUv + vec2(-px.x,   0.0)).r;
    float r  = texture2D(uTex, vSampleUv + vec2( px.x,   0.0)).r;
    float bl = texture2D(uTex, vSampleUv + vec2(-px.x, -px.y)).r;
    float b  = texture2D(uTex, vSampleUv + vec2(   0.0,-px.y)).r;
    float br = texture2D(uTex, vSampleUv + vec2( px.x, -px.y)).r;

    float e = -tl - t - tr - l + 4.0 * r - bl - b - br;
    float g = clamp(e + 0.5, 0.0, 1.0);
    vec3 c = mix(vec3(g), uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const POSTERIZE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    float levels = 8.0;
    c = floor(c * levels) / (levels - 1.0);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const THRESHOLD_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float t = step(0.3, l);
    vec3 col = mix(vec3(t), uTintColor, uTintAlpha);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SEPIA_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    mat3 m = mat3(
      0.393, 0.769, 0.189,
      0.349, 0.686, 0.168,
      0.272, 0.534, 0.131
    );
    c = mix(m * c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SHARPEN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec2 px = 1.0 / uTexSize;
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    vec3 sum = -4.0 * c;
    sum += texture2D(uTex, vSampleUv + vec2(-px.x,   0.0)).rgb;
    sum += texture2D(uTex, vSampleUv + vec2( px.x,   0.0)).rgb;
    sum += texture2D(uTex, vSampleUv + vec2(   0.0,  px.y)).rgb;
    sum += texture2D(uTex, vSampleUv + vec2(   0.0, -px.y)).rgb;
    vec3 sharp = 5.0 * c
      - texture2D(uTex, vSampleUv + vec2(-px.x,   0.0)).rgb
      - texture2D(uTex, vSampleUv + vec2( px.x,   0.0)).rgb
      - texture2D(uTex, vSampleUv + vec2(   0.0,  px.y)).rgb
      - texture2D(uTex, vSampleUv + vec2(   0.0, -px.y)).rgb;
    c = mix(clamp(sharp, 0.0, 1.0), uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "RGB Split / Glitch": offset channel R/G/B (px, digerakkan oleh uTime
// supaya intensitasnya "berdenyut") — efek chromatic aberration ala VHS/glitch.
const RGB_SPLIT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uTime;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
    vec2 offset = vec2(6.0, 0.0) / uTexSize * (0.5 + pulse);
    float r = texture2D(uTex, vSampleUv + offset).r;
    float g = texture2D(uTex, vSampleUv).g;
    float b = texture2D(uTex, vSampleUv - offset).b;
    vec3 c = vec3(r, g, b);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Rainbow Wave": luminance webcam di-remap ke warna HSV yang hue-nya
// bergeser terus mengikuti uTime — hasilnya gelombang warna pelangi
// yang tetap mengikuti bentuk gambar aslinya.
const RAINBOW_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform float uTime;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  vec3 hsv2rgb(vec3 c) {
    vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 tex = texture2D(uTex, vSampleUv).rgb;
    float l = dot(tex, vec3(0.299, 0.587, 0.114));
    float hue = fract(l + uTime * 0.15);
    vec3 rainbow = hsv2rgb(vec3(hue, 1.0, 1.0));
    vec3 c = rainbow * (0.4 + 0.6 * l);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Duotone": remap luminance ke 2 warna (gelap→terang), default cyberpunk
// ungu-cyan. Warna bisa diganti via setDuotoneColors().
const DUOTONE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uDuotoneColorA;
  uniform vec3 uDuotoneColorB;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 tex = texture2D(uTex, vSampleUv).rgb;
    float l = dot(tex, vec3(0.299, 0.587, 0.114));
    vec3 c = mix(uDuotoneColorA, uDuotoneColorB, l);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Neon Glow": edge-detect (gradient magnitude), garis pinggir diwarnai
// hue pelangi yang bergerak (uTime), background gelap → kesan neon glow.
const NEON_GLOW_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uTime;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  float gray(vec2 uv) {
    return dot(texture2D(uTex, uv).rgb, vec3(0.299, 0.587, 0.114));
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 px = 1.0 / uTexSize;
    float gx = gray(vSampleUv + vec2(px.x, 0.0)) - gray(vSampleUv - vec2(px.x, 0.0));
    float gy = gray(vSampleUv + vec2(0.0, px.y)) - gray(vSampleUv - vec2(0.0, px.y));
    float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
    float hue = fract(uTime * 0.1 + vSampleUv.x * 0.5 + vSampleUv.y * 0.5);
    vec3 neon = hsv2rgb(vec3(hue, 1.0, 1.0));
    vec3 c = neon * edge;
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Thermal / False Color": remap luminance webcam ke gradient warna kamera
// termal (biru dingin → cyan → hijau → kuning → merah panas).
const THERMAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  vec3 thermalPalette(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c1 = vec3(0.0, 0.0, 0.6);
    vec3 c2 = vec3(0.0, 0.9, 0.9);
    vec3 c3 = vec3(0.1, 0.9, 0.1);
    vec3 c4 = vec3(1.0, 1.0, 0.0);
    vec3 c5 = vec3(1.0, 0.0, 0.0);

    if (t < 0.25) return mix(c1, c2, t / 0.25);
    if (t < 0.5)  return mix(c2, c3, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c3, c4, (t - 0.5) / 0.25);
    return mix(c4, c5, (t - 0.75) / 0.25);
  }

  void main() {
    vec3 tex = texture2D(uTex, vSampleUv).rgb;
    float l = dot(tex, vec3(0.299, 0.587, 0.114));
    vec3 c = thermalPalette(l);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Halftone / Comic Dots": separasi CMYK jadi pola dot dengan sudut rotasi
// berbeda (C=15°, M=75°, Y=0°, K=45°), ukuran dot ∝ intensitas ink, di atas
// background putih. Ukuran cell diatur via uHalftoneScale (setHalftoneScale).
const HALFTONE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform float uHalftoneScale;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  float dotPattern(vec2 uv, float angleDeg, float value) {
    float angle = radians(angleDeg);
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 pxUv = uv * uTexSize;
    vec2 p = rot * pxUv / uHalftoneScale;
    vec2 cellCenter = floor(p) + 0.5;
    float dist = length(p - cellCenter);
    float radius = sqrt(clamp(value, 0.0, 1.0)) * 0.6;
    return 1.0 - smoothstep(radius - 0.08, radius + 0.08, dist);
  }

  void main() {
    vec3 rgb = texture2D(uTex, vSampleUv).rgb;
    vec3 cmy = 1.0 - rgb;
    float k = min(cmy.r, min(cmy.g, cmy.b));
    vec3 ink = (1.0 - k > 0.0001) ? (cmy - k) / (1.0 - k) : vec3(0.0);

    float cDot = dotPattern(vSampleUv, 15.0, ink.r);
    float mDot = dotPattern(vSampleUv, 75.0, ink.g);
    float yDot = dotPattern(vSampleUv, 0.0, ink.b);
    float kDot = dotPattern(vSampleUv, 45.0, k);

    vec3 c = vec3(1.0);
    c -= cDot * vec3(0.0, 1.0, 1.0) * 0.9;
    c -= mDot * vec3(1.0, 0.0, 1.0) * 0.9;
    c -= yDot * vec3(1.0, 1.0, 0.0) * 0.9;
    c -= kDot * vec3(1.0, 1.0, 1.0) * 0.9;
    c = clamp(c, 0.0, 1.0);

    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Bendera" effect: overlay merah (atas) / putih (bawah) semi-transparan
// di atas webcam crop — bendera Indonesia, transparan (tidak solid).
const BENDERA_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vSampleUv;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec3 c = texture2D(uTex, vSampleUv).rgb;
    vec3 flag = vUv.y > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(1.0, 1.0, 1.0);
    float alpha = 0.5;
    c = mix(c, flag, alpha);
    c = mix(c, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// "Text" effect: TIDAK sample webcam. Sample teks texture via vUv (plain
// unit UV) → di dalam frame transparan (webcam tembus), hanya teks + edge.
const TEXT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTextTex;
  uniform vec3 uTextColor;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    float a = texture2D(uTextTex, vUv).a;
    vec3 c = mix(uTextColor, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, a);
  }
`;

// "Image" effect: TIDAK sample webcam. Sample gambar (RGBA) via vUv → bagian
// transparan gambar tembus webcam, bagian non-transparan menampilkan gambar.
const IMAGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uImageTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec4 c = texture2D(uImageTex, vUv);
    vec3 rgb = mix(c.rgb, uTintColor, uTintAlpha);
    gl_FragColor = vec4(rgb, c.a);
  }
`;

// "Carousel" effect: sama persis seperti "text" (teks alpha mask + tint warna,
// latar transparan), tapi teksnya datang dari array carousel yang maju via
// two-hand pinch. Sample uCarouselTex supaya independen dari "text" input.
const CAROUSEL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uCarouselTex;
  uniform vec3 uTextColor;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    float a = texture2D(uCarouselTex, vUv).a;
    vec3 c = mix(uTextColor, uTintColor, uTintAlpha);
    gl_FragColor = vec4(c, a);
  }
`;

// "Image Carousel" effect: sama seperti "image" tapi sample uImageCarouselTex
// (array gambar, maju via pinch).
const IMAGE_CAROUSEL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uImageCarouselTex;
  uniform vec3 uTintColor;
  uniform float uTintAlpha;

  void main() {
    vec4 c = texture2D(uImageCarouselTex, vUv);
    vec3 rgb = mix(c.rgb, uTintColor, uTintAlpha);
    gl_FragColor = vec4(rgb, c.a);
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

export type EffectKind =
  | "pixelate" | "sobel-x" | "invert" | "grayscale" | "blur"
  | "emboss" | "posterize" | "threshold" | "sepia" | "sharpen" | "text"
  | "bendera" | "image" | "carousel" | "image-carousel"
  | "rgb-split" | "rainbow" | "duotone" | "neon-glow"
  | "thermal" | "halftone";

/** Efek yang bisa dipilih di dropdown frame — EffectKind + meta "cycle". */
export type FrameEffect = EffectKind | "cycle";

export interface EffectDef {
  id: EffectKind;
  label: string;
}

export const EFFECTS: EffectDef[] = [
  { id: "pixelate", label: "Pixelate" },
  { id: "sobel-x", label: "Sobel-X" },
  { id: "invert", label: "Invert" },
  { id: "grayscale", label: "Grayscale" },
  { id: "blur", label: "Blur" },
  { id: "emboss", label: "Emboss" },
  { id: "posterize", label: "Posterize" },
  { id: "threshold", label: "Threshold" },
  { id: "sepia", label: "Sepia" },
  { id: "sharpen", label: "Sharpen" },
  { id: "rgb-split", label: "RGB Split" },
  { id: "rainbow", label: "Rainbow Wave" },
  { id: "duotone", label: "Duotone" },
  { id: "neon-glow", label: "Neon Glow" },
  { id: "thermal", label: "Thermal" },
  { id: "halftone", label: "Halftone" },
  { id: "text", label: "Text" },
  { id: "bendera", label: "Bendera" },
  { id: "image", label: "Image" },
  { id: "carousel", label: "Text Carousel" },
  { id: "image-carousel", label: "Image Carousel" },
];

// Dropdown pemilih efek di tiap frame — sama seperti EFFECTS + meta "cycle".
export const FRAME_EFFECTS: { id: FrameEffect; label: string }[] = [
  ...EFFECTS,
  { id: "cycle", label: "Effect Cycle" },
];

// Sumber efek yang bisa dimasukkan ke daftar effect-cycle (dropdown editor).
// Kecualikan "carousel" dan "image-carousel" supaya tidak nesting.
export const CYCLE_EFFECT_SOURCE: EffectDef[] = EFFECTS.filter(
  (e) => e.id !== "carousel" && e.id !== "image-carousel",
);

const EFFECT_FRAG: Record<EffectKind, string> = {
  "pixelate": PIXELATE_FRAG,
  "sobel-x": SOBELX_FRAG,
  "invert": INVERT_FRAG,
  "grayscale": GRAYSCALE_FRAG,
  "blur": BLUR_FRAG,
  "emboss": EMBOSS_FRAG,
  "posterize": POSTERIZE_FRAG,
  "threshold": THRESHOLD_FRAG,
  "sepia": SEPIA_FRAG,
  "sharpen": SHARPEN_FRAG,
  "rgb-split": RGB_SPLIT_FRAG,
  "rainbow": RAINBOW_FRAG,
  "duotone": DUOTONE_FRAG,
  "neon-glow": NEON_GLOW_FRAG,
  "thermal": THERMAL_FRAG,
  "halftone": HALFTONE_FRAG,
  "text": TEXT_FRAG,
  "bendera": BENDERA_FRAG,
  "image": IMAGE_FRAG,
  "carousel": CAROUSEL_FRAG,
  "image-carousel": IMAGE_CAROUSEL_FRAG,
};

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
  material: THREE.ShaderMaterial;

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
  private uTextTex: { value: THREE.Texture };
  private uTextColor: { value: THREE.Color };
  private uImageTex: { value: THREE.Texture };
  private uCarouselTex: { value: THREE.Texture };
  private uImageCarouselTex: { value: THREE.Texture };
  private uTintColor: { value: THREE.Color };
  private uTintAlpha: { value: number };
  private uTime: { value: number };
  private uDuotoneColorA: { value: THREE.Color };
  private uDuotoneColorB: { value: THREE.Color };
  private uHalftoneScale: { value: number };
  private currentEffect: EffectKind;
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
    this.uTextTex = { value: makeTextTexture("") };
    this.uTextColor = { value: new THREE.Color(0xffffff) };
    this.uImageTex = { value: makeTransparentTexture() };
    this.uCarouselTex = { value: makeTextTexture("") };
    this.uImageCarouselTex = { value: makeTransparentTexture() };
    this.uTintColor = { value: new THREE.Color(0xffffff) };
    this.uTintAlpha = { value: 0.0 };
    this.uTime = { value: 0.0 };
    // Default duotone: cyberpunk ungu-gelap → cyan terang.
    this.uDuotoneColorA = { value: new THREE.Color(0x120024) };
    this.uDuotoneColorB = { value: new THREE.Color(0x00fff0) };
    this.uHalftoneScale = { value: 10.0 };
    this.currentEffect = opts.effect;

    this.material = this.buildMaterial(opts.effect);

    const geom = new THREE.PlaneGeometry(2, 2, 32, 32);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.frustumCulled = false;
  }

  private buildMaterial(effect: EffectKind): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: CORNER_VERTEX_SHADER,
      fragmentShader: EFFECT_FRAG[effect],
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
        uTextTex: this.uTextTex,
        uTextColor: this.uTextColor,
        uImageTex: this.uImageTex,
        uCarouselTex: this.uCarouselTex,
        uImageCarouselTex: this.uImageCarouselTex,
        uTintColor: this.uTintColor,
        uTintAlpha: this.uTintAlpha,
        uTime: this.uTime,
        uDuotoneColorA: this.uDuotoneColorA,
        uDuotoneColorB: this.uDuotoneColorB,
        uHalftoneScale: this.uHalftoneScale,
      },
      transparent: effect === "text" || effect === "image" || effect === "carousel" || effect === "image-carousel",
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /** Ganti efek saat runtime (rebuild fragment shader + transparent flag). */
  setEffect(effect: EffectKind): void {
    if (effect === this.currentEffect) return;
    this.currentEffect = effect;
    this.material.dispose();
    this.material = this.buildMaterial(effect);
    this.mesh.material = this.material;
  }

  /** Set teks untuk effect "text" (regenerate CanvasTexture). */
  setText(text: string): void {
    const old = this.uTextTex.value;
    this.uTextTex.value = makeTextTexture(text);
    if (old && old.dispose) old.dispose();
  }

  /** Set teks untuk effect "carousel" (regenerate CanvasTexture). */
  setCarouselText(text: string): void {
    const old = this.uCarouselTex.value;
    this.uCarouselTex.value = makeTextTexture(text);
    if (old && old.dispose) old.dispose();
  }

  /** Set gambar untuk effect "image-carousel". null → texture transparan. */
  setImageCarousel(texture: THREE.Texture | null): void {
    this.uImageCarouselTex.value = texture ?? makeTransparentTexture();
  }

  /** Set warna teks (hex). */
  setTextColor(hex: number): void {
    this.uTextColor.value.setHex(hex);
  }

  /** Set gambar untuk effect "image". */
  setImage(texture: THREE.Texture): void {
    this.uImageTex.value = texture;
  }

  /** Set warna tint overlay (hex 0xRRGGBB). */
  setTintColor(hex: number): void {
    this.uTintColor.value.setHex(hex);
  }

  /** Set intensitas tint (0.0 = transparan, 1.0 = full tint). */
  setTintAlpha(alpha: number): void {
    this.uTintAlpha.value = Math.max(0, Math.min(1, alpha));
  }

  /** Clear tint (reset ke transparan). */
  clearTint(): void {
    this.uTintAlpha.value = 0.0;
  }

  /**
   * Update jam animasi (detik), dipakai oleh effect "rgb-split" (pulse
   * offset), "rainbow" (hue shift), dan "neon-glow" (hue shift garis).
   * Panggil tiap frame di render loop, misal: quad.setTime(clock.getElapsedTime()).
   */
  setTime(seconds: number): void {
    this.uTime.value = seconds;
  }

  /** Set 2 warna duotone (hex 0xRRGGBB): A = area gelap, B = area terang. */
  setDuotoneColors(colorA: number, colorB: number): void {
    this.uDuotoneColorA.value.setHex(colorA);
    this.uDuotoneColorB.value.setHex(colorB);
  }

  /** Atur ukuran cell dot halftone (px), makin besar = dot makin besar/renggang. */
  setHalftoneScale(px: number): void {
    this.uHalftoneScale.value = Math.max(2.0, px);
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
    if (this.uTextTex.value && this.uTextTex.value.dispose) this.uTextTex.value.dispose();
    if (this.uImageTex.value && this.uImageTex.value.dispose) this.uImageTex.value.dispose();
    if (this.uCarouselTex.value && this.uCarouselTex.value.dispose) this.uCarouselTex.value.dispose();
    if (this.uImageCarouselTex.value && this.uImageCarouselTex.value.dispose) this.uImageCarouselTex.value.dispose();
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

/**
 * Buat texture 1×1 transparan (fallback aman sebelum gambar asli di-set).
 */
function makeTransparentTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 1;
  cv.height = 1;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, 1, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Buat texture teks (putih, latar transparan) via Canvas2D. Teks auto-fit
 * lebar canvas (shrink font). Dipakai oleh effect "text" sebagai alpha mask
 * (warna final di-tint oleh uTextColor).
 */
export function makeTextTexture(text: string): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  if (text && text.length > 0) {
    let fontSize = 160;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    while (ctx.measureText(text).width > size * 0.9 && fontSize > 16) {
      fontSize -= 8;
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, size / 2, size / 2);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}