import { useEffect } from 'react';

/**
 * Keeps the screen awake while `active` is true, using the Screen Wake Lock
 * API. The browser releases the lock whenever the page is hidden (app switch,
 * phone locked), so it is re-requested when the page becomes visible again.
 *
 * Silently does nothing where the API is unavailable (older browsers, jsdom)
 * or when the request is refused (battery saver, low battery).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release();
          return;
        }
        lock = sentinel;
        sentinel.addEventListener('release', () => {
          if (lock === sentinel) lock = null;
        });
      } catch {
        // Refused by the platform; nothing to do.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !lock) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}
