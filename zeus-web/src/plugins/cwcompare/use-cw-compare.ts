// SPDX-License-Identifier: GPL-2.0-or-later
//
// Drives the CW comparison panel from one RX audio tap, feeding both neural
// decoders the same audio:
//
//   - DeepCW runs the SAME worker as the CW decode window (the CW button by
//     REC): src/dsp/cw-decoder.worker.ts, in its own instance, so this column
//     reads exactly what that window would. Its streaming (12 s window, 1.6 s
//     settle) lives inside the worker.
//   - DeepFist gets the identical front end — mono downmix, the shared
//     anti-alias lowpass, streaming resample to 3200 Hz — then runs with
//     DeepFist's live-decoder timing (scripts/tci_decode.py): 0.4 s tick,
//     1.3 s commit guard — but a 10 s window instead of its 6 s, which read
//     hand-sent Zeus captures better (recovered 'TRONG', 'QSO', 'WX', '11C'). Its keying squelch is adjusted
//     for Zeus audio: it searches the whole 400–1200 Hz decode band, the
//     threshold is operator-selectable, and while it is closed the commit
//     point holds, so a signal's first characters still print once it opens
//     (the reference discards them).

import { useEffect } from 'react';
import { getAudioBus } from '../../audio/audio-bus';
import { CwAntiAliasFilter, resampleTo } from '../../dsp/cw-antialias';
import { sendAudioStreamRequest } from '../../realtime/ws-client';
import {
  decodeDeepFist,
  loadDeepFist,
  onDeepFistError,
  onDeepFistReady,
} from '../deepfist/deepfist-client';
import { MODEL_SR, commitSettled, renderTokens } from '../deepfist/frontend';
import { useCwCompareStore } from './cw-compare-store';

const DEEPFIST_WINDOW_SECONDS = 10;
const DEEPFIST_TICK_MS = 400;
const DEEPFIST_GUARD_SECONDS = 1.3;
// Below one tone-detect FFT (4096 samples) the conditioner passes audio
// through untouched, so wait for a bit more than that before decoding.
const DEEPFIST_MIN_SECONDS = 2;
// Squelch search band = the model's decode band (what DeepCW reads too).
const SQUELCH_LO_HZ = 400;
const SQUELCH_HI_HZ = 1200;

/** Interleaved -> mono by averaging channels (as the CW decode controller). */
function downmix(samples: Float32Array, channels: number): Float32Array {
  const ch = Math.max(1, channels);
  if (ch === 1) return samples.slice(); // MUST copy: view onto the WS buffer
  const n = Math.floor(samples.length / ch);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) acc += samples[i * ch + c]!;
    out[i] = acc / ch;
  }
  return out;
}

