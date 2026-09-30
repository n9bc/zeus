// SPDX-License-Identifier: GPL-2.0-or-later
//
// Zeus — OpenHPSDR Protocol-1 / Protocol-2 client.
// Copyright (C) 2025-2026 Brian Keating (EI6LF),
//                         Douglas J. Cerrato (KB2UKA),
//                         Christian Suarez (N9WAR), and contributors.
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 2 of the License, or (at your
// option) any later version. See the LICENSE file at the root of this
// repository for the full text, or https://www.gnu.org/licenses/.
//
// Zeus is an independent reimplementation in .NET — not a fork. Its
// Protocol-1 / Protocol-2 framing, WDSP integration, meter pipelines, and
// TX behaviour were informed by studying the Thetis project
// (https://github.com/ramdor/Thetis), the authoritative reference
// implementation in the OpenHPSDR ecosystem. Zeus gratefully acknowledges
// the Thetis contributors whose work made this possible:
//
//   Richard Samphire (MW0LGE), Warren Pratt (NR0V),
//   Laurence Barker (G8NJJ),   Rick Koch (N1GP),
//   Bryan Rambo (W4WMT),       Chris Codella (W2PA),
//   Doug Wigley (W5WC),        FlexRadio Systems,
//   Richard Allen (W5SD),      Joe Torrey (WD5Y),
//   Andrew Mansfield (M0YGG),  Reid Campbell (MI0BOT),
//   Sigi Jetzlsperger (DH1KLM).
//
// Thetis itself continues the GPL-governed lineage of FlexRadio PowerSDR
// and the OpenHPSDR (TAPR/OpenHPSDR) ecosystem; that lineage is preserved
// here. See ATTRIBUTIONS.md at the repository root for the full provenance
// statement and per-component attribution.
//
// Protocol-2 / PureSignal / Saturn-class behaviour was additionally informed
// by pihpsdr (https://github.com/dl1ycf/pihpsdr), maintained by Christoph
// Wüllen (DL1YCF); and by DeskHPSDR
// (https://github.com/dl1bz/deskhpsdr), maintained by Heiko (DL1BZ).
// Both are GPL-2.0-or-later.
//
// WDSP — loaded by Zeus via P/Invoke — is Copyright (C) Warren Pratt
// (NR0V), distributed under GPL v2 or later.
//
// Zeus is distributed WITHOUT ANY WARRANTY; see the GNU General Public
// License for details.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  setNr,
  type NbMode,
  type NrConfigDto,
  type NrMode,
} from '../api/client';
import { NR_LABEL, nrCycleFor, nrModeTitle } from './nr-cycle';
import { DspModeMenu, type DspModeOption } from './DspModeMenu';
import { useConnectionStore } from '../state/connection-store';
import { useSmartNrStore } from '../state/smart-nr-store';
import { useAudioSuiteStore } from '../state/audio-suite-store';
import { Slider } from './design/Slider';
import { NrSettingsSection, type NrSettingsMode } from './nr/NrSettingsSection';
import { Nr3ModelPanel } from './nr/Nr3ModelPanel';

// Leveler max-gain moved to TxFilterPanel (alongside DRV/TUN/MIC) — it's
// a TX-only stage and lives with the other TX controls now.

// The NR menu lists the front-panel NR cycle. NR3 (RNNR / RNNoise) joins it only
// when libwdsp exports RNNR and an active model is available (bundled default or
// operator-installed). NR5 (NNR, WDSP 2.1.0 neural NR) joins at the end of the
// list only when libwdsp exports the NNR setters. Removed NR modes are not
// exposed. Cycle + labels live in nr-cycle.ts, shared with the NB-NR page.
// NOTE: this panel historically labelled Anr as 'NR'; the shared table calls
// it 'NR1', which matches the tooltip this file already used and the way
// operators refer to it.


function nrButtonTitle(mode: NrMode): string {
  switch (mode) {
    case 'Off': return 'Noise reduction off (right-click for tunables)';
    case 'Anr': return 'NR1 (ANR, time-domain LMS) — right-click for tunables';
    case 'Emnr': return 'NR2 (EMNR, spectral) — right-click for tunables';
    case 'Sbnr': return 'NR4 (SBNR, libspecbleach) — right-click for tunables';
    case 'Rnnr': return 'NR3 (RNNoise, neural)';
    case 'Nnr': return 'NR5 (NNR, WDSP neural, +51 ms) — right-click for tunables';
  }
}

