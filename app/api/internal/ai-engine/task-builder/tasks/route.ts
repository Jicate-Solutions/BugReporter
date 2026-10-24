/**
 * POST /api/internal/ai-engine/task-builder/tasks — create a new AI task.
 *
 * Body: { app_id, name, recipe }. The task key is the app's slug + '.' + the
 * name folded to lower case. The caller must belong to the app (organisation
 * owner/admin/developer, or app maintainer/developer). New tasks start OFF.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createTask, recipeSchema } from '@/lib/ai-engine/task-builder';
import { caller, fail, respond } from '../_shared';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  app_id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  recipe: recipeSchema
});

export async function POST(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Some fields are missing or not valid.', 400);
  return respond(await createTask(c.admin, c.actor, parsed.data), 201);
}
