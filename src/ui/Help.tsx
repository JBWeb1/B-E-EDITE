import { useEffect, useRef, useState } from 'react';

/**
 * Dialogs, menus and the slideshow carry `data-modal`. While one is on screen,
 * the editors' keyboard shortcuts stay off so keys only affect what is in front.
 */
export function shortcutsBlocked(): boolean {
  return document.querySelector('[data-modal]') !== null;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Ignore: the tips will just show again next time.
  }
}

/** A dismissible card with quick tips, shown until the user clicks "Got it". */
export function FirstRunTips({ storageKey, title, tips }: { storageKey: string; title: string; tips: string[] }) {
  const [open, setOpen] = useState(() => !readFlag(storageKey));
  if (!open) return null;
  return (
    <div className="tips" role="note">
      <strong>{title}</strong>
      <ul>
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <button
        className="primary"
        onClick={() => {
          writeFlag(storageKey);
          setOpen(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}

export interface Shortcut {
  keys: string[];
  action: string;
}

export function ShortcutsDialog({ shortcuts, onClose }: { shortcuts: Shortcut[]; onClose: () => void }) {
  // Subscribe once: re-subscribing on every render could drop the listener in the middle
  // of a key event, when another handler re-renders the parent synchronously.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts">
        <h3>Keyboard shortcuts</h3>
        <table className="shortcut-table">
          <tbody>
            {shortcuts.map((s) => (
              <tr key={s.action}>
                <td>
                  {s.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ' + '}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="block" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
