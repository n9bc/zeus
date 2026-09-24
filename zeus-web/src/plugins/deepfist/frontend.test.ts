// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MODEL_SR,
  SQUELCH_THRESHOLD,
  audioToSpectrogram,
  commitSettled,
  condition,
  detectTone,
  greedyFrames,
  keyingRatio,
  renderTokens,
  type FrameChar,
} from './frontend';

const PITCH = 620;

/** Deterministic pseudo-noise so the tests don't depend on Math.random. */
function noise(n: number, amp: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = amp * ((s / 2 ** 32) * 2 - 1);
  }
  return out;
}

/**
 * Tone keyed on/off in 300 ms elements, plus light noise. The squelch frames
 * are 160 ms long, so the gaps must outlast a frame to reach the noise floor —
 * as real CW's letter and word gaps do.
 */
function keyedTone(seconds: number): Float32Array {
  const n = Math.round(seconds * MODEL_SR);
  const x = noise(n, 0.05);
  const element = Math.round(0.3 * MODEL_SR);
  for (let i = 0; i < n; i += 1) {
    if (Math.floor(i / element) % 2 === 0) x[i]! += Math.sin((2 * Math.PI * PITCH * i) / MODEL_SR);
  }
  return x;
}

function steadyTone(seconds: number): Float32Array {
  const n = Math.round(seconds * MODEL_SR);
  const x = noise(n, 0.05);
  for (let i = 0; i < n; i += 1) x[i]! += Math.sin((2 * Math.PI * PITCH * i) / MODEL_SR);
  return x;
}

describe('keyingRatio squelch', () => {
  it('opens on keyed CW and stays shut on a steady tone or noise', () => {
    const lo = PITCH - 125;
    const hi = PITCH + 125;
    expect(keyingRatio(keyedTone(6), MODEL_SR, lo, hi)).toBeGreaterThan(SQUELCH_THRESHOLD);
    expect(keyingRatio(steadyTone(6), MODEL_SR, lo, hi)).toBeLessThan(SQUELCH_THRESHOLD);
    expect(keyingRatio(noise(6 * MODEL_SR, 0.1), MODEL_SR, lo, hi)).toBeLessThan(
      SQUELCH_THRESHOLD,
    );
  });
});

describe('condition', () => {
  it('passes windows shorter than the tone FFT through unchanged', () => {
    const short = keyedTone(1);
    expect(condition(short, MODEL_SR)).toBe(short);
  });

  it('peak-normalises the isolated tone', () => {
    const out = condition(keyedTone(6), MODEL_SR);
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeCloseTo(1, 5);
  });
});

describe('detectTone', () => {
  it('locks to the tone that dominates the window, not its first 1.3 s', () => {
    // 950 Hz for the first second, then 620 Hz keyed for the remaining five.
    const n = 6 * MODEL_SR;
    const x = noise(n, 0.05);
    for (let i = 0; i < n; i += 1) {
      const f = i < MODEL_SR ? 950 : 620;
      x[i]! += Math.sin((2 * Math.PI * f * i) / MODEL_SR);
    }
    expect(Math.abs(detectTone(x, MODEL_SR) - 620)).toBeLessThan(2);
  });
});

describe('audioToSpectrogram', () => {
  it('produces the model band shape, standardised', () => {
    const spec = audioToSpectrogram(keyedTone(6), MODEL_SR, 256, 48, 400, 1200);
    expect(spec.bins).toBe(65);
    expect(spec.frames).toBe(1 + Math.floor((6 * MODEL_SR) / 48));
    let mean = 0;
    for (const v of spec.data) mean += v;
    expect(mean / spec.data.length).toBeCloseTo(0, 4);
  });
});

describe('greedyFrames', () => {
  // Classes: 0 blank, 1 'A', 2 'B'. Layout [time, batch=1, classes].
  function logProbs(path: number[]): Float32Array {
    const out = new Float32Array(path.length * 3).fill(-10);
    path.forEach((c, t) => {
      out[t * 3 + c] = 0;
    });
    return out;
  }

  it('collapses repeats, drops blanks, and records the first frame of each symbol', () => {
    const chars = greedyFrames(logProbs([0, 1, 1, 0, 1, 2, 2, 0]), 8, 3, 0);
    expect(chars).toEqual([
      { id: 1, frame: 1 },
      { id: 1, frame: 4 },
      { id: 2, frame: 5 },
    ]);
  });

  it('applies the blank penalty', () => {
    const lp = logProbs([0, 0]);
    lp[1] = -0.5; // 'A' just below blank at t=0
    expect(greedyFrames(lp, 2, 3, 0)).toEqual([]);
    expect(greedyFrames(lp, 2, 3, 0, 1)).toEqual([{ id: 1, frame: 0 }]);
  });
});

describe('commitSettled', () => {
  it('emits each character once across overlapping re-decodes', () => {
    const window = 6;
    const guard = 1.3;
    const T = 60; // 0.1 s per output frame
    // A character at stream time 3.0 s, seen by two overlapping windows.
    const first: FrameChar[] = [{ id: 1, frame: 30 }]; // window [0, 6]
    const second: FrameChar[] = [{ id: 1, frame: 22 }]; // window [0.8, 6.8]

    const a = commitSettled(first, T, window, 6, guard, 0);
    expect(a.emit).toHaveLength(1);
    const b = commitSettled(second, T, window, 6.8, guard, a.committedT);
    expect(b.emit).toHaveLength(0);
  });

  it('holds back characters inside the guard interval', () => {
    const r = commitSettled([{ id: 1, frame: 55 }], 60, 6, 6, 1.3, 0);
    expect(r.emit).toHaveLength(0);
    expect(r.committedT).toBeCloseTo(4.7);
  });
});

describe('renderTokens', () => {
  it('renders BT as a newline and drops , and .', () => {
    const tokens = ['<blank>', ' ', 'A', ',', '.', '=', '<KN>'];
    expect(renderTokens([2, 3, 4, 5, 2, 1, 6], tokens)).toBe('A\nA <KN>');
  });
});