// NR1 / NR2 / NR4 / NR5 each have a tunables panel. NR4 panel was suppressed
// pre-#162 (libwdsp didn't export SetRXASBNR*); now that Phase 1 binaries
// ship the symbols on linux-x64 + win-x64, the panel is reachable again.
// Mirrors NrControls.tsx.
function settingsModeFor(nrMode: NrMode): NrSettingsMode {
  if (nrMode === 'Anr' || nrMode === 'Emnr' || nrMode === 'Sbnr' || nrMode === 'Nnr') return nrMode;
  return 'Emnr';
}

function hasNrSettings(nrMode: NrMode): boolean {
  return nrMode === 'Anr' || nrMode === 'Emnr' || nrMode === 'Sbnr' || nrMode === 'Nnr';
}

const NB_LABEL: Record<NbMode, string> = {
  Off: 'NB',
  Nb1: 'NB1',
  Nb2: 'NB2',
};

function nbModeTitle(mode: NbMode): string {
  switch (mode) {
    case 'Off': return 'Noise blanker off';
    case 'Nb1': return 'NB1 (time-domain blanker, xanbEXT)';
    case 'Nb2': return 'NB2 (time-domain blanker, xnobEXT)';
  }
}

const NB_OPTIONS: readonly DspModeOption<NbMode>[] = (['Off', 'Nb1', 'Nb2'] as const).map(
  (key) => ({ key, label: key === 'Off' ? 'Off' : NB_LABEL[key], title: nbModeTitle(key) }),
);

