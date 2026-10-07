import { getDb } from '../db';
import { parseAll } from '../parseAll';
import { PlannedWorkout } from '../schema';

export async function listPlans(): Promise<PlannedWorkout[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('plans', 'byDate');
  return parseAll('plan', all, PlannedWorkout);
}

export async function savePlan(plan: PlannedWorkout): Promise<void> {
  const db = await getDb();
  await db.put('plans', PlannedWorkout.parse(plan));
}

export async function deletePlan(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('plans', id);
}
