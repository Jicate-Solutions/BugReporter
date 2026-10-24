/**
 * GET  /api/internal/ai-engine/task-builder/versions?job_type=…  — version history
 * POST /api/internal/ai-engine/task-builder/versions              — save a draft
 *
 * A draft is stored as a new version and does NOT change the live task. It
 * goes live only after a passing test run (test runner: later PR).
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { JOB_TYPE_RE, listVersions, recipeSchema, saveDraft } from '@/lib/ai-engine/task-builder';
import { caller, fail, respond } from '../_shared';

export const dynamic = 'force-dynamic';

const draftSchema = z.object({
  job_type: z.string().regex(JOB_TYPE_RE),
  recipe: recipeSchema
});

export async function GET(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const jobType = request.nextUrl.searchParams.get('job_type') ?? '';
  if (!JOB_TYPE_RE.test(jobType)) return fail('BAD_REQUEST', 'Which task?', 400);
  return respond(await listVersions(c.admin, c.actor, jobType));
}

export async function POST(request: NextRequest) {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Some fields are missing or not valid.', 400);
  return respond(await saveDraft(c.admin, c.actor, parsed.data), 201);
}
