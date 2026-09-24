// SPDX-License-Identifier: GPL-3.0-or-later
//
// Main-thread handle to the DeepFist ONNX worker — same shape as the DeepCW
// decoder-client: one shared worker, request/response correlation by id,
// readiness and error listeners.

import type { FrameChar } from './frontend';
import type { DeepFistWorkerResponse } from './deepfist-worker';

export type DeepFistResult = {
  active: boolean;
  score: number;
  toneHz: number | null;
  chars: FrameChar[];
  timeSteps: number;
};
export type DeepFistReadyListener = (sampleRate: number, tokens: string[]) => void;
export type DeepFistErrorListener = (message: string) => void;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: DeepFistResult) => void; reject: (e: Error) => void }
>();
const readyListeners = new Set<DeepFistReadyListener>();
const errorListeners = new Set<DeepFistErrorListener>();
// The worker posts 'ready' once per session, so remember it for listeners
// that subscribe after the model is already loaded.
let ready: { sampleRate: number; tokens: string[] } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./deepfist-worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<DeepFistWorkerResponse>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      ready = { sampleRate: msg.sampleRate, tokens: msg.tokens };
      for (const fn of readyListeners) fn(msg.sampleRate, msg.tokens);
      return;
    }
    if (msg.type === 'error') {
      if (msg.id != null) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.reject(new Error(msg.error));
        }
      }
      for (const fn of errorListeners) fn(msg.error);
      return;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.resolve({
        active: msg.active,
        score: msg.score,
        toneHz: msg.toneHz,
        chars: msg.chars,
        timeSteps: msg.timeSteps,
      });
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    const message = e.message || 'DeepFist worker crashed';
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
    for (const fn of errorListeners) fn(message);
  };
  return worker;
}

/** Kick off model + runtime load so the first decode isn't cold. */
export function loadDeepFist(): void {
  getWorker().postMessage({ type: 'load' });
}

export function onDeepFistReady(fn: DeepFistReadyListener): () => void {
  readyListeners.add(fn);
  if (ready) fn(ready.sampleRate, ready.tokens);
  return () => readyListeners.delete(fn);
}

export function onDeepFistError(fn: DeepFistErrorListener): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

/**
 * Decode one window of 3200 Hz mono samples. `squelchLoHz`/`squelchHiHz` is
 * the CW band the keying gate searches; `squelchThreshold` 0 disables the
 * gate. The buffer is copied before transfer.
 */
export function decodeDeepFist(
  samples: Float32Array,
  squelchLoHz: number,
  squelchHiHz: number,
  squelchThreshold: number,
): Promise<DeepFistResult> {
  const w = getWorker();
  const id = nextId++;
  const copy = samples.slice();
  return new Promise<DeepFistResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'decode', id, samples: copy, squelchLoHz, squelchHiHz, squelchThreshold }, [
      copy.buffer,
    ]);
  });
}
