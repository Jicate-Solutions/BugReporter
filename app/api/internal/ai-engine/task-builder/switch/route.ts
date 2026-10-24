/**
 * POST /api/internal/ai-engine/task-builder/switch — switch a task on or off.
 *
 * Body: { job_type, on }. OFF is immediate for anyone who can see the task.
 * ON is refused until the latest version has passed a test run, and while no
 * worker is alive.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { JOB_TYPE_RE, switchTask } from '@/lib/ai-engine/task-builder';
import { caller, fail, respond } from '../_shared';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  job_type: z.string().regex(JOB_TYPE_RE),
  on: z.boolean()
});

export async function POST(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Which task, and on or off?', 400);
  return respond(await switchTask(c.admin, c.actor, parsed.data));
}