export function DspPanel() {
  const nr = useConnectionStore((s) => s.nr);
  const setLocalNr = useConnectionStore((s) => s.setNr);
  const applyState = useConnectionStore((s) => s.applyState);
  const connected = useConnectionStore((s) => s.status === 'Connected');
  const smartNrMode = useSmartNrStore((s) => s.automationMode);
  const smartNrStatus = useSmartNrStore((s) => s.status);
  const setSmartNrMode = useSmartNrStore((s) => s.setAutomationMode);
  const setSmartNrStatus = useSmartNrStore((s) => s.setStatus);
  const openRxSuite = useAudioSuiteStore((s) => s.openRx);

  const inflightAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      inflightAbort.current?.abort();
    },
    [],
  );

  const send = useCallback(
    (next: NrConfigDto) => {
      setLocalNr(next);
      inflightAbort.current?.abort();
      const ac = new AbortController();
      inflightAbort.current = ac;
      setNr(next, ac.signal)
        .then((s) => {
          if (!ac.signal.aborted) applyState(s);
        })
        .catch(() => {
          /* next state poll will reconcile */
        });
    },
    [setLocalNr, applyState],
  );

  const nr3Available = useConnectionStore((s) => s.wdspNr3RnnrAvailable);
  const nr3ModelName = useConnectionStore((s) => s.nr3ModelName);
  const nr3Ready = nr3Available && !!nr3ModelName;
  const nnrAvailable = useConnectionStore((s) => s.wdspNnrAvailable);

  const nrOptions = useMemo<readonly DspModeOption<NrMode>[]>(
    () =>
      nrCycleFor(nr3Ready, nnrAvailable).map((key) => ({
        key,
        label: key === 'Off' ? 'Off' : NR_LABEL[key],
        title: nrModeTitle(key),
      })),
    [nr3Ready, nnrAvailable],
  );

  const selectNr = useCallback(
    (nrMode: NrMode) => {
      if (!connected) return;
      send({ ...nr, nrMode });
    },
    [nr, send, connected],
  );

  const selectNb = useCallback(
    (nbMode: NbMode) => send({ ...nr, nbMode }),
    [nr, send],
  );

  const setNbThreshold = useCallback(
    (v: number) => send({ ...nr, nbThreshold: v }),
    [nr, send],
  );

  const toggleAnf = useCallback(
    () => send({ ...nr, anfEnabled: !nr.anfEnabled }),
    [nr, send],
  );
  const toggleSnb = useCallback(
    () => send({ ...nr, snbEnabled: !nr.snbEnabled }),
    [nr, send],
  );
  const toggleNbp = useCallback(
    () => send({ ...nr, nbpNotchesEnabled: !nr.nbpNotchesEnabled }),
    [nr, send],
  );
  const applySmartNr = useCallback(() => {
    if (!connected) return;
    if (smartNrMode !== 'manual') {
      setSmartNrMode('manual');
      return;
    }

    setSmartNrMode('auto');
    setSmartNrStatus(null);
  }, [connected, smartNrMode, setSmartNrMode, setSmartNrStatus]);

  const applySuggestedSmartNr = useCallback(() => {
    if (!connected || !smartNrStatus?.nr) return;
    send(smartNrStatus.nr);
    setSmartNrStatus({
      ...smartNrStatus,
      atUtc: new Date().toISOString(),
      pending: false,
      applied: true,
    });
  }, [connected, smartNrStatus, send, setSmartNrStatus]);

  const nrActive = nr.nrMode !== 'Off';
  const nbActive = nr.nbMode !== 'Off';
  const smartNrTitle = smartNrStatus
    ? [
        smartNrStatus.reason,
        smartNrStatus.capabilityLimited && smartNrStatus.capabilityRecommendation
          ? smartNrStatus.capabilityRecommendation
          : null,
        smartNrStatus.rxChainLabel && smartNrStatus.rxChainRecommendation
          ? `${smartNrStatus.rxChainLabel}: ${smartNrStatus.rxChainRecommendation}`
          : null,
      ].filter(Boolean).join(' · ')
    : 'Smart NR automation is waiting for spectrum data';

  return (
    <div className="dsp-grid">
      <div className="dsp-row">
        <DspModeMenu
          menuLabel="Noise blanker mode"
          value={nr.nbMode}
          options={NB_OPTIONS}
          onSelect={selectNb}
          buttonLabel={NB_LABEL[nr.nbMode]}
          title={nbModeTitle(nr.nbMode)}
          active={nbActive}
          disabled={!connected}
        />
        <Slider
          label="Thresh"
          value={nr.nbThreshold}
          onChange={setNbThreshold}
          disabled={!connected || !nbActive}
        />
      </div>
      <div className="dsp-row">
        <button
          type="button"
          disabled={!connected}
          onClick={applySmartNr}
          aria-pressed={smartNrMode !== 'manual'}
          className={`btn sm ${smartNrMode !== 'manual' ? 'active' : ''}`}
          title={
            smartNrMode === 'manual'
              ? 'SMART - arm automatic panadapter-driven NR after a stable dwell'
              : 'SMART active - click to return NR automation to manual'
          }
        >
          SMART
        </button>
        <DspModeMenu
          menuLabel="Noise reduction mode"
          value={nr.nrMode}
          options={nrOptions}
          onSelect={selectNr}
          buttonLabel={NR_LABEL[nr.nrMode]}
          title={nrButtonTitle(nr.nrMode)}
          active={nrActive}
          disabled={!connected}
          focusableWhenDisabled
        />
        <button
          type="button"
          onClick={openRxSuite}
          className="btn sm"
          title="Pop out the RX Audio Suite window for receive VST inserts"
        >
          RX Suite
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={toggleAnf}
          className={`btn sm ${nr.anfEnabled ? 'active' : ''}`}
          title="ANF — adaptive auto-notch (time domain)"
        >
          ANF
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={toggleSnb}
          className={`btn sm ${nr.snbEnabled ? 'active' : ''}`}
          title="SNB — spectral noise blanker"
        >
          SNB
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={toggleNbp}
          className={`btn sm ${nr.nbpNotchesEnabled ? 'active' : ''}`}
          title="NBP — notch-filter auto-notch (RXA)"
        >
          NBP
        </button>
      </div>
      {smartNrMode !== 'manual' && (
        <div className="dsp-smart-status" title={smartNrTitle}>
          <span className="mono">{smartNrMode.toUpperCase()}</span>
          <span>{smartNrStatus?.profile ?? 'WAIT'}</span>
          {smartNrMode === 'suggest' && smartNrStatus?.nr && !smartNrStatus.pending && !smartNrStatus.applied ? (
            <button
              type="button"
              className="btn sm dsp-smart-apply"
              onClick={applySuggestedSmartNr}
              disabled={!connected}
              title="Apply the suggested Smart NR profile"
            >
              APPLY
            </button>
          ) : smartNrStatus && (
            <span className="mono">
              {smartNrStatus.heldByRxChain
                ? 'RX HOLD'
                : smartNrStatus.capabilityLimited
                  ? 'DSP CAP'
                  : smartNrStatus.pending
                    ? 'DWELL'
                    : smartNrStatus.applied
                      ? 'APPLIED'
                      : 'READY'}
            </span>
          )}
        </div>
      )}
      {hasNrSettings(nr.nrMode) && (
        <NrSettingsSection mode={settingsModeFor(nr.nrMode)} />
      )}
      {/* NR3 (RNNoise) model install lives in the DSP menu so the operator can
          install a model even while NR3 is hidden from the cycle. */}
      <Nr3ModelPanel />
    </div>
  );
}
