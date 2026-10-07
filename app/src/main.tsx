import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import './styles.css';
import { seedBuiltinWorkouts } from './data/builtinWorkouts';
import { useSettingsStore } from './state/settingsStore';
import { initDeviceManager, reattachGrantedDevices } from './ble/deviceManager';
import { initPodNavigation } from './ui/podNav';

async function bootstrap() {
  // ?mock=1 selects simulated devices for development without hardware.
  const params = new URLSearchParams(window.location.search);
  initDeviceManager({ mock: params.get('mock') === '1' });
  // Reconnect previously granted devices in the background — no chooser needed
  // after a refresh (awake devices attach now, sleeping ones when they wake).
  void reattachGrantedDevices();
  // Zwift Ride buttons drive the UI (D-pad focus, A activate, B back, …).
  initPodNavigation();

  await seedBuiltinWorkouts();
  await useSettingsStore.getState().load();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}

void bootstrap();
