// SPDX-License-Identifier: GPL-2.0-or-later
//
// Zeus — OpenHPSDR Protocol-1 / Protocol-2 client.
// Copyright (C) 2025-2026 Brian Keating (EI6LF), Christian Suarez (N9WAR), and contributors.
//
// Default workspace layout for the react-grid-layout (RGL) substrate. 12-col
// grid. The right column starts as a stack of 6-wide tiles (vfo/smeter/tx/
// txmeters/dsp). These are no longer width-capped — every panel is freely
// resizable to grid extents now (the panadapter-style "any size" model) — so
// the 6-wide seeds here are just a sane starting arrangement, not a ceiling;
// the operator can widen any of them. The left column is BANDWIDTH FILTER on
// top and the panadapter hero filling the remaining vertical space.
// FlexWorkspace uses a constant row height: a layout taller than the window
// scrolls rather than shrinking, and a taller window does not stretch panels.
//
// Coordinates are in the 24-column × 48-row (schema-v8) grid. Total height =
// WORKSPACE_TARGET_ROWS (48). The top-left row pairs the Bandwidth Filter
// (mini-pan only) with the split-out Filter Presets panel; the
// panadapter hero fills most of the left column with a Chat strip docked
// beneath it, and the right column stacks vfo / smeter / tx / txmeters / dsp.
//
// ASCII sanity check (columns 0..23):
//
//   ┌──────────────────────────────┬───────────────┬─────────────┐  y=0
//   │   filter · mini-pan (0..11)   │ presets(12..17)│    vfo      │
//   │            h=10               │     h=10       │   (h=11)    │
//   ├──────────────────────────────┴───────────────┤             │  y=10
//   │                                               ├─────────────┤  y=11
//   │                                               │   smeter    │
//   │                                               │   (h=5)     │  y=16
//   │            hero (0..17, h=30)                 ├─────────────┤
//   │                                               │     tx      │
//   │                                               │   (h=10)    │
//   │                                               ├─────────────┤  y=26
//   │                                               │  txmeters   │
//   ├───────────────────────────────────────────────┤   (h=12)    │
//   │            chat (0..17, h=8)                  ├─────────────┤  y=38
//   │                                               │     dsp     │
//   └───────────────────────────────────────────────┴─────────────┘  y=48

import type { WorkspaceLayout } from './workspace';

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  schemaVersion: 8,
  tiles: [
    // Stable uids (not random) for the default layout — lets a future
    // migration map "the old default 'vfo' tile" to a new layout without
    // losing operator overrides.
    { uid: 'tile-filter',        panelId: 'filter',        x: 0,  y: 0,  w: 12, h: 10 },
    { uid: 'tile-filterpresets', panelId: 'filterpresets', x: 12, y: 0,  w: 6,  h: 10 },
    { uid: 'tile-hero',          panelId: 'hero',          x: 0,  y: 10, w: 18, h: 30 },
    { uid: 'tile-chat',          panelId: 'chat',          x: 0,  y: 40, w: 18, h: 8  },
    { uid: 'tile-vfo',           panelId: 'vfo',           x: 18, y: 0,  w: 6,  h: 11 },
    { uid: 'tile-smeter',        panelId: 'smeter',        x: 18, y: 11, w: 6,  h: 5 },
    { uid: 'tile-tx',            panelId: 'tx',            x: 18, y: 16, w: 6,  h: 10 },
    { uid: 'tile-txmeters',      panelId: 'txmeters',      x: 18, y: 26, w: 6,  h: 12 },
    { uid: 'tile-dsp',           panelId: 'dsp',           x: 18, y: 38, w: 6,  h: 10 },
  ],
};

// Built-in "Laptop" starting point, offered in the new-layout "Start from"
// picker. Sized for a 14" MacBook Pro browser tab (~1512×860 CSS px), which
// leaves ~708 px of workspace: 39 rows at the 18 px row pitch (15 px + 3 px
// margin) fit, versus the Default layout's 48. Chat, Filter Presets and Mode
// are left out: Mode only reads as a very wide strip, and the top bar's
// MODE / FILTER favourites and "…" menus already cover them.
//
// Width floors, measured at the 14" column pitch (~57 px + 3 px margin):
//   • vfo 7 cols — the click-to-edit row needs ~296 px for the 220 px input +
//     kHz + GO; narrower tiles squeeze the input until the typed frequency is
//     unreadable. (The readout alone is narrower; 4 cols clipped a digit off
//     each end back when it showed 1 Hz.)
//   • dsp 7 cols — the SMART…NBP button row needs ~395 px (397 px available).
//
// The filter mini-pan gets 12 rows so its audio passband spectrum reads
// clearly; the panadapter/waterfall takes the remaining 27.
//
//   ┌──────────────────────────┬───────────┬───────────────────┐  y=0
//   │ filter · mini-pan (0..11)│  smeter   │        vfo        │
//   │                          ├───────────┤     (17..23)      │  y=7
//   │                          │    tx     │                   │
//   ├──────────────────────────┤ (12..16)  │                   │  y=12
//   │                          │           ├───────────────────┤  y=16
//   │       hero (0..11)       ├───────────┤                   │  y=18
//   │                          │ txmeters  │        dsp        │
//   │                          │           │                   │
//   └──────────────────────────┴───────────┴───────────────────┘  y=39
export const LAPTOP_VFO_MIN_COLS = 7;
export const LAPTOP_DSP_MIN_COLS = 7;

export interface BuiltInLayout {
  id: string;
  name: string;
  icon?: string;
  description: string;
  workspace: WorkspaceLayout;
}

export const LAPTOP_LAYOUT_TEMPLATE: BuiltInLayout = {
  id: 'builtin:laptop',
  name: 'Laptop',
  description: 'Fits a 14" laptop browser window without scrolling',
  workspace: {
    schemaVersion: 8,
    tiles: [
      { uid: 'tile-filter',   panelId: 'filter',   x: 0,  y: 0,  w: 12, h: 12 },
      { uid: 'tile-hero',     panelId: 'hero',     x: 0,  y: 12, w: 12, h: 27 },
      { uid: 'tile-smeter',   panelId: 'smeter',   x: 12, y: 0,  w: 5,  h: 7  },
      { uid: 'tile-tx',       panelId: 'tx',       x: 12, y: 7,  w: 5,  h: 11 },
      { uid: 'tile-txmeters', panelId: 'txmeters', x: 12, y: 18, w: 5,  h: 21 },
      { uid: 'tile-vfo',      panelId: 'vfo',      x: 17, y: 0,  w: 7,  h: 16 },
      { uid: 'tile-dsp',      panelId: 'dsp',      x: 17, y: 16, w: 7,  h: 23 },
    ],
  },
};

/** Built-in arrangements offered under "Start from" in the new-layout dialog. */
export const BUILT_IN_LAYOUTS: readonly BuiltInLayout[] = [LAPTOP_LAYOUT_TEMPLATE];

/** The built-in "Start from" arrangement with this picker id, if any. */
export function findBuiltInLayout(id: string): BuiltInLayout | undefined {
  return BUILT_IN_LAYOUTS.find((l) => l.id === id);
}
