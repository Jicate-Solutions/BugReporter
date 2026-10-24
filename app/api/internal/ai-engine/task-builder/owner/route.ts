/**
 * POST /api/internal/ai-engine/task-builder/owner — hand a task to a new owner.
 *
 * Body: { job_type, owner_email }. Super admins only. The task keeps running
 * whoever owns it.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { JOB_TYPE_RE, reassignOwner } from '@/lib/ai-engine/task-builder';
import { caller, fail, respond } from '../_shared';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  job_type: z.string().regex(JOB_TYPE_RE),
  owner_email: z.string().trim().email().max(320)
});

export async function POST(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', "Enter the new owner's email.", 400);
  return respond(await reassignOwner(c.admin, c.actor, parsed.data));
}
