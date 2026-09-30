// SPDX-License-Identifier: GPL-2.0-or-later

/** @vitest-environment jsdom */

import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '../../components/meters/__tests__/harness';
import { LAPTOP_LAYOUT_TEMPLATE } from '../defaultLayout';
import { LayoutSettingsModal } from '../LayoutSettingsModal';

function setup() {
  const onResetToBuiltIn = vi.fn();
  const view = render(
    createElement(LayoutSettingsModal, {
      title: 'Layout settings',
      initial: { name: 'Laptop', icon: '', description: '', locked: false },
      onSave: vi.fn(),
      onClose: vi.fn(),
      manager: {
        workspaces: [{ id: 'w1', name: 'Laptop', locked: false }],
        selectedId: 'w1',
        onSelectWorkspace: vi.fn(),
        onDeleteWorkspace: vi.fn(),
        canDeleteWorkspace: false,
        onResetToBuiltIn,
        savedLayouts: [],
        onSaveWorkspaceToLibrary: vi.fn(),
        onApplySaved: vi.fn(),
        onReplaceSaved: vi.fn(),
        onRenameSaved: vi.fn(),
        onDeleteSaved: vi.fn(),
      },
    }),
  );
  const button = () =>
    Array.from(view.container.querySelectorAll('button')).find((b) =>
      /^(Reset to Laptop|Confirm reset\?)$/.test(b.textContent ?? ''),
    )!;
  return { ...view, button, onResetToBuiltIn };
}

describe('LayoutSettingsModal "Reset to Laptop"', () => {
  it('resets only after a confirming second click', () => {
    const { button, onResetToBuiltIn, unmount } = setup();
    act(() => button().click());
    expect(onResetToBuiltIn).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Confirm reset?');
    act(() => button().click());
    expect(onResetToBuiltIn).toHaveBeenCalledWith(LAPTOP_LAYOUT_TEMPLATE.id);
    expect(button().textContent).toBe('Reset to Laptop');
    unmount();
  });
});
