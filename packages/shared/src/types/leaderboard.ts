// Leaderboard entry for a user
export interface LeaderboardEntry {
  reporter_email: string;
  reporter_name?: string;
  total_bugs: number;
  total_points: number;
  rank: number;
}

// Leaderboard configuration
export interface LeaderboardConfig {
  id: string;
  organization_id: string;
  weekly_prize_amount: number;
  monthly_prize_amount: number;
  prize_description?: string;
  points_critical: number;
  points_high: number;
  points_medium: number;
  points_low: number;
  is_enabled: boolean;
  reset_frequency: 'weekly' | 'monthly' | 'never';
  created_at: string;
  updated_at: string;
}

// Update leaderboard config payload
export interface UpdateLeaderboardConfigPayload {
  organization_id: string;
  weekly_prize_amount?: number;
  monthly_prize_amount?: number;
  prize_description?: string;
  points_critical?: number;
  points_high?: number;
  points_medium?: number;
  points_low?: number;
  is_enabled?: boolean;
  reset_frequency?: 'weekly' | 'monthly' | 'never';
}

// Time period for leaderboard filtering
export type LeaderboardTimePeriod = 'week' | 'month' | 'all-time';

// =============================================
// PUBLIC API TYPES
// =============================================
//
// Distinct from LeaderboardEntry above, which is the internal shape keyed by
// reporter_email. These are what /api/v1/public/leaderboard returns to the SDK,
// keyed by user_id — the two are not interchangeable and never were. They were
// lost from this package while the published SDK carried on importing them, so
// the SDK could not be compiled against it at all.

/**
 * Leaderboard entry returned by public API
 */
export interface PublicLeaderboardEntry {
  user_id: string;
  email: string | null;
  full_name: string;
  avatar_url: string | null;
  total_points: number;
  total_bugs: number;
  rank: number;
}

/**
 * Leaderboard API response
 */
export interface GetLeaderboardResponse {
  enabled: boolean;
  leaderboard: PublicLeaderboardEntry[];
  period: 'all-time' | 'weekly' | 'monthly';
  config?: {
    points_low: number;
    points_medium: number;
    points_high: number;
    points_critical: number;
    weekly_prize_amount: number;
    monthly_prize_amount: number;
    prize_description: string | null;
  };
  message?: string;
}
