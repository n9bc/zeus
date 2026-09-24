// SPDX-License-Identifier: GPL-2.0-or-later
//
// Zeus — OpenHPSDR Protocol-1 / Protocol-2 client.
// Copyright (C) 2025-2026 Brian Keating (EI6LF),
//                         Douglas J. Cerrato (KB2UKA), and contributors.
//
// RX audio -> 3200 Hz front end shared by the neural CW decoders (DeepCW in
// cw-decoder.worker.ts, DeepFist in the compare panel), so both models see
// identical input.

/**
 * 4th-order Butterworth lowpass as two cascaded biquads with streaming state:
 * decimating 48 kHz -> 3200 Hz by interpolation alone folds 1.6-24 kHz into
 * the model band (2.0-2.8 kHz lands EXACTLY inside 400-1200 Hz) — wide RX
 * filters turned that fold into the reported junk. Cutoff 1350 Hz.
 */
export class CwAntiAliasFilter {
  private rate = 0;
  private readonly s = [0, 0, 0, 0, 0, 0, 0, 0];
  private c: number[][] = [];

  private design(rate: number): void {
    this.rate = rate;
    this.s.fill(0);
    this.c = [0.5411961, 1.3065630].map((q) => {
      const w0 = (2 * Math.PI * 1350) / rate;
      const alpha = Math.sin(w0) / (2 * q);
      const cosW = Math.cos(w0);
      const b0 = (1 - cosW) / 2, b1 = 1 - cosW, b2 = (1 - cosW) / 2;
      const a0 = 1 + alpha, a1 = -2 * cosW, a2 = 1 - alpha;
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    });
  }

  /** Filter `x` in place at source rate `rate`; state carries across calls. */
  process(x: Float32Array, rate: number): void {
    if (rate <= 3600) return; // already below the fold — nothing to protect
    if (this.rate !== rate) this.design(rate);
    for (let stage = 0; stage < 2; stage++) {
      const [b0, b1, b2, a1, a2] = this.c[stage]! as [number, number, number, number, number];
      const o = stage * 4;
      let x1 = this.s[o]!, x2 = this.s[o + 1]!, y1 = this.s[o + 2]!, y2 = this.s[o + 3]!;
      for (let i = 0; i < x.length; i++) {
        const xi = x[i]!;
        const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = xi; y2 = y1; y1 = yi;
        x[i] = yi;
      }
      this.s[o] = x1; this.s[o + 1] = x2; this.s[o + 2] = y1; this.s[o + 3] = y2;
    }
  }
}

export function resampleTo(audio: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return audio;
  const outLen = Math.round((audio.length * to) / from);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = (i * from) / to;
    const l = Math.floor(p);
    const r = Math.min(l + 1, audio.length - 1);
    const f = p - l;
    out[i] = audio[l]! * (1 - f) + audio[r]! * f;
  }
  return out;
}
