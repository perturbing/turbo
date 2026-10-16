import { useEffect, useRef } from 'react';

// Hold-to-brake. The brake is on for as long as the button is held (touch,
// mouse or keyboard) and off the moment it is let go — a brake that stays on
// would make the next pedal stroke near impossible at max resistance. `held`
// is the engine's view, so a lever pull on the controller lights it up too.
export function BrakeButton({ held, onChange }: { held: boolean; onChange: (on: boolean) => void }) {
  const holding = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const set = (on: boolean) => {
    if (holding.current === on) return;
    holding.current = on;
    onChangeRef.current(on);
  };

  // A pointer-up that never arrives (the tab loses focus, the browser
  // cancels the gesture) must not leave the brake on.
  useEffect(() => {
    const release = () => set(false);
    window.addEventListener('blur', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', release);
      release();
    };
  }, []);

  return (
    <button
      className={`brake${held ? ' held' : ''}`}
      aria-pressed={held}
      title="Hold to brake the flywheel"
      onPointerDown={(e) => {
        e.preventDefault();
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') set(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {held ? 'Braking' : 'Brake'}
    </button>
  );
}
