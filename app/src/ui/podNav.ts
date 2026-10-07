// Native Zwift Ride button mapping: the pods act as a generic UI controller.
//   D-pad left/up   -> focus previous control
//   D-pad right/down-> focus next control (scoped to an open dialog/drawer)
//   A               -> activate the focused control (click)
//   B               -> close the open dialog/drawer, else history back
//   Y               -> cycle main sections (Workouts -> Training -> Devices -> Data)
//   Z               -> pause/resume toggle during a workout ride
//   Shift paddles   -> virtual gears in Shift mode (wired in rideStore)
// All mapping is suppressed while the button-check drawer ([data-pod-capture])
// is open, so testing buttons has no side effects.

import { useDeviceStore } from '../state/deviceStore';
import { useRideStore } from '../state/rideStore';
import type { RideButton } from '../ble/decoders/zwiftRide';

const SECTIONS = ['/workouts', '/calendar', '/training', '/devices', '/data'];
const FOCUS_CLASS = 'pod-focus';

export function initPodNavigation(): void {
  // Mock mode: expose the handler so the mapping is testable from the console,
  // e.g. __podPress('DPad_Down') — real pods go through the device store.
  if (useDeviceStore.getState().mockMode) {
    (window as unknown as { __podPress?: (b: RideButton) => void }).__podPress = handleButton;
  }
  let prev = useDeviceStore.getState().lastButton;
  useDeviceStore.subscribe((state) => {
    const lastButton = state.lastButton;
    if (!lastButton || lastButton === prev) return;
    prev = lastButton;
    handleButton(lastButton.button);
  });
}

function handleButton(button: RideButton): void {
  if (document.querySelector('[data-pod-capture]')) return;
  switch (button) {
    case 'DPad_Right':
    case 'DPad_Down':
      moveFocus(1);
      break;
    case 'DPad_Left':
    case 'DPad_Up':
      moveFocus(-1);
      break;
    case 'A':
      activateFocused();
      break;
    case 'B':
      goBack();
      break;
    case 'Y':
      cycleSection();
      break;
    case 'Z':
      togglePause();
      break;
    default:
      break; // shift paddles handled by the ride engine; power buttons reserved
  }
}

// Focus is scoped to an open dialog/drawer (acts as a focus trap), otherwise
// the whole page, in DOM order.
function focusableElements(): HTMLElement[] {
  const scope = document.querySelector('.dialog, .drawer') ?? document.body;
  const candidates = scope.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  return [...candidates].filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0,
  );
}

function moveFocus(direction: 1 | -1): void {
  const elements = focusableElements();
  if (elements.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  const index = current ? elements.indexOf(current) : -1;
  const next =
    index === -1
      ? direction === 1
        ? elements[0]
        : elements[elements.length - 1]
      : elements[(index + direction + elements.length) % elements.length];
  current?.classList.remove(FOCUS_CLASS);
  next.focus();
  // Programmatic focus doesn't reliably trigger :focus-visible, so mark it.
  next.classList.add(FOCUS_CLASS);
  next.addEventListener('blur', () => next.classList.remove(FOCUS_CLASS), { once: true });
  next.scrollIntoView({ block: 'nearest' });
}

function activateFocused(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) el.click();
}

function goBack(): void {
  const backdrop = document.querySelector<HTMLElement>('.dialog-backdrop, .drawer-backdrop');
  if (backdrop) {
    backdrop.click(); // backdrops close their dialog/drawer on click
  } else {
    window.history.back();
  }
}

function cycleSection(): void {
  if (useRideStore.getState().engine) return; // nav is hidden during a ride
  const path = window.location.hash.replace(/^#/, '') || SECTIONS[0];
  const index = SECTIONS.findIndex((s) => path.startsWith(s));
  window.location.hash = `#${SECTIONS[(index + 1 + SECTIONS.length) % SECTIONS.length] ?? SECTIONS[0]}`;
}

function togglePause(): void {
  const { engine, prepared, snapshot } = useRideStore.getState();
  // Limited to workouts: the ramp-test UI has no pause affordance, so a pod
  // press silently pausing the protocol would be confusing.
  if (!engine || prepared?.kind !== 'workout') return;
  if (snapshot?.phase === 'riding') engine.pause();
  else if (snapshot?.phase === 'paused') engine.resume();
}
