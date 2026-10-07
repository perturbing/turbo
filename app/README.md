# Bike — indoor cycling app

A fully client-side indoor cycling web app: connect a smart trainer over Web Bluetooth, run
structured workouts in ERG or Shift mode, take a ramp test, and keep every ride on your own
device. There is **no server** — all data lives in your browser (IndexedDB) and moves between
devices via versioned JSON export/import.

The device protocols were verified against real hardware before porting (Wahoo KICKR CORE via
standard FTMS + Cycling Power, Zwift Ride pods via their proprietary protocol, any standard
BLE heart-rate monitor); the decoder tests carry hex fixtures captured from those devices.
The product spec is `../design/indoor-cycling-app-design.md`.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit + integration tests
npm run build      # static build in dist/ — host anywhere
```

**Without hardware:** open the app with `?mock=1` (e.g. `http://localhost:5173/?mock=1`) to use
simulated trainer/pods/HRM. Every screen and the full ride loop work in mock mode.

## Browser support

Web Bluetooth is Chromium-only:

| Browser | Works |
|---|---|
| Chrome / Edge / Chromium, desktop (Linux/macOS/Windows) | ✅ |
| Chrome / Chromium / Brave on Linux | ⚠️ off by default — enable `chrome://flags/#enable-web-bluetooth` (or launch with `--enable-features=WebBluetooth`), then relaunch |
| Chrome on Android | ✅ |
| Brave (any platform) | ⚠️ additionally enable `brave://flags/#brave-web-bluetooth-api` — on Linux you need both flags |
| ungoogled-chromium | ❌ Web Bluetooth stripped |
| Firefox, Safari (incl. iOS — all iOS browsers) | ❌ no Web Bluetooth |

The page must be served from **localhost or HTTPS**. On Linux, make sure BlueZ is running —
`chrome://bluetooth-internals` shows the adapter and nearby devices, but note that it working does
*not* mean the web API is enabled (it has its own flag, above).
`navigator.bluetooth.getDevices()` (the "Reconnect granted devices" button) additionally needs
`chrome://flags/#enable-web-bluetooth-new-permissions-backend` on some versions.

## Zwift Ride native button mapping

The pods drive the whole UI (see Devices → Check buttons for the in-app legend):
D-pad moves focus between controls (trapped inside an open dialog/drawer) · **A** activates the
focused control · **B** closes the open dialog/drawer, otherwise goes back · **Y** cycles the main
sections · **Z** toggles pause/resume during a workout · the shift paddles change virtual gears in
Shift mode. Destructive actions stay behind their confirm dialogs, and the mapping is suspended
while the button-check drawer is open.

## Architecture

- `src/ble/` — Web Bluetooth device layer: `decoders/` (pure, unit-tested against hex fixtures
  from the real device logs), `trainer.ts` (FTMS control with ack-gated commands), `ridePods.ts`
  (dual-pod merge + `RideOn` handshake), `deviceManager.ts` (lifecycle/reconnect), `mock/`.
- `src/engine/` — UI-independent ride engine (state machine, 1 Hz sampling, ERG scheduling,
  autosave), plan resolution, ramp-test method (`ramp-v1`), virtual gears.
- `src/data/` — zod schemas (every record carries `schemaVersion`), IndexedDB stores, migration
  chain, export/import envelope, built-in workouts, FIT stub (`exportFit.ts`).
- `src/screens/` — Workouts / Builder / Setup / Live ride / Training level / Ramp test /
  Devices / Your data.

### Data ownership

- Everything is stored locally; recordings autosave every ~10 s during a ride.
- "Export all" produces one JSON envelope (recipes, recordings with samples, FTP history) that
  imports into a clean installation without loss — this is the device-replacement path.
- Old schema versions stay importable through the per-record migration chain; newer-than-known
  versions are rejected with a clear message, never silently mangled.

## Hardware test checklist (needs the real trainer)

Decisions marked **provisional** in code until confirmed on hardware:

1. **ERG basics** — connect the KICKR, start a short ERG workout: targets change at block
   boundaries, each change is acknowledged (no "target not confirmed" banner).
2. **Shift mode feel** — virtual gears use FTMS SIM mode (gear → grade, 0.5 %/gear, 24 gears).
   Check the resistance feel and shifter buttons (right pod top = harder, bottom = easier).
3. **Pause behavior** — while paused the app sends nothing; verify what the trainer actually
   does with its last target and adjust if needed.
4. **Reconnect** — power-cycle the trainer mid-ride: interruption banner, auto-reconnect,
   resume re-applies the target after a new Request Control.
5. **Resistance scale** — resistance mode (FTMS opcode 0x04) is deliberately unused: the KICKR
   reports a raw 0–100 range that is probably 0.0–10.0 levels (0.1 resolution). Verify before
   ever using it.
6. **Zwift Ride pods** — both pods connect (left pod may need a retry — known quirk), button
   check shows all 16 buttons, no double-fires when both pods are connected.
