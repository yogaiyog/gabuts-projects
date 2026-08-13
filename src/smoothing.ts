/**
 * smoothing.ts
 * =============
 * One Euro filter (Casiez et al. 2012) untuk menghaluskan posisi landmark
 * tangan — menghilangkan jitter deteksi MediaPipe dengan lag minimal.
 *
 * - `OneEuroFilter`: filter adaptif 1D (nilai x atau y).
 * - `PointSmoother`: pasangan filter x & y untuk satu titik landmark.
 */

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number | null = null;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  setMinCutoff(c: number): void {
    this.minCutoff = c;
  }

  filter(x: number, time: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = time;
      return x;
    }

    const dt = Math.max(1e-6, time - this.tPrev);
    this.tPrev = time;

    // Derivatif (kecepatan) lalu di-smooth dengan cutoff terpisah.
    const dx = (x - this.xPrev) / dt;
    const dAlpha = alpha(this.dCutoff, dt);
    this.dxPrev = this.dxPrev === null ? dx : dAlpha * dx + (1 - dAlpha) * this.dxPrev;

    // Cutoff adaptif: naik saat gerak cepat (beta * |velocity|) → responsif.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = alpha(cutoff, dt);
    const xFilt = a * x + (1 - a) * this.xPrev;
    this.xPrev = xFilt;
    return xFilt;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
}

export class PointSmoother {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  setMinCutoff(c: number): void {
    this.fx.setMinCutoff(c);
    this.fy.setMinCutoff(c);
  }

  filter(x: number, y: number, time: number): { x: number; y: number } {
    return { x: this.fx.filter(x, time), y: this.fy.filter(y, time) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
