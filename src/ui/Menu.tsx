import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A button that opens a dropdown panel. Clicking a button inside the panel,
 * clicking outside, or pressing Escape closes it.
 */
export function Menu({
  label,
  title,
  buttonClassName = '',
  align = 'right',
  children,
}: {
  label: ReactNode;
  title?: string;
  buttonClassName?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button className={buttonClassName} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={title}>
        {label}
      </button>
      {open && (
        <div
          className={`menu-panel ${align}`}
          role="menu"
          onClick={(e) => {
            // Close after choosing an item, but not when adjusting a control inside the menu.
            if ((e.target as HTMLElement).closest('[data-menu-item]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  title,
  detail,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="menu-item" data-menu-item role="menuitem" onClick={onClick} disabled={disabled}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-text">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
    </button>
  );
}
