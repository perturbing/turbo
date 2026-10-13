// Performance management (Coggan / Banister impulse-response): daily training
// stress feeds two exponentially weighted averages. Fitness (CTL, 42-day) is
// the load the body has adapted to; fatigue (ATL, 7-day) is the recent load;
// form (TSB) is fitness minus fatigue, taken from the previous day so today's
// ride does not count against today's freshness.

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

export interface DailyLoad {
  date: string; // YYYY-MM-DD
  tss: number;
}

export interface PerformancePoint {
  date: string;
  tss: number;
  fitness: number;
  fatigue: number;
  form: number;
  projected: boolean;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
}

// One point per calendar day from the first load (or `from`) to `to`,
// inclusive. Days after `today` use `planned` loads and are flagged projected.
export function performanceSeries(
  actual: DailyLoad[],
  planned: DailyLoad[],
  today: string,
  to: string,
  from?: string,
): PerformancePoint[] {
  const byDate = new Map<string, number>();
  for (const l of actual) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.tss);
  const plannedByDate = new Map<string, number>();
  for (const l of planned) if (l.date > today) plannedByDate.set(l.date, (plannedByDate.get(l.date) ?? 0) + l.tss);

  const firstActual = [...byDate.keys()].sort()[0];
  const start = from ?? firstActual ?? today;
  if (start > to) return [];

  const points: PerformancePoint[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let d = start; d <= to; d = addDays(d, 1)) {
    const projected = d > today;
    const tss = projected ? (plannedByDate.get(d) ?? 0) : (byDate.get(d) ?? 0);
    const form = fitness - fatigue; // yesterday's values
    fitness += (tss - fitness) / FITNESS_DAYS;
    fatigue += (tss - fatigue) / FATIGUE_DAYS;
    points.push({ date: d, tss, fitness, fatigue, form, projected });
  }
  return points;
}

export function pointOn(series: PerformancePoint[], date: string): PerformancePoint | undefined {
  return series.find((p) => p.date === date);
}
