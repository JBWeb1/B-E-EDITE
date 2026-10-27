import { useEffect, useRef, useState } from 'react';
import { fontStack, loadWebFont, previewFont, WEB_FONTS, webFontIn } from '../lib/fonts';

const nameOf = (stack: string) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');

/**
 * Font menu with search: your brand fonts, the built-in fonts, then Google Fonts by
 * kind. Each name is shown in its own font; a Google font loads when picked.
 */
export function FontPicker({
  value,
  onChange,
  local,
  brand = [],
  label = 'Font',
}: {
  value: string;
  onChange: (stack: string) => void;
  /** Built-in font-family values. */
  local: string[];
  /** Brand heading/body fonts, shown first. */
  brand?: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || nameOf(s).toLowerCase().includes(q);
  const web = WEB_FONTS.filter((f) => match(f.family));
  useEffect(() => {
    if (open) web.slice(0, 80).forEach(previewFont);
  }, [open, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (stack: string) => {
    setOpen(false);
    setQuery('');
    if (webFontIn(stack)) await loadWebFont(stack);
    onChange(stack);
  };
  const item = (stack: string, key: string) => (
    <button key={key} role="option" aria-selected={nameOf(stack) === nameOf(value)} className={nameOf(stack) === nameOf(value) ? 'active' : ''} style={{ fontFamily: stack }} onClick={() => void pick(stack)}>
      {nameOf(stack)}
    </button>
  );
  const groups = ['Sans', 'Serif', 'Display', 'Handwriting', 'Mono'] as const;
  return (
    <div className="field font-picker" ref={box}>
      <span>{label}</span>
      <button className="font-picker-current" style={{ fontFamily: value }} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${nameOf(value)}`}>
        {nameOf(value)}
      </button>
      {open && (
        <div className="font-picker-menu">
          <input autoFocus placeholder="Search fonts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search fonts" />
          <div className="font-picker-list" role="listbox" aria-label="Fonts">
            {brand.filter(match).length > 0 && (
              <>
                <h5>Brand</h5>
                {brand.filter(match).map((s, i) => item(s, `b${i}`))}
              </>
            )}
            {local.filter(match).length > 0 && (
              <>
                <h5>Basic</h5>
                {local.filter(match).map((s) => item(s, s))}
              </>
            )}
            {groups.map((g) => {
              const list = web.filter((f) => f.category === g);
              return list.length ? (
                <div key={g}>
                  <h5>{g === 'Handwriting' ? 'Handwriting & script' : g} · Google Fonts</h5>
                  {list.map((f) => item(fontStack(f.family), f.family))}
                </div>
              ) : null;
            })}
            {!web.length && !local.filter(match).length && <p className="hint">No font called “{query}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
