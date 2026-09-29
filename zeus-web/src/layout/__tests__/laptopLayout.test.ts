// SPDX-License-Identifier: GPL-2.0-or-later

/** @vitest-environment jsdom */

import '../../components/meters/__tests__/harness'; // localStorage polyfill side-effect
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_LAYOUTS,
  findBuiltInLayout,
  LAPTOP_DSP_MIN_COLS,
  LAPTOP_LAYOUT_TEMPLATE,
  LAPTOP_VFO_MIN_COLS,
} from '../defaultLayout';
import { getPanelDef } from '../panels';
import { parseWorkspaceLayout, WORKSPACE_GRID_COLS, type WorkspaceTile } from '../workspace';

// ~708 px of workspace in a 14" MacBook Pro browser tab at the 18 px row pitch.
const LAPTOP_ROWS = 39;

const geometry = (tiles: readonly WorkspaceTile[]) =>
  tiles.map(({ uid, panelId, x, y, w, h }) => ({ uid, panelId, x, y, w, h }));

function overlaps(tiles: readonly WorkspaceTile[]): string[] {
  const hits: string[] = [];
  for (const [i, a] of tiles.entries()) {
    for (const b of tiles.slice(i + 1)) {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hits.push(`${a.uid} × ${b.uid}`);
      }
    }
  }
  return hits;
}

describe('LAPTOP_LAYOUT_TEMPLATE', () => {
  const tiles = LAPTOP_LAYOUT_TEMPLATE.workspace.tiles;
  const tileFor = (panelId: string) => tiles.find((t) => t.panelId === panelId);

  it('fits the laptop grid without scrolling', () => {
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(WORKSPACE_GRID_COLS);
      expect(t.y + t.h).toBeLessThanOrEqual(LAPTOP_ROWS);
    }
  });

  it('has no overlapping tiles', () => {
    expect(overlaps(tiles)).toEqual([]);
  });

  it('uses unique uids and registered panels at or above their minimum size', () => {
    expect(new Set(tiles.map((t) => t.uid)).size).toBe(tiles.length);
    for (const t of tiles) {
      const def = getPanelDef(t.panelId);
      expect(def, t.panelId).toBeDefined();
      expect(t.w, `${t.panelId} w`).toBeGreaterThanOrEqual(def?.minW ?? 1);
      expect(t.h, `${t.panelId} h`).toBeGreaterThanOrEqual(def?.minH ?? 1);
      if (def?.maxW !== undefined) expect(t.w).toBeLessThanOrEqual(def.maxW);
      if (def?.maxH !== undefined) expect(t.h).toBeLessThanOrEqual(def.maxH);
    }
  });

  // Measured at 1512×860: 4 VFO columns clip a digit off each end of the
  // readout, and the DSP button row needs 7 columns.
  it('keeps VFO and DSP wide enough to render without clipping', () => {
    expect(tileFor('vfo')?.w).toBeGreaterThanOrEqual(LAPTOP_VFO_MIN_COLS);
    expect(tileFor('dsp')?.w).toBeGreaterThanOrEqual(LAPTOP_DSP_MIN_COLS);
  });

  it('survives the serialize + parse round trip addLayout performs', () => {
    const parsed = parseWorkspaceLayout(
      JSON.parse(JSON.stringify(LAPTOP_LAYOUT_TEMPLATE.workspace)),
    );
    expect(geometry(parsed.tiles)).toEqual(geometry(tiles));
    expect(overlaps(parsed.tiles)).toEqual([]);
  });

  it('is the built-in the Start-from picker resolves', () => {
    expect(BUILT_IN_LAYOUTS).toContain(LAPTOP_LAYOUT_TEMPLATE);
    expect(findBuiltInLayout(LAPTOP_LAYOUT_TEMPLATE.id)).toBe(LAPTOP_LAYOUT_TEMPLATE);
    expect(findBuiltInLayout('')).toBeUndefined();
  });
});