export function useCwCompare(): void {
  const active = useCwCompareStore((s) => s.state !== 'idle');

  useEffect(() => {
    if (!active) return;
    const store = useCwCompareStore.getState();
    let cancelled = false;

    // --- DeepCW: the CW decode window's worker, own instance -------------
    const cwWorker = new Worker(new URL('../../dsp/cw-decoder.worker.ts', import.meta.url), {
      type: 'module',
    });
    cwWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        store.setModelLoaded('deepcw', true);
        store.setLoadError('deepcw', null);
      } else if (msg.type === 'chars') {
        useCwCompareStore.getState().appendDecoded('deepcw', msg.text as string);
      } else if (msg.type === 'error') {
        store.setLoadError('deepcw', msg.message as string);
      }
    };
    void fetch('/deepcw/model_en.json')
      .then((r) => r.json())
      .then((meta) => {
        if (!cancelled) {
          cwWorker.postMessage({
            type: 'init',
            modelUrl: '/deepcw/model_en.onnx',
            ortBase: '/deepcw/ort/',
            meta,
          });
        }
      })
      .catch((err) => store.setLoadError('deepcw', String(err)));

    // --- DeepFist: same front end, own 10 s window -----------------------
    let deepFistTokens: string[] | null = null;
    loadDeepFist();
    const offFistReady = onDeepFistReady((_sampleRate, tokens) => {
      deepFistTokens = tokens;
      store.setModelLoaded('deepfist', true);
      store.setLoadError('deepfist', null);
    });
    const offFistError = onDeepFistError((message) => store.setLoadError('deepfist', message));

    const lpf = new CwAntiAliasFilter();
    const ringCap = DEEPFIST_WINDOW_SECONDS * MODEL_SR;
    const ring = new Float32Array(ringCap);
    let filled = 0;
    let absWritten = 0; // 3200 Hz samples ever appended — the stream clock
    let lastDecodedAbs = -1;
    let committedT = 0;
    let idleGap = false;
    let busy = false;

    sendAudioStreamRequest(true);

    const unsubscribe = getAudioBus().subscribe((frame) => {
      const mono = downmix(frame.samples, frame.channels);
      // DeepCW worker filters and resamples on its side, as in the CW window.
      const forCw = mono.slice();
      cwWorker.postMessage({ type: 'pcm', samples: forCw, sampleRate: frame.sampleRateHz }, [
        forCw.buffer,
      ]);

      lpf.process(mono, frame.sampleRateHz);
      const chunk = resampleTo(mono, frame.sampleRateHz, MODEL_SR);
      const n = chunk.length;
      if (n >= ringCap) {
        ring.set(chunk.subarray(n - ringCap));
      } else {
        ring.copyWithin(0, n);
        ring.set(chunk, ringCap - n);
      }
      filled = Math.min(ringCap, filled + n);
      absWritten += n;
    });

    const tick = async () => {
      const tokens = deepFistTokens;
      if (
        cancelled ||
        busy ||
        !tokens ||
        absWritten === lastDecodedAbs ||
        filled < DEEPFIST_MIN_SECONDS * MODEL_SR
      ) {
        return;
      }
      busy = true;
      lastDecodedAbs = absWritten;
      const audioEnd = absWritten / MODEL_SR;
      const samples = ring.slice(ringCap - filled);
      store.setDecoding(true);
      try {
        const result = await decodeDeepFist(
          samples,
          SQUELCH_LO_HZ,
          SQUELCH_HI_HZ,
          useCwCompareStore.getState().squelchThreshold,
        );
        if (cancelled) return;
        const fresh = useCwCompareStore.getState();
        fresh.setReadout({ score: result.score, open: result.active, toneHz: result.toneHz });
        if (!result.active) {
          // Hold the commit point: audio still in the window can print if
          // the gate opens on a later pass.
          if (!idleGap) {
            fresh.appendDecoded('deepfist', ' ');
            idleGap = true;
          }
          return;
        }
        idleGap = false;
        const { emit, committedT: next } = commitSettled(
          result.chars,
          result.timeSteps,
          samples.length / MODEL_SR,
          audioEnd,
          DEEPFIST_GUARD_SECONDS,
          committedT,
        );
        committedT = next;
        if (emit.length > 0) {
          fresh.appendDecoded(
            'deepfist',
            renderTokens(
              emit.map((c) => c.id),
              tokens,
            ),
          );
        }
      } catch {
        // Fatal errors surface via onDeepFistError; a single failed decode
        // is non-fatal — try again next tick.
      } finally {
        busy = false;
        if (!cancelled) store.setDecoding(false);
      }
    };
    const timer = window.setInterval(() => void tick(), DEEPFIST_TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
      offFistReady();
      offFistError();
      sendAudioStreamRequest(false);
      cwWorker.postMessage({ type: 'stop' });
      setTimeout(() => cwWorker.terminate(), 200);
      const s = useCwCompareStore.getState();
      s.setDecoding(false);
      s.setModelLoaded('deepcw', false);
      s.setReadout(null);
    };
  }, [active]);
}
