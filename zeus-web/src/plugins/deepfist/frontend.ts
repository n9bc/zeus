// SPDX-License-Identifier: GPL-3.0-or-later
//
// DeepFist front-end, ported from the n9bc/DeepFist Python reference so the
// model sees the same input it was trained and qualified on. Pure functions
// (no ORT, no DOM) so they can be unit-tested and run inside the worker.
//
// Live pipeline, per window of model-rate (3200 Hz) audio, mirroring
// scripts/tci_decode.py:
//   squelch (keying gate, on RAW audio) -> de-spike -> condition
//   -> spectrogram -> CNN+CTC -> greedy frames -> commit settled chars
//
// Reference sources (DeepFist repo):
//   tools/squelch.py                 keyingRatio
//   tools/despike.py                 despike
//   deepfist/features/conditioner.py condition
//   deepfist/features/spectrogram.py audioToSpectrogram
//   scripts/tci_decode.py            greedyFrames, commitSettled
//
// Deliberate deviations, tuned for Zeus's RX audio (see each function):
//   - the squelch's CW search band and threshold are parameters (the
//     reference hard-codes 550–800 Hz for Lyra's ~700 Hz pitch, and 12);
//   - tone detection averages over the whole window, not its first 1.3 s.

export const MODEL_SR = 3200;

// --- shared helpers --------------------------------------------------------

/** scipy.ndimage 'reflect' boundary: (d c b a | a b c d | d c b a). */
function reflectIndex(i: number, n: number): number {
  const period = 2 * n;
  let k = ((i % period) + period) % period;
  if (k >= n) k = period - 1 - k;
  return k;
}

/** numpy.percentile with the default 'linear' interpolation. */
function percentileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (q / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Cos/sin table for an N-point DFT: twiddle index (k*n) mod N. */
function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return { cos, sin };
}

/** |DFT| of `frame` at bin k, using a precomputed table of frame.length. */
function dftMag(
  frame: Float64Array,
  k: number,
  tw: { cos: Float64Array; sin: Float64Array },
): number {
  const n = frame.length;
  let re = 0;
  let im = 0;
  let idx = 0;
  for (let i = 0; i < n; i += 1) {
    re += frame[i]! * tw.cos[idx]!;
    im -= frame[i]! * tw.sin[idx]!;
    idx += k;
    if (idx >= n) idx -= n;
  }
  return Math.hypot(re, im);
}

// --- squelch (tools/squelch.py) --------------------------------------------

/** DeepFist reference gate, calibrated on Lyra audio (signal scored 41–73,
 *  dead air 3.4–3.9). */
export const SQUELCH_THRESHOLD = 12;
const SQUELCH_FRAME_MS = 10;

/**
 * Max over CW-band bins of p90/p10 of the amplitude envelope. Steady tone or
 * noise scores ~4; a keyed CW signal scores tens. Mirrors scipy.signal.stft
 * (periodic Hann, zero-padded tail, boundary=None, 'spectrum' scaling) since
 * the +1e-3 floor makes the ratio scale-sensitive.
 */
export function keyingRatio(
  audio: Float32Array,
  sr: number,
  bandLoHz: number,
  bandHiHz: number,
): number {
  const n = audio.length;
  if (n < 256) return 0;
  const hop = Math.max(1, Math.floor((sr * SQUELCH_FRAME_MS) / 1000));
  const nper = Math.min(Math.max(hop * 2, 512), n);

  const nadd = (((-(n - nper)) % hop) + hop) % hop;
  const total = n + nadd;
  const frames = Math.floor((total - nper) / hop) + 1;
  if (frames < 4) return 0;

  const win = new Float64Array(nper);
  let winSum = 0;
  for (let i = 0; i < nper; i += 1) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nper);
    winSum += win[i]!;
  }
  const scale = 1 / winSum;

  const bins: number[] = [];
  for (let k = 0; k <= Math.floor(nper / 2); k += 1) {
    const f = (k * sr) / nper;
    if (f >= bandLoHz && f <= bandHiHz) bins.push(k);
  }
  if (bins.length === 0) return 0;

  const tw = twiddles(nper);
  const mag: Float64Array[] = bins.map(() => new Float64Array(frames));
  const frame = new Float64Array(nper);
  for (let t = 0; t < frames; t += 1) {
    const start = t * hop;
    for (let i = 0; i < nper; i += 1) {
      const s = start + i;
      frame[i] = (s < n ? audio[s]! : 0) * win[i]!;
    }
    for (let b = 0; b < bins.length; b += 1) {
      mag[b]![t] = dftMag(frame, bins[b]!, tw) * scale;
    }
  }

  // Smooth over 3 adjacent bins (edges clipped) when there are at least 3.
  const nb = bins.length;
  const sub =
    nb >= 3
      ? mag.map((_, i) => {
          const out = new Float64Array(frames);
          for (let j = Math.max(0, i - 1); j < Math.min(nb, i + 2); j += 1) {
            const row = mag[j]!;
            for (let t = 0; t < frames; t += 1) out[t]! += row[t]!;
          }
          return out;
        })
      : mag;

  let best = 0;
  for (const row of sub) {
    const sorted = Float64Array.from(row).sort();
    const ratio = percentileSorted(sorted, 90) / (percentileSorted(sorted, 10) + 1e-3);
    if (ratio > best) best = ratio;
  }
  return best;
}

