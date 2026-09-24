// SPDX-License-Identifier: GPL-2.0-or-later

/** @vitest-environment jsdom */

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchRecorderStatus: vi.fn(),
  startRecorder: vi.fn(),
  stopRecorder: vi.fn(),
  saveReplay: vi.fn(),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, ...api };
});

import { act, render } from '../../components/meters/__tests__/harness';
import { CaptureControls } from './CaptureControls';

const idle = { recording: false, source: '', fileName: null, elapsedSec: 0, bytes: 0, error: null };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttons(container: HTMLElement) {
  const [capture, save] = Array.from(container.querySelectorAll('button'));
  return { capture: capture!, save: save! };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('CaptureControls', () => {
  it('starts an RX recording and shows the elapsed time', async () => {
    api.fetchRecorderStatus.mockResolvedValue(idle);
    api.startRecorder.mockResolvedValue({
      ok: true,
      status: { ...idle, recording: true, source: 'rx', fileName: 'a.wav', elapsedSec: 65 },
    });
    const { container } = render(createElement(CaptureControls, { active: true }));
    await flush();

    await act(async () => buttons(container).capture.click());
    await flush();

    expect(api.startRecorder).toHaveBeenCalledWith('rx');
    expect(buttons(container).capture.textContent).toBe('● 1:05');
  });

  it('will not take over a recorder busy with another source', async () => {
    api.fetchRecorderStatus.mockResolvedValue({ ...idle, recording: true, source: 'txmic' });
    const { container } = render(createElement(CaptureControls, { active: true }));
    await flush();

    expect(buttons(container).capture.disabled).toBe(true);
    expect(buttons(container).capture.textContent).toBe('CAPTURE');
  });

  it('saves the last 60 s from the replay ring', async () => {
    api.fetchRecorderStatus.mockResolvedValue(idle);
    api.saveReplay.mockResolvedValue({ ok: true, name: 'replay.wav' });
    const { container } = render(createElement(CaptureControls, { active: true }));
    await flush();

    await act(async () => buttons(container).save.click());
    await flush();

    expect(api.saveReplay).toHaveBeenCalledWith(60);
    expect(container.textContent).toContain('saved replay.wav');
  });
});
