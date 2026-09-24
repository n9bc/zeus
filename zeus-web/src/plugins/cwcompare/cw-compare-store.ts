// SPDX-License-Identifier: GPL-2.0-or-later
//
// UI state for the CW decoder comparison panel: shared controls, two
// independent transcripts (DeepCW and DeepFist).

import { create } from 'zustand';

export type CwCompareState = 'idle' | 'listening' | 'held';
export type CwEngine = 'deepcw' | 'deepfist';

export type EngineLane = {
  /** Continuous transcript for this engine, capped to maxChars. */
  text: string;
  modelLoaded: boolean;
  loadError: string | null;
};

/** Live DeepFist gate readout for the latest decoded window. */
export type DeepFistReadout = {
  /** Keying-ratio score (dead air ~4, keyed CW tens). */
  score: number;
  /** Whether the squelch let this window through. */
  open: boolean;
  /** Tone the conditioner locked to, Hz (null while gated). */
  toneHz: number | null;
};

export type CwCompareStore = {
  state: CwCompareState;
  maxChars: number;
  isDecoding: boolean;
  lanes: Record<CwEngine, EngineLane>;
  /** DeepFist keying-squelch threshold; 0 = off. */
  squelchThreshold: number;
  readout: DeepFistReadout | null;

  setEnabled: (enabled: boolean) => void;
  toggleHold: () => void;
  clear: () => void;
  /** Append text to one engine's transcript (no-op while held). */
  appendDecoded: (engine: CwEngine, chunk: string) => void;
  setModelLoaded: (engine: CwEngine, loaded: boolean) => void;
  setLoadError: (engine: CwEngine, err: string | null) => void;
  setDecoding: (decoding: boolean) => void;
  setSquelchThreshold: (threshold: number) => void;
  setReadout: (readout: DeepFistReadout | null) => void;
};

/** Squelch choices: off, the Zeus default, and DeepFist's reference 12. */
export const SQUELCH_OPTIONS = [0, 6, 12] as const;

const emptyLane: EngineLane = { text: '', modelLoaded: false, loadError: null };

function patchLane(
  lanes: Record<CwEngine, EngineLane>,
  engine: CwEngine,
  patch: Partial<EngineLane>,
): Record<CwEngine, EngineLane> {
  return { ...lanes, [engine]: { ...lanes[engine], ...patch } };
}

export const useCwCompareStore = create<CwCompareStore>((set) => ({
  state: 'idle',
  maxChars: 4000,
  isDecoding: false,
  lanes: { deepcw: emptyLane, deepfist: emptyLane },
  // Half the reference gate: Zeus's AGC lifts the gaps, which pulls a weak
  // signal's score under 12, while dead air stays near 4.
  squelchThreshold: 6,
  readout: null,

  setEnabled: (enabled) =>
    set((s) => ({
      state: s.state === 'held' && enabled ? 'held' : enabled ? 'listening' : 'idle',
    })),

  toggleHold: () =>
    set((s) => ({
      state: s.state === 'listening' ? 'held' : s.state === 'held' ? 'listening' : s.state,
    })),

  clear: () =>
    set((s) => ({
      lanes: {
        deepcw: { ...s.lanes.deepcw, text: '' },
        deepfist: { ...s.lanes.deepfist, text: '' },
      },
    })),

  appendDecoded: (engine, chunk) =>
    set((s) =>
      s.state === 'held' || chunk === ''
        ? {}
        : {
            lanes: patchLane(s.lanes, engine, {
              text: (s.lanes[engine].text + chunk).slice(-s.maxChars),
            }),
          },
    ),

  setModelLoaded: (engine, loaded) =>
    set((s) => ({ lanes: patchLane(s.lanes, engine, { modelLoaded: loaded }) })),
  setLoadError: (engine, err) =>
    set((s) => ({ lanes: patchLane(s.lanes, engine, { loadError: err }) })),
  setDecoding: (decoding) => set({ isDecoding: decoding }),
  setSquelchThreshold: (threshold) => set({ squelchThreshold: threshold }),
  setReadout: (readout) => set({ readout }),
}));
