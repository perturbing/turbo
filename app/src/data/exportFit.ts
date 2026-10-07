import type { RideRecording, RideSample } from './schema';

// FIT activity export is not implemented yet. This module is the seam for a
// future encoder — a pure (recording, samples) -> bytes function with no
// browser dependencies, which makes it a natural candidate for a Rust->WASM
// implementation. A FIT *activity* file (a completed recording) is distinct
// from a FIT structured-workout file; this seam is for activities.
export const FIT_EXPORT_AVAILABLE = false;

export function encodeFitActivity(_recording: RideRecording, _samples: RideSample[]): Uint8Array {
  throw new Error('FIT export is not implemented yet.');
}
