/**
 * The `usage` block a runner sends to /complete, and how it maps onto
 * fn_ai_engine_complete. Kept out of the route so it can be tested.
 *
 * api_cost_usd is what the Claude API would have charged for the run (the CLI's
 * total_cost_usd, list price, cache included). On the Max plan we pay nothing
 * extra per run; billing uses it as "API price" (20261024_usage_api_cost.sql).
 */

import { z } from 'zod';

const intOrNull = z.number().int().nonnegative().max(2_000_000_000).nullable().optional();

export const ACCOUNT_LABEL = /^[a-z0-9][a-z0-9-]{0,30}$/;

export const usageSchema = z.object({
  model_id: z.string().max(100).nullable().optional(),
  account: z.string().regex(ACCOUNT_LABEL).nullable().optional(),
  limits: z
    .object({
      five_hour: z.number().min(0).max(10).nullable().optional(),
      seven_day: z.number().min(0).max(10).nullable().optional(),
      five_hour_resets_at: z.number().int().positive().nullable().optional(),
      seven_day_resets_at: z.number().int().positive().nullable().optional(),
      overage_enabled: z.boolean().nullable().optional()
    })
    .nullable()
    .optional(),
  input_tokens: intOrNull,
  output_tokens: intOrNull,
  duration_ms: intOrNull,
  api_cost_usd: z.number().nonnegative().max(1_000).nullable().optional(),
  cache_read_tokens: intOrNull,
  cache_write_tokens: intOrNull
});

export type Usage = z.infer<typeof usageSchema>;

/** The usage params of fn_ai_engine_complete (the first ten are unchanged). */
export function usageParams(u: Usage | undefined) {
  return {
    p_model_id: u?.model_id ?? null,
    p_input_tokens: u?.input_tokens ?? null,
    p_output_tokens: u?.output_tokens ?? null,
    p_duration_ms: u?.duration_ms ?? null,
    p_api_cost_usd: u?.api_cost_usd ?? null,
    p_cache_read_tokens: u?.cache_read_tokens ?? null,
    p_cache_write_tokens: u?.cache_write_tokens ?? null,
    p_account: u?.account ?? null
  };
}

/** The four params the 20261024 migration added. */
export const NEW_USAGE_PARAMS = ['p_api_cost_usd', 'p_cache_read_tokens', 'p_cache_write_tokens', 'p_account'] as const;

/** usageParams without the new four, for a database the migration has not reached yet. */
export function legacyUsageParams(u: Usage | undefined) {
  const p: Record<string, unknown> = usageParams(u);
  for (const k of NEW_USAGE_PARAMS) delete p[k];
  return p;
}
