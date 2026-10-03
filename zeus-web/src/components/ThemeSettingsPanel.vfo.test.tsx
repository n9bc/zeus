// SPDX-License-Identifier: GPL-2.0-or-later

/** @vitest-environment jsdom */

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from './meters/__tests__/harness';
import { ThemeSettingsPanel } from './ThemeSettingsPanel';
import { useThemeStore } from '../state/theme-store';

vi.mock('../api/themeSettings', () => ({
  fetchThemeSettings: vi.fn(() => new Promise(() => {})),
  updateThemeSettings: vi.fn(() => Promise.resolve()),
}));

function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ThemeSettingsPanel VFO colours', () => {
  afterEach(() => {
    act(() => useThemeStore.getState().resetOverrides());
  });

  it('lists the VFO digits, separators and glow in their own section', () => {
    const { container, unmount } = render(createElement(ThemeSettingsPanel));
    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toContain('VFO readout');
    for (const label of ['VFO digits', 'VFO separators', 'VFO glow']) {
      expect(container.querySelector(`input[aria-label="${label} hex value"]`)).not.toBeNull();
    }
    unmount();
  });

  it('stores a typed VFO digit colour as an override', () => {
    const { container, unmount } = render(createElement(ThemeSettingsPanel));
    const hex = container.querySelector('input[aria-label="VFO digits hex value"]') as HTMLInputElement;
    setValue(hex, '#ffc94d');
    expect(useThemeStore.getState().overrides['--vfo-digits']).toBe('#FFC94D');
    unmount();
  });
});
