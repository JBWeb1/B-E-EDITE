/**
 * Parts of the app that load only when needed, so the home screen opens fast.
 * `prefetchAll` fetches them in the background once the page is idle, so opening
 * an editor is instant and the offline cache gets everything.
 */
import { lazy } from 'react';

export const loadVideoEditor = () => import('./video/VideoEditor');
export const loadDesignEditor = () => import('./design/DesignEditor');
const loadPhoneLink = () => import('./share/PhoneLink');
const loadLiveJoin = () => import('./share/LiveJoin');

export const VideoEditor = lazy(() => loadVideoEditor().then((m) => ({ default: m.VideoEditor })));
export const DesignEditor = lazy(() => loadDesignEditor().then((m) => ({ default: m.DesignEditor })));
export const PhoneLink = lazy(() => loadPhoneLink().then((m) => ({ default: m.PhoneLink })));
export const LiveJoin = lazy(() => loadLiveJoin().then((m) => ({ default: m.LiveJoin })));

const idle = (fn: () => void) => ((window as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200)))(fn);

/** Warm up the editors in the background (ignoring failures, e.g. when offline). */
export function prefetchAll() {
  idle(() => {
    void loadVideoEditor().catch(() => {});
    void loadDesignEditor().catch(() => {});
  });
}
