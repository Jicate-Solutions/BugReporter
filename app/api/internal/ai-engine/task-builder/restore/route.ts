/**
 * POST /api/internal/ai-engine/task-builder/restore — bring back an earlier version.
 *
 * Body: { job_type, version }. For developers the old recipe becomes a new
 * draft (live only after a passing test). Super admins restore straight onto
 * the live task.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { JOB_TYPE_RE, restoreVersion } from '@/lib/ai-engine/task-builder';
import { caller, fail, respond } from '../_shared';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  job_type: z.string().regex(JOB_TYPE_RE),
  version: z.number().int().min(1)
});

export async function POST(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Which version?', 400);
  return respond(await restoreVersion(c.admin, c.actor, parsed.data));
}
