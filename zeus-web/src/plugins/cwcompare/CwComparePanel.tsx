// SPDX-License-Identifier: GPL-2.0-or-later
//
// CW Decoder · Compare — DeepCW and DeepFist side by side on the same RX
// audio. The DeepCW column runs the CW decode window's own worker, so it
// reads what that window reads. Layout, top→bottom: shared status +
// controls, the live CW-band spectrogram, then one transcript column per
// engine. Reuses the DeepCW panel's telegraph-console styling.

import { useEffect, useRef } from 'react';
import { TileChrome } from '../../layout/TileChrome';
import type { PanelComponentProps } from '../../layout/panels';
import { CwSpectrogram } from '../deepcw/CwSpectrogram';
import { CaptureControls } from './CaptureControls';
import {
  SQUELCH_OPTIONS,
  useCwCompareStore,
  type CwCompareState,
  type DeepFistReadout,
  type CwEngine,
  type EngineLane,
} from './cw-compare-store';
import { useCwCompare } from './use-cw-compare';

const STATE_LABEL: Record<CwCompareState, string> = {
  idle: 'OFF',
  listening: 'LISTENING',
  held: 'HELD',
};

const ENGINE_LABEL: Record<CwEngine, string> = {
  deepcw: 'DeepCW',
  deepfist: 'DeepFist',
};

/** "SQL 8.3 open · 612 Hz" — why DeepFist is or isn't printing. */
function readoutText(r: DeepFistReadout, threshold: number): string {
  const gate = threshold === 0 ? 'off' : r.open ? 'open' : 'shut';
  const tone = r.toneHz === null ? '' : ` · ${Math.round(r.toneHz)} Hz`;
  return `SQL ${r.score.toFixed(1)} ${gate}${tone}`;
}

function Lane({
  engine,
  lane,
  active,
  detail,
}: {
  engine: CwEngine;
  lane: EngineLane;
  active: boolean;
  detail?: string;
}) {
  const tapeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lane.text]);

  return (
    <section className="cwcompare-lane" aria-label={`${ENGINE_LABEL[engine]} transcript`}>
      <header className="cwcompare-lane-head">
        {ENGINE_LABEL[engine]}
        {detail && <span className="cwcompare-lane-detail">{detail}</span>}
      </header>
      <div
        ref={tapeRef}
        className="cw-decoded-window deepcw-tape cwcompare-tape mono"
        role="log"
        aria-live="polite"
      >
        {lane.loadError ? (
          <span className="cw-stream-placeholder">model failed to load: {lane.loadError}</span>
        ) : active ? (
          lane.text ? (
            <>
              {lane.text}
              <span className="deepcw-cursor" aria-hidden="true">
                ▋
              </span>
            </>
          ) : (
            <span className="cw-stream-placeholder">
              {lane.modelLoaded ? '… waiting for signal …' : '… loading neural model …'}
            </span>
          )
        ) : (
          <span className="cw-stream-placeholder">—— DECODER OFF ——</span>
        )}
      </div>
    </section>
  );
}

export function CwComparePanel({
  onRemove,
  tileLocked,
  workspaceLocked,
  onToggleLock,
}: PanelComponentProps) {
  const {
    state,
    lanes,
    isDecoding,
    squelchThreshold,
    readout,
    setEnabled,
    toggleHold,
    clear,
    setSquelchThreshold,
  } = useCwCompareStore();

  // Owns the shared audio tap + both decode loops while enabled.
  useCwCompare();

  const isEnabled = state !== 'idle';
  const isHeld = state === 'held';
  const isIdle = state === 'idle';
  const active = isEnabled;
  const handleRemove = onRemove ?? (() => {});
  const anyError = lanes.deepcw.loadError ?? lanes.deepfist.loadError;
  const allLoaded = lanes.deepcw.modelLoaded && lanes.deepfist.modelLoaded;
  const hasText = lanes.deepcw.text !== '' || lanes.deepfist.text !== '';

  const statusText = anyError
    ? 'MODEL ERROR'
    : active && !allLoaded
      ? 'LOADING MODELS'
      : isDecoding
        ? 'DECODING'
        : STATE_LABEL[state];

  return (
    <>
      <TileChrome
        title="CW Decoder · Compare"
        onRemove={handleRemove}
        locked={tileLocked}
        workspaceLocked={workspaceLocked}
        onToggleLock={onToggleLock}
        rightSlot={
          <button
            type="button"
            className={`btn ${isEnabled ? 'accent' : ''}`}
            onClick={() => setEnabled(!isEnabled)}
            aria-label={isEnabled ? 'Disable decoders' : 'Enable decoders'}
          >
            {isEnabled ? 'ON' : 'OFF'}
          </button>
        }
      />
      <div className="workspace-tile-body">
        <div className="cw cw-console deepcw cwcompare">
          <div
            className={`cw-stream-hero cw-stream-hero--header ${active ? 'is-active' : 'is-idle'}`}
            data-state={isHeld ? 'held' : 'listening'}
          >
            <div className="cw-stream-tag">
              <span
                className={`cw-stream-led ${isDecoding ? 'deepcw-led--busy' : ''}`}
                aria-hidden="true"
              />
              <span className="cw-stream-label">{statusText}</span>
            </div>

            <div className="cw-control-strip cw-control-strip--inline">
              <div className="deepcw-win" role="group" aria-label="DeepFist squelch">
                {SQUELCH_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`deepcw-win-chip ${squelchThreshold === t ? 'is-active' : ''}`}
                    onClick={() => setSquelchThreshold(t)}
                    title={
                      t === 0
                        ? 'DeepFist squelch off: decode every window'
                        : `DeepFist decodes only windows whose keying score is at least ${t}`
                    }
                    aria-pressed={squelchThreshold === t}
                  >
                    {t === 0 ? 'SQL OFF' : `SQL ${t}`}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`cw-hold ${isHeld ? 'is-armed' : ''}`}
                onClick={toggleHold}
                disabled={isIdle}
                title="Hold decoders (freeze both transcripts)"
                aria-label="HOLD"
              >
                HOLD
              </button>

              <button
                type="button"
                className="cw-clear"
                onClick={clear}
                disabled={!hasText && isIdle}
                title="Clear both transcripts"
                aria-label="CLEAR"
              >
                CLEAR
              </button>
            </div>
          </div>

          <CaptureControls active={active} />

          <CwSpectrogram active={active} />

          <div className="cwcompare-lanes">
            <Lane engine="deepcw" lane={lanes.deepcw} active={active} />
            <Lane
              engine="deepfist"
              lane={lanes.deepfist}
              active={active}
              detail={active && readout ? readoutText(readout, squelchThreshold) : undefined}
            />
          </div>
        </div>
      </div>
    </>
  );
}
