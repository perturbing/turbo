// Intensity zones relative to FTP. Boundaries and colors are design
// parameters (design doc: "exact zone boundaries, colors … remain design
// parameters"); numeric targets and labels are always shown alongside color.

export interface Zone {
  name: string;
  maxPct: number; // upper bound, % of FTP
  cssVar: string;
}

export const ZONES: Zone[] = [
  { name: 'Recovery', maxPct: 55, cssVar: '--zone-recovery' },
  { name: 'Endurance', maxPct: 75, cssVar: '--zone-endurance' },
  { name: 'Tempo', maxPct: 90, cssVar: '--zone-tempo' },
  { name: 'Threshold', maxPct: 105, cssVar: '--zone-threshold' },
  { name: 'VO2+', maxPct: Infinity, cssVar: '--zone-vo2' },
];

export function zoneForPct(pct: number): Zone {
  return ZONES.find((z) => pct <= z.maxPct) ?? ZONES[ZONES.length - 1];
}

export function zoneColor(targetW: number, ftpW: number | null): string {
  const pct = ftpW ? (targetW / ftpW) * 100 : 60;
  return `var(${zoneForPct(pct).cssVar})`;
}
