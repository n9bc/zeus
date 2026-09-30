// SPDX-License-Identifier: GPL-2.0-or-later
//
// Zeus — OpenHPSDR Protocol-1 / Protocol-2 client.
//
// Mode picker for a DSP button (NB, NR): the button shows the current mode and
// opens a list of every available mode, so the operator picks one directly
// instead of clicking through a cycle. Reuses the AGC mode menu's markup and
// styles (.agc-mode-caret / .agc-mode-menu / .agc-mode-option). The list is
// portaled into the button's own document so it escapes the tile's overflow
// clip and still works in a detached workspace window.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DspModeOption<K extends string> {
  key: K;
  label: string;
  title?: string;
}

interface DspModeMenuProps<K extends string> {
  /** Accessible name for the button and its list, e.g. "Noise reduction mode". */
  menuLabel: string;
  value: K;
  options: readonly DspModeOption<K>[];
  onSelect: (key: K) => void;
  buttonLabel: string;
  title: string;
  active: boolean;
  disabled: boolean;
  /** Keep the button focusable (aria-disabled) instead of natively disabled. */
  focusableWhenDisabled?: boolean;
}

export function DspModeMenu<K extends string>({
  menuLabel,
  value,
  options,
  onSelect,
  buttonLabel,
  title,
  active,
  disabled,
  focusableWhenDisabled = false,
}: DspModeMenuProps<K>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: Math.round(r.bottom + 4),
        left: Math.round(r.left),
        width: Math.round(Math.max(92, r.width)),
      });
    }
  }, [open]);

  // Focus the current mode when the list opens so arrow keys start from it.
  useEffect(() => {
    if (!open || !pos) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const current = Array.from(items ?? []).find((b) => b.getAttribute('aria-selected') === 'true');
    (current ?? items?.[0])?.focus();
  }, [open, pos]);

  // Close on outside press, Escape, and any scroll or resize (the list is
  // position:fixed, so it would otherwise drift away from its button).
  useEffect(() => {
    if (!open) return;
    const doc = buttonRef.current?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);
    win.addEventListener('resize', close);
    win.addEventListener('scroll', onScroll, true);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('keydown', onKey);
      win.removeEventListener('resize', close);
      win.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const at = items.indexOf(e.target as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  const nativeDisabled = disabled && !focusableWhenDisabled;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={nativeDisabled}
        aria-disabled={disabled && focusableWhenDisabled ? true : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${menuLabel}: ${buttonLabel}`}
        className={`btn sm ${active ? 'active' : ''}`}
        title={title}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
      >
        <span>{buttonLabel}</span>
        <span className="agc-mode-caret" aria-hidden>
          v
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="agc-mode-menu"
            role="listbox"
            aria-label={menuLabel}
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={opt.key === value}
                className={`agc-mode-option ${opt.key === value ? 'active' : ''}`}
                title={opt.title}
                onClick={() => {
                  if (opt.key !== value) onSelect(opt.key);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          buttonRef.current?.ownerDocument.body ?? document.body,
        )}
    </>
  );
}
