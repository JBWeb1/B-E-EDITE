import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Phones and narrow windows get the stacked, one-page editor layout. */
export const isPhone = () => !!window.matchMedia?.('(max-width: 760px)').matches;

/**
 * On phones the library opens as a bottom sheet that fills the space between the
 * player (pinned at the top) and the tab bar. This keeps `--sheet-top` on the page
 * equal to the bottom of the player as the page scrolls or the window changes size.
 */
export function useSheetTop(playerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = playerRef.current;
        if (!el || !isPhone()) return;
        const bottom = Math.max(0, Math.round(el.getBoundingClientRect().bottom));
        document.documentElement.style.setProperty('--sheet-top', `${bottom}px`);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (playerRef.current) ro?.observe(playerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [playerRef]);
}