// --- de-spike (tools/despike.py) -------------------------------------------

/** Blank brief impulse spikes: envelope samples above k × the local median. */
export function despike(
  x: Float32Array,
  sr: number,
  k = 5,
  winMs = 8,
  guardMs = 0.5,
): Float32Array {
  const n = x.length;
  if (n < 8) return x;
  const w = Math.max(3, Math.floor((sr * winMs) / 1000) | 1);
  const half = (w - 1) / 2;

  const ax = new Float64Array(n);
  for (let i = 0; i < n; i += 1) ax[i] = Math.abs(x[i]!);

  const spike = new Uint8Array(n);
  let any = false;
  const buf = new Float64Array(w);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < w; j += 1) buf[j] = ax[reflectIndex(i - half + j, n)]!;
    buf.sort();
    const base = buf[half]! + 1e-6;
    if (ax[i]! > k * base) {
      spike[i] = 1;
      any = true;
    }
  }
  if (!any) return x;

  const g = Math.max(0, Math.floor((sr * guardMs) / 1000));
  let mask = spike;
  if (g) {
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      for (let j = -g; j <= g; j += 1) {
        if (spike[reflectIndex(i + j, n)]) {
          mask[i] = 1;
          break;
        }
      }
    }
  }
  const y = Float32Array.from(x);
  for (let i = 0; i < n; i += 1) if (mask[i]) y[i] = 0;
  return y;
}

// --- conditioner (deepfist/features/conditioner.py) ------------------------

const TONE_NFFT = 4096;
const OUT_PITCH = 600;
const COND_BW_HZ = 90;
const TONE_LO_HZ = 400;
const TONE_HI_HZ = 1200;

/**
 * Dominant CW tone (Hz) in 400–1200 Hz, from Welch-averaged power over the
 * WHOLE window: Hann segments of 4096 with 50% overlap, per-segment mean
 * removed (scipy.signal.welch defaults). Deviation from the conditioner's
 * single FFT of the first 4096 samples — on a sliding live window that
 * oldest 1.3 s is often a gap or another station, and the 90 Hz matched
 * filter then locks off the signal being copied. The averaged form is the
 * one DeepFist's tools/cw_frontend.py reference uses.
 */
export function detectTone(audio: Float32Array, sr: number): number {
  const seg = Math.min(audio.length, TONE_NFFT);
  if (seg < 8) return OUT_PITCH;
  const hop = Math.max(1, Math.floor(seg / 2));
  const win = new Float64Array(seg);
  for (let i = 0; i < seg; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg);
  const tw = twiddles(seg);
  const lo = Math.ceil((TONE_LO_HZ * seg) / sr);
  const hi = Math.min(Math.floor(seg / 2), Math.floor((TONE_HI_HZ * seg) / sr));
  if (hi < lo) return OUT_PITCH;
  const power = new Float64Array(hi - lo + 1);
  const frame = new Float64Array(seg);
  for (let start = 0; start + seg <= audio.length; start += hop) {
    let mean = 0;
    for (let i = 0; i < seg; i += 1) mean += audio[start + i]!;
    mean /= seg;
    for (let i = 0; i < seg; i += 1) frame[i] = (audio[start + i]! - mean) * win[i]!;
    for (let k = lo; k <= hi; k += 1) power[k - lo]! += dftMag(frame, k, tw) ** 2;
  }
  let best = 0;
  for (let k = 1; k < power.length; k += 1) if (power[k]! > power[best]!) best = k;
  return ((lo + best) * sr) / seg;
}

/**
 * Isolate and normalise one CW signal: AGC to unit RMS, lock to the dominant
 * tone, two cascaded 1-pole low-passes at baseband, re-centre at 600 Hz,
 * peak-normalise. Windows shorter than the tone FFT pass through unchanged,
 * as in the reference. Pass `toneHz` to skip detection (the worker detects
 * once and reports the tone).
 */
export function condition(audio: Float32Array, sr: number, toneHz?: number): Float32Array {
  const n = audio.length;
  if (n < TONE_NFFT) return audio;

  let sumSq = 0;
  for (let i = 0; i < n; i += 1) sumSq += audio[i]! * audio[i]!;
  const rms = Math.sqrt(sumSq / n) + 1e-9;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 1) x[i] = audio[i]! / rms;

  const tone = toneHz ?? detectTone(x, sr);
  const alpha = 1 - Math.exp((-2 * Math.PI * (COND_BW_HZ * 0.5)) / sr);
  const decay = 1 - alpha;

  const out = new Float32Array(n);
  let r1 = 0;
  let i1 = 0;
  let r2 = 0;
  let i2 = 0;
  let peak = 0;
  for (let k = 0; k < n; k += 1) {
    const down = (-2 * Math.PI * tone * k) / sr;
    const bbRe = x[k]! * Math.cos(down);
    const bbIm = x[k]! * Math.sin(down);
    r1 = alpha * bbRe + decay * r1;
    i1 = alpha * bbIm + decay * i1;
    r2 = alpha * r1 + decay * r2;
    i2 = alpha * i1 + decay * i2;
    const up = (2 * Math.PI * OUT_PITCH * k) / sr;
    const v = r2 * Math.cos(up) - i2 * Math.sin(up);
    out[k] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const inv = 1 / (peak + 1e-9);
  for (let k = 0; k < n; k += 1) out[k] = out[k]! * inv;
  return out;
}

