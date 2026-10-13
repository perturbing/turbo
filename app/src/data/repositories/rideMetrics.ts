import { getDb, type StoredRideMetrics } from '../db';
import type { RideRecording } from '../schema';
import { computeRideMetrics, METRICS_VERSION, type RideMetrics } from '../../engine/metrics';
import { loadSamples } from './recordings';

export async function getStoredMetrics(recordingId: string): Promise<RideMetrics | undefined> {
  const db = await getDb();
  const row = await db.get('rideMetrics', recordingId);
  return row && row.metrics.version === METRICS_VERSION ? row.metrics : undefined;
}

export async function saveMetrics(metrics: RideMetrics): Promise<void> {
  const db = await getDb();
  const row: StoredRideMetrics = { recordingId: metrics.recordingId, computedAt: new Date().toISOString(), metrics };
  await db.put('rideMetrics', row);
}

// Cached metrics for a finished recording, computed from its samples on first
// use (and again whenever METRICS_VERSION moves on). `fallbackFtp` covers a
// ride recorded before any FTP was set.
export async function metricsFor(recording: RideRecording, fallbackFtp: number | null): Promise<RideMetrics> {
  const cached = await getStoredMetrics(recording.id);
  if (cached) return cached;
  const samples = await loadSamples(recording.id);
  const metrics = computeRideMetrics(recording, samples, fallbackFtp);
  if (recording.state !== 'in-progress') await saveMetrics(metrics);
  return metrics;
}

export async function metricsForAll(recordings: RideRecording[], fallbackFtp: number | null): Promise<Map<string, RideMetrics>> {
  const out = new Map<string, RideMetrics>();
  for (const r of recordings) {
    if (r.state === 'in-progress') continue;
    try {
      out.set(r.id, await metricsFor(r, fallbackFtp));
    } catch (e) {
      console.warn('bike-app: could not compute metrics for', r.id, e);
    }
  }
  return out;
}
