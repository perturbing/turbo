import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '../data/schema';
import { loadSettings, saveSettings } from '../data/repositories/settings';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<Omit<Settings, 'schemaVersion'>>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await loadSettings();
    set({ settings, loaded: true });
  },
  update: async (partial) => {
    const settings = { ...get().settings, ...partial };
    set({ settings });
    await saveSettings(settings);
  },
}));
