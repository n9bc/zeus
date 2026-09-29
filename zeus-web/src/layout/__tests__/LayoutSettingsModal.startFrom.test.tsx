// SPDX-License-Identifier: GPL-2.0-or-later

/** @vitest-environment jsdom */

import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '../../components/meters/__tests__/harness';
import { LAPTOP_LAYOUT_TEMPLATE } from '../defaultLayout';
import { LayoutSettingsModal } from '../LayoutSettingsModal';

function CreateDialog() {
  const [sourceId, setSourceId] = useState('');
  return createElement(LayoutSettingsModal, {
    title: 'New workspace',
    initial: { name: 'Workspace 2', icon: '', description: '', locked: false },
    onSave: vi.fn(),
    onClose: vi.fn(),
    createSource: { savedLayouts: [], sourceId, onSourceChange: setSourceId },
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

describe('LayoutSettingsModal "Start from"', () => {
  const setup = () => {
    const view = render(createElement(CreateDialog));
    const select = view.container.querySelector('select[aria-label="Start from"]') as HTMLSelectElement;
    const label = view.container.querySelector('input[aria-label="Layout label"]') as HTMLInputElement;
    return { ...view, select, label };
  };

  it('pre-fills from Laptop and restores the original fields on Blank', () => {
    const { select, label, unmount } = setup();
    setValue(select, LAPTOP_LAYOUT_TEMPLATE.id, 'change');
    expect(label.value).toBe('Laptop');
    setValue(select, '', 'change');
    expect(label.value).toBe('Workspace 2');
    unmount();
  });

  it('keeps a name the operator typed when switching back to Blank', () => {
    const { select, label, unmount } = setup();
    setValue(select, LAPTOP_LAYOUT_TEMPLATE.id, 'change');
    setValue(label, 'Travel rig', 'input');
    setValue(select, '', 'change');
    expect(label.value).toBe('Travel rig');
    unmount();
  });
});
