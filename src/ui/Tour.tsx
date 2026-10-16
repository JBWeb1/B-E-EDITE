import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  /** CSS selector of the part of the screen to point at; none = centred card. */
  target?: string;
  title: string;
  body: string;
}

export function tourSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return true; // no storage: don't nag on every visit
  }
}

function markSeen(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0;

/**
 * Coach marks: dims the screen, highlights one part at a time and explains it.
 * Next / Back / Skip, arrow keys and Esc work. Finishing or skipping remembers it.
 */
export function Tour({ steps, storageKey, onClose }: { steps: TourStep[]; storageKey: string; onClose: () => void }) {
  // Steps whose target isn't on screen (e.g. hidden on phones) are skipped.
  const [shown] = useState(() => steps.filter((s) => !s.target || visible(document.querySelector(s.target))));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = shown[i];

  const finish = () => {
    markSeen(storageKey);
    onClose();
  };

  useLayoutEffect(() => {
    const measure = () => {
      const el = step?.target ? document.querySelector(step.target) : null;
      if (visible(el)) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setRect(el.getBoundingClientRect());
      } else setRect(null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') i < shown.length - 1 ? setI(i + 1) : finish();
      else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!step) return null;
  const pad = 6;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cardW = Math.min(340, W - 32);
  let cardStyle: React.CSSProperties = { width: cardW, left: (W - cardW) / 2, top: H / 2 - 110 };
  if (rect) {
    const below = H - rect.bottom;
    const above = rect.top;
    const right = W - rect.right;
    const left = Math.max(16, Math.min(W - cardW - 16, rect.left + rect.width / 2 - cardW / 2));
    if (below > 220) cardStyle = { width: cardW, left, top: rect.bottom + 14 };
    else if (above > 220) cardStyle = { width: cardW, left, bottom: H - rect.top + 14 };
    else if (right > cardW + 30) cardStyle = { width: cardW, left: rect.right + 14, top: Math.max(16, Math.min(H - 240, rect.top)) };
    else if (rect.left > cardW + 30) cardStyle = { width: cardW, left: rect.left - cardW - 14, top: Math.max(16, Math.min(H - 240, rect.top)) };
    else cardStyle = { width: cardW, left, top: Math.max(16, H - 240) };
  }
  return createPortal(
    <div className="tour" data-modal>
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" role="dialog" aria-label="Guided tour" style={cardStyle}>
        <span className="tour-count">
          {i + 1} / {shown.length}
        </span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden>
          {shown.map((_, k) => (
            <span key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="link" onClick={finish}>
            Skip tour
          </button>
          <span />
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          <button className="primary" onClick={() => (i < shown.length - 1 ? setI(i + 1) : finish())} autoFocus>
            {i < shown.length - 1 ? 'Next' : 'Start editing'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
