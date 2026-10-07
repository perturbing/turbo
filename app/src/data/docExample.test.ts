// @vitest-environment node
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from './db';
import { commitImport, previewImport } from './exportImport';
import { listRecipes } from './repositories/recipes';
import { recipeTotalSeconds, resolvePlan } from '../engine/planResolve';

// Keeps the authoring docs honest: their "Complete example" blocks must import
// cleanly. If the schema or a doc changes, this fails.
function exampleJsonFromDoc(docFile: string): string {
  const docPath = fileURLToPath(new URL(`../../docs/${docFile}`, import.meta.url));
  const doc = readFileSync(docPath, 'utf8');
  const section = doc.split('## Complete example')[1];
  const match = section?.match(/```json\n([\s\S]*?)```/);
  if (!match) throw new Error(`No JSON example found in ${docFile}`);
  return match[1];
}

describe('workout-recipe-format.md example', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
  });

  it('imports cleanly into an empty installation', async () => {
    const preview = await previewImport(exampleJsonFromDoc('workout-recipe-format.md'));
    expect(preview.errors).toEqual([]);
    expect(preview.recipes).toHaveLength(1);
    expect(preview.recipes[0].action).toBe('add');

    await commitImport(preview);
    const recipes = await listRecipes();
    expect(recipes).toHaveLength(1);
    const recipe = recipes[0];
    expect(recipe.id).toBe('ai-vo2-5x3-v1');
    // 10 min warm-up + 5 x (3+3 min) + 8 min cooldown = 48 min
    expect(recipeTotalSeconds(recipe)).toBe(2880);
    const plan = resolvePlan(recipe, 200);
    expect(plan.steps).toHaveLength(1 + 10 + 1);
    expect(plan.steps[1].targetW).toBe(224); // 112% of 200 W
  });

  it('training-plan-format.md example imports workouts AND calendar plans', async () => {
    const preview = await previewImport(exampleJsonFromDoc('training-plan-format.md'));
    expect(preview.errors).toEqual([]);
    expect(preview.recipes).toHaveLength(1);
    expect(preview.plans).toHaveLength(2);
    expect(preview.plans.every((p) => p.action === 'add')).toBe(true);

    await commitImport(preview);
    const { listPlans } = await import('./repositories/plans');
    const plans = await listPlans();
    expect(plans.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-16']);
    // Every plan references a recipe shipped in the same file.
    const recipes = await listRecipes();
    for (const p of plans) {
      expect(recipes.some((r) => r.id === p.recipeId)).toBe(true);
    }
  });
});
