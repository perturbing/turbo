import { useState } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { connectHrm, connectPod, connectTrainer } from '../../ble/deviceManager';
import { ConnectionPill } from '../../components/StatusPill';

// Quick device access from workout setup without losing the selected workout.
export function DevicesDrawer({ onClose }: { onClose: () => void }) {
  const store = useDeviceStore();
  const [error, setError] = useState<string | null>(null);

  const attempt = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError'))
        setError(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h1>Devices</h1>
          <button className="small" onClick={onClose}>
            Done
          </button>
        </div>
        {error ? <div className="banner danger">{error}</div> : null}
        <div className="row between">
          <span>Trainer {store.trainerName ? `· ${store.trainerName}` : ''}</span>
          <div className="row">
            <ConnectionPill state={store.trainerConnection} />
            {store.trainerConnection !== 'connected' ? (
              <button className="small primary" onClick={attempt(connectTrainer)}>
                Connect
              </button>
            ) : null}
          </div>
        </div>
        <div className="row between">
          <span>Controls · {store.pods.filter((p) => p.connection === 'connected').length} pod(s)</span>
          <button className="small" onClick={attempt(connectPod)}>
            Connect pod
          </button>
        </div>
        <div className="row between">
          <span>Heart rate {store.hrmName ? `· ${store.hrmName}` : ''} <span className="muted small">optional</span></span>
          <div className="row">
            <ConnectionPill state={store.hrmConnection} />
            {store.hrmConnection !== 'connected' ? (
              <button className="small" onClick={attempt(connectHrm)}>
                Connect
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
