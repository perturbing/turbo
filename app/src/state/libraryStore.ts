import { create } from 'zustand';
import type { FtpObservation, PlannedWorkout, RideRecording, WorkoutRecipe } from '../data/schema';
import { listRecipes } from '../data/repositories/recipes';
import { listRecordings } from '../data/repositories/recordings';
import { listFtpObservations } from '../data/repositories/ftpHistory';
import { listPlans } from '../data/repositories/plans';

interface LibraryState {
  recipes: WorkoutRecipe[];
  recordings: RideRecording[];
  ftpHistory: FtpObservation[];
  plans: PlannedWorkout[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  recipes: [],
  recordings: [],
  ftpHistory: [],
  plans: [],
  loaded: false,
  refresh: async () => {
    // allSettled: one failing store (e.g. mid-upgrade) must not blank the rest.
    const [recipes, recordings, ftpHistory, plans] = await Promise.allSettled([
      listRecipes(),
      listRecordings(),
      listFtpObservations(),
      listPlans(),
    ]);
    const value = <T,>(r: PromiseSettledResult<T[]>): T[] => {
      if (r.status === 'fulfilled') return r.value;
      console.warn('bike-app: library load failed for one store', r.reason);
      return [];
    };
    set({
      recipes: value(recipes),
      recordings: value(recordings),
      ftpHistory: value(ftpHistory),
      plans: value(plans),
      loaded: true,
    });
  },
}));