// --- spectrogram (deepfist/features/spectrogram.py) ------------------------

export type Spectrogram = { data: Float32Array; bins: number; frames: number };

/**
 * torch.stft(center=True, reflect pad, periodic Hann) magnitudes over the
 * model band, log1p, then standardised over the whole window (unbiased std,
 * as torch.Tensor.std). Laid out [bins, frames] for the [1,1,F,T] input.
 */
export function audioToSpectrogram(
  audio: Float32Array,
  sr: number,
  nFft: number,
  hop: number,
  bandLoHz: number,
  bandHiHz: number,
): Spectrogram {
  const hzPerBin = sr / nFft;
  const lo = Math.ceil(bandLoHz / hzPerBin);
  const hi = Math.floor(bandHiHz / hzPerBin) + 1;
  const bins = hi - lo;
  const pad = Math.floor(nFft / 2);
  const n = audio.length;
  if (n <= pad) throw new Error(`audio too short for n_fft=${nFft}`);

  const frames = 1 + Math.floor(n / hop);
  const win = new Float64Array(nFft);
  for (let i = 0; i < nFft; i += 1) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  }
  const tw = twiddles(nFft);
  const data = new Float32Array(bins * frames);
  const frame = new Float64Array(nFft);
  for (let t = 0; t < frames; t += 1) {
    const start = t * hop - pad;
    for (let i = 0; i < nFft; i += 1) {
      // torch 'reflect' pad excludes the edge sample: (c b | a b c d | c b).
      let s = start + i;
      if (s < 0) s = -s;
      else if (s >= n) s = 2 * (n - 1) - s;
      frame[i] = audio[s]! * win[i]!;
    }
    for (let b = 0; b < bins; b += 1) {
      data[b * frames + t] = Math.log1p(dftMag(frame, lo + b, tw));
    }
  }

  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i]!;
  mean /= data.length;
  let ss = 0;
  for (let i = 0; i < data.length; i += 1) ss += (data[i]! - mean) ** 2;
  const std = Math.sqrt(ss / Math.max(1, data.length - 1));
  const inv = 1 / (std + 1e-6);
  for (let i = 0; i < data.length; i += 1) data[i] = (data[i]! - mean) * inv;

  return { data, bins, frames };
}

// --- CTC decode + streaming commit (scripts/tci_decode.py) -----------------

export type FrameChar = { id: number; frame: number };

/**
 * Greedy CTC over log-probs laid out [time, batch=1, classes], keeping the
 * output frame of each emitted symbol so the caller can place it in time.
 */
export function greedyFrames(
  logProbs: Float32Array,
  timeSteps: number,
  classes: number,
  blankIndex: number,
  blankPenalty = 0,
): FrameChar[] {
  const out: FrameChar[] = [];
  let prev: number | null = null;
  for (let t = 0; t < timeSteps; t += 1) {
    let best = 0;
    let bestVal = -Infinity;
    for (let c = 0; c < classes; c += 1) {
      let v = logProbs[t * classes + c]!;
      if (c === blankIndex) v -= blankPenalty;
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best !== prev) {
      if (best !== blankIndex) out.push({ id: best, frame: t });
      prev = best;
    }
  }
  return out;
}

/**
 * Emit the characters whose timestamp falls in the newly-settled band
 * (committedT, audioEnd − guard], exactly once. The boundary advances by
 * settled time, not by the last character, so overlapping re-decodes never
 * reprint a character.
 */
export function commitSettled(
  chars: FrameChar[],
  timeSteps: number,
  windowSeconds: number,
  audioEnd: number,
  guardSeconds: number,
  committedT: number,
): { emit: FrameChar[]; committedT: number } {
  const winStart = audioEnd - windowSeconds;
  const settleTo = audioEnd - guardSeconds;
  const steps = Math.max(1, timeSteps);
  const emit = chars.filter((c) => {
    const t = winStart + (c.frame / steps) * windowSeconds;
    return committedT < t && t <= settleTo;
  });
  return { emit, committedT: Math.max(committedT, settleTo) };
}

/**
 * Render committed tokens the way the DeepFist live decoder does by default:
 * BT (=) becomes a line break, and ',' / '.' are dropped (they are almost
 * always gap noise on real audio).
 */
export function renderTokens(ids: number[], tokens: string[]): string {
  return ids
    .map((id) => tokens[id] ?? '')
    .join('')
    .replace(/=/g, '\n')
    .replace(/[,.]/g, '');
}
