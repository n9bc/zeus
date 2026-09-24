// SPDX-License-Identifier: GPL-2.0-or-later
//
// Capture controls for the CW compare panel: collect RX audio for DeepFist
// training through the station Recorder (the same one REC drives), so files
// land in the recordings dir server-side in both desktop and web modes.
//
//   CAPTURE  — start/stop an RX recording (mirrors REC's live state).
//   SAVE 60s — dump the last 60 s from the always-on replay ring, for the
//              moment the two decoders disagree.
//
// Labelling happens offline: DeepFist's tools/teacher_label.py runs the
// DeepCW teacher over each WAV and aligns labels to the audio exactly.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchRecorderStatus,
  saveReplay,
  startRecorder,
  stopRecorder,
  type RecorderStatusDto,
} from '../../api/client';

const REPLAY_SECONDS = 60;

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CaptureControls({ active }: { active: boolean }) {
  const [status, setStatus] = useState<RecorderStatusDto | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchRecorderStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  // Track the recorder while the panel runs (REC may start/stop it too).
  useEffect(() => {
    if (!active) return;
    refresh();
    const id = window.setInterval(refresh, 1000);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  const recording = status?.recording ?? false;
  // Another source (TX mic / on-air) owns the recorder: don't hijack it.
  const busyElsewhere = recording && status?.source !== 'rx';

  const toggle = () => {
    const req = recording ? stopRecorder() : startRecorder('rx');
    void req
      .then((r) => {
        setStatus(r.status);
        setNote(recording && status?.fileName ? `saved ${status.fileName}` : null);
      })
      .catch((err) => setNote(`capture failed: ${String(err)}`));
  };

  const saveLast = () => {
    void saveReplay(REPLAY_SECONDS)
      .then((r) => setNote(r.ok && r.name ? `saved ${r.name}` : 'nothing to save yet'))
      .catch((err) => setNote(`save failed: ${String(err)}`));
  };

  return (
    <div className="cwcompare-capture">
      <button
        type="button"
        className={`cw-hold ${recording && !busyElsewhere ? 'is-armed' : ''}`}
        onClick={toggle}
        disabled={!active || busyElsewhere}
        title={
          busyElsewhere
            ? `Recorder is busy recording ${status?.source}`
            : recording
              ? 'Stop the RX capture'
              : 'Record RX audio for DeepFist training'
        }
        aria-label={recording ? 'Stop capture' : 'Start capture'}
      >
        {recording && !busyElsewhere ? `● ${fmtElapsed(status?.elapsedSec ?? 0)}` : 'CAPTURE'}
      </button>
      <button
        type="button"
        className="cw-clear"
        onClick={saveLast}
        disabled={!active}
        title={`Save the last ${REPLAY_SECONDS} seconds of RX audio`}
        aria-label={`Save last ${REPLAY_SECONDS} seconds`}
      >
        SAVE {REPLAY_SECONDS}s
      </button>
      {note && (
        <span className="cwcompare-capture-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
