import { getDb } from '../db';
import { migrateRecord } from '../migrations';
import { parseAll } from '../parseAll';
import { WorkoutRecipe } from '../schema';

export async function listRecipes(): Promise<WorkoutRecipe[]> {
  const db = await getDb();
  const all = await db.getAll('recipes');
  return parseAll('recipe', all, WorkoutRecipe).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRecipe(id: string): Promise<WorkoutRecipe | undefined> {
  const db = await getDb();
  const raw = await db.get('recipes', id);
  return raw ? WorkoutRecipe.parse(migrateRecord<WorkoutRecipe>('recipe', raw)) : undefined;
}

export async function saveRecipe(recipe: WorkoutRecipe): Promise<void> {
  const db = await getDb();
  await db.put('recipes', WorkoutRecipe.parse(recipe));
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('recipes', id);
}
