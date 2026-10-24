import { describe, it, expect } from 'vitest';
import { legacyUsageParams, usageParams, usageSchema } from '@/lib/ai-engine/usage';

/**
 * Guards the API-price ledger (2026-10-24): the worker's usage block (PR #76)
 * must reach fn_ai_engine_complete with api_cost_usd, cache tokens and the
 * account, and a database without the new params must still get the old ten.
 */
const workerUsage = {
  model_id: 'claude-sonnet-5-5',
  input_tokens: 12,
  output_tokens: 340,
  api_cost_usd: 0.018734,
  cache_read_tokens: 15000,
  cache_write_tokens: 2100,
  limits: { five_hour: 0.4, seven_day: 0.2, five_hour_resets_at: 1761300000, seven_day_resets_at: null, overage_enabled: false },
  account: 'aimech',
  duration_ms: 8123
};

describe('usageSchema', () => {
  it('keeps the API price and cache tokens the worker sends', () => {
    const u = usageSchema.parse(workerUsage);
    expect(u.api_cost_usd).toBe(0.018734);
    expect(u.cache_read_tokens).toBe(15000);
    expect(u.cache_write_tokens).toBe(2100);
  });

  it('accepts a usage block from an older worker with none of them', () => {
    expect(usageSchema.safeParse({ model_id: 'x', input_tokens: 1, output_tokens: 2 }).success).toBe(true);
  });

  it('accepts null price fields (the CLI did not report them)', () => {
    expect(usageSchema.safeParse({ api_cost_usd: null, cache_read_tokens: null }).success).toBe(true);
  });

  it('rejects a negative or absurd price and a bad account label', () => {
    expect(usageSchema.safeParse({ api_cost_usd: -1 }).success).toBe(false);
    expect(usageSchema.safeParse({ api_cost_usd: 5000 }).success).toBe(false);
    expect(usageSchema.safeParse({ cache_read_tokens: 1.5 }).success).toBe(false);
    expect(usageSchema.safeParse({ account: 'Bad Label' }).success).toBe(false);
  });
});

describe('usageParams', () => {
  it('maps every stored field onto the function params', () => {
    expect(usageParams(usageSchema.parse(workerUsage))).toEqual({
      p_model_id: 'claude-sonnet-5-5',
      p_input_tokens: 12,
      p_output_tokens: 340,
      p_duration_ms: 8123,
      p_api_cost_usd: 0.018734,
      p_cache_read_tokens: 15000,
      p_cache_write_tokens: 2100,
      p_account: 'aimech'
    });
  });

  it('sends nulls, never undefined, when usage is missing', () => {
    const p = usageParams(undefined);
    expect(Object.values(p).every((v) => v === null)).toBe(true);
  });

  it('drops only the four new params for a database the migration has not reached', () => {
    expect(Object.keys(legacyUsageParams(usageSchema.parse(workerUsage))).sort()).toEqual(
      ['p_duration_ms', 'p_input_tokens', 'p_model_id', 'p_output_tokens']
    );
  });
});
