import { useEffect, useState } from 'react';

/** Chrome/Edge/Android event that lets a page show its own "Install app" button. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone/iPad browsers have no install prompt: people use Share → Add to Home Screen. */
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Register the service worker so the app can be installed and opened offline. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Not fatal: the site still works, it just can't be installed/offline.
    });
  });
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/**
 * Install state for the UI: `canPrompt` when the browser offers one-click install,
 * `ios` when the user needs the Share-menu instructions, `installed` once it is.
 */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return {
    installed: isInstalled(),
    canPrompt: deferred !== null,
    ios: isIOS() && !isInstalled(),
    install: async () => {
      if (!deferred) return false;
      const event = deferred;
      deferred = null;
      await event.prompt();
      const { outcome } = await event.userChoice;
      listeners.forEach((l) => l());
      return outcome === 'accepted';
    },
  };
}
