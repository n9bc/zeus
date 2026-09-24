// SPDX-License-Identifier: GPL-3.0-or-later
//
// DeepFist decode worker. Runs the n9bc/DeepFist exp27_bt ONNX model
// (vendored under public/deepfist, GPL-3.0-or-later — see NOTICE.txt) over
// one window of model-rate audio and returns each emitted character with its
// output frame, so the main thread can commit only settled characters the
// way DeepFist's own live decoder does.
//
// Single-threaded onnxruntime-web for the same reason as the DeepCW worker:
// multi-threaded WASM needs cross-origin isolation, which would break Zeus's
// cross-origin iframe panels.

/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
// Same relative-path trick as the DeepCW worker: onnxruntime-web's `exports`
// map doesn't expose `./dist/*` to bare specifiers.
import ortMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import {
  MODEL_SR,
  audioToSpectrogram,
  condition,
  despike,
  detectTone,
  greedyFrames,
  keyingRatio,
  type FrameChar,
} from './frontend';

const MODEL_URL = '/deepfist/deepfist.onnx';
const METADATA_URL = '/deepfist/deepfist.onnx.json';

ort.env.wasm.numThreads = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ort.env.wasm as any).wasmPaths = { mjs: ortMjsUrl };

type Metadata = {
  input: { name: string };
  output: { name: string };
  preprocessing: {
    sample_rate: number;
    n_fft: number;
    hop_length: number;
    band_lo_hz: number;
    band_hi_hz: number;
    freq_bins: number;
  };
  ctc: { blank_index: number };
  tokens: string[];
};

export type DeepFistDecodeRequest = {
  type: 'decode';
  id: number;
  samples: Float32Array;
  squelchLoHz: number;
  squelchHiHz: number;
  /** Keying-ratio gate; windows scoring below it decode nothing. 0 = off. */
  squelchThreshold: number;
};
type WorkerRequest = DeepFistDecodeRequest | { type: 'load' };

export type DeepFistWorkerResponse =
  | { type: 'ready'; sampleRate: number; tokens: string[] }
  | {
      type: 'result';
      id: number;
      /** False when the keying squelch found no CW; chars is then empty. */
      active: boolean;
      /** Keying-ratio score of this window (for the operator readout). */
      score: number;
      /** Tone the conditioner locked to, Hz; null when gated. */
      toneHz: number | null;
      chars: FrameChar[];
      timeSteps: number;
    }
  | { type: 'error'; id: number | null; error: string };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let initPromise: Promise<{ session: ort.InferenceSession; meta: Metadata }> | null = null;

function ensureSession(): Promise<{ session: ort.InferenceSession; meta: Metadata }> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const wasmBytes = await (await fetch(ortWasmUrl)).arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ort.env.wasm as any).wasmBinary = wasmBytes;

    const metaRes = await fetch(METADATA_URL);
    if (!metaRes.ok) throw new Error(`model metadata: HTTP ${metaRes.status}`);
    const meta = (await metaRes.json()) as Metadata;
    if (meta.preprocessing.sample_rate !== MODEL_SR) {
      throw new Error(`unexpected model sample rate ${meta.preprocessing.sample_rate}`);
    }
    const session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
    });
    ctx.postMessage({
      type: 'ready',
      sampleRate: meta.preprocessing.sample_rate,
      tokens: meta.tokens,
    } satisfies DeepFistWorkerResponse);
    return { session, meta };
  })();
  // A failed load must not wedge every later attempt on the same rejection.
  initPromise.catch(() => {
    initPromise = null;
  });
  return initPromise;
}

async function handleDecode(req: DeepFistDecodeRequest): Promise<void> {
  const { session, meta } = await ensureSession();
  const pre = meta.preprocessing;
  const sr = pre.sample_rate;

  // Keying gate runs on RAW audio: conditioning would fabricate a tone.
  const score = keyingRatio(req.samples, sr, req.squelchLoHz, req.squelchHiHz);
  if (score < req.squelchThreshold) {
    ctx.postMessage({
      type: 'result',
      id: req.id,
      active: false,
      score,
      toneHz: null,
      chars: [],
      timeSteps: 0,
    } satisfies DeepFistWorkerResponse);
    return;
  }

  const clean = despike(req.samples, sr);
  const toneHz = detectTone(clean, sr);
  const cond = condition(clean, sr, toneHz);
  const spec = audioToSpectrogram(
    cond,
    sr,
    pre.n_fft,
    pre.hop_length,
    pre.band_lo_hz,
    pre.band_hi_hz,
  );
  if (spec.bins !== pre.freq_bins) {
    throw new Error(`metadata expects ${pre.freq_bins} bins, computed ${spec.bins}`);
  }
  const input = new ort.Tensor('float32', spec.data, [1, 1, spec.bins, spec.frames]);
  const outputs = await session.run({ [meta.input.name]: input });
  const logProbs = outputs[meta.output.name]!;
  const [timeSteps, batch, classes] = logProbs.dims as readonly number[];
  if (batch !== 1) throw new Error(`expected batch size 1, got ${batch}`);
  const chars = greedyFrames(
    logProbs.data as Float32Array,
    timeSteps!,
    classes!,
    meta.ctc.blank_index,
  );
  ctx.postMessage({
    type: 'result',
    id: req.id,
    active: true,
    score,
    toneHz,
    chars,
    timeSteps: timeSteps!,
  } satisfies DeepFistWorkerResponse);
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') {
    void ensureSession().catch((err) => {
      ctx.postMessage({
        type: 'error',
        id: null,
        error: err instanceof Error ? err.message : 'model load failed',
      } satisfies DeepFistWorkerResponse);
    });
    return;
  }
  if (message.type === 'decode') {
    void handleDecode(message).catch((err) => {
      ctx.postMessage({
        type: 'error',
        id: message.id,
        error: err instanceof Error ? err.message : 'decode failed',
      } satisfies DeepFistWorkerResponse);
    });
  }
};

export {};
