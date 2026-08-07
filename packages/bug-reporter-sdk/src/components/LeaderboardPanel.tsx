'use client';

import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Award, Calendar, Gift, Medal, TrendingUp, Trophy } from 'lucide-react';
import type { GetLeaderboardResponse } from '@boobalan_jkkn/shared';
import { useBugReporter } from '../hooks/useBugReporter';

type LeaderboardPeriod = 'all-time' | 'weekly' | 'monthly';

const styles: Record<string, CSSProperties> = {
  container: { padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' },
  header: { marginBottom: '1.5rem' },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.5rem',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    margin: 0,
    color: '#111827',
  },
  description: { color: '#6b7280', fontSize: '0.9375rem', margin: 0 },
  periodSelector: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    padding: '0.375rem',
    backgroundColor: '#f3f4f6',
    borderRadius: '0.5rem',
    width: 'fit-content',
  },
  periodButton: {
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: '0.375rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    transition: 'all 0.2s',
    color: '#6b7280',
  },
  periodButtonActive: {
    backgroundColor: '#16a34a',
    color: 'white',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  prizeCard: {
    backgroundColor: '#fef3c7',
    border: '1px solid #fbbf24',
    borderRadius: '0.75rem',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  prizeIcon: { flexShrink: 0 },
  prizeContent: { flex: 1 },
  prizeTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#92400e',
    margin: '0 0 0.25rem 0',
  },
  prizeAmount: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#92400e',
    margin: 0,
  },
  pointsInfo: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f0fdf4',
    borderRadius: '0.5rem',
    flexWrap: 'wrap',
  },
  pointItem: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  pointLabel: { fontSize: '0.75rem', color: '#166534', fontWeight: '500' },
  pointValue: { fontSize: '0.875rem', fontWeight: '700', color: '#15803d' },
  loading: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  error: {
    textAlign: 'center',
    padding: '2rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '0.5rem',
    color: '#dc2626',
  },
  disabled: {
    textAlign: 'center',
    padding: '3rem',
    backgroundColor: '#f9fafb',
    borderRadius: '0.75rem',
    color: '#6b7280',
  },
  empty: { textAlign: 'center', padding: '4rem 2rem', color: '#6b7280' },
  leaderboardTable: {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: 'white',
    borderRadius: '0.75rem',
    overflow: 'hidden',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
  },
  tableHeader: { backgroundColor: '#f9fafb' },
  tableHeaderCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tableRow: {
    borderTop: '1px solid #e5e7eb',
    transition: 'background-color 0.2s',
  },
  tableCell: { padding: '1rem', fontSize: '0.9375rem', color: '#374151' },
  rankCell: { width: '80px', fontWeight: '700', fontSize: '1.125rem' },
  userCell: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  avatar: {
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: '50%',
    backgroundColor: '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    color: '#6b7280',
    fontSize: '0.875rem',
    flexShrink: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    objectFit: 'cover',
  },
  userName: {
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 0.125rem 0',
  },
  userEmail: { fontSize: '0.8125rem', color: '#6b7280', margin: 0 },
  statsCell: { textAlign: 'right' },
  statValue: {
    fontWeight: '700',
    fontSize: '1.125rem',
    color: '#111827',
    margin: '0 0 0.125rem 0',
  },
  statLabel: { fontSize: '0.75rem', color: '#6b7280', margin: 0 },
  medalIcon: {
    width: '2rem',
    height: '2rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

const getRankColor = (rank: number): string => {
  if (rank === 1) return '#f59e0b';
  if (rank === 2) return '#9ca3af';
  if (rank === 3) return '#cd7f32';
  return '#6b7280';
};

const getRankIcon = (rank: number): ReactNode => {
  if (rank === 1) return <Trophy size={24} color="#f59e0b" />;
  if (rank === 2) return <Medal size={24} color="#9ca3af" />;
  if (rank === 3) return <Award size={24} color="#cd7f32" />;
  return <span style={{ color: getRankColor(rank) }}>#{rank}</span>;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const formatPrizeAmount = (amount: number): string => {
  if (amount === 0) return 'No prize';
  return `₹${amount.toLocaleString()}`;
};

export interface LeaderboardPanelProps {
  /**
   * Application ID to fetch leaderboard for
   */
  applicationId: string;
  /**
   * Maximum number of entries to display (default: 10)
   */
  limit?: number;
  /**
   * Initial period to display (default: 'all-time')
   */
  defaultPeriod?: LeaderboardPeriod;
}

/**
 * Top bug reporters, ranked by points.
 *
 * Reconstructed from the published 1.3.2 bundle. The panel renders whatever the
 * platform returns: if the organisation has the leaderboard switched off, the
 * response carries `enabled: false` and a message, and the panel says so rather
 * than showing an empty table.
 */
export function LeaderboardPanel({
  applicationId,
  limit = 10,
  defaultPeriod = 'all-time',
}: LeaderboardPanelProps) {
  const { apiClient, config } = useBugReporter();
  const [data, setData] = useState<GetLeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>(defaultPeriod);

  useEffect(() => {
    async function fetchLeaderboard() {
      if (!apiClient) {
        setError('Bug Reporter not initialized');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiClient.getLeaderboard(applicationId, {
          period,
          limit,
        });
        setData(response);
      } catch (err) {
        console.error('[BugReporter SDK] Failed to fetch leaderboard:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load leaderboard'
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchLeaderboard();
  }, [apiClient, applicationId, period, limit]);

  if (!config.enabled) return null;

  const periodLabels: Record<LeaderboardPeriod, string> = {
    'all-time': 'All Time',
    weekly: 'This Week',
    monthly: 'This Month',
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <Trophy size={32} color="#16a34a" strokeWidth={2.5} />
          <h1 style={styles.title}>Leaderboard</h1>
        </div>
        <p style={styles.description}>
          Top bug reporters ranked by points earned
        </p>
      </div>

      {isLoading && (
        <div style={styles.loading}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔄</div>
          Loading leaderboard...
        </div>
      )}

      {error && (
        <div style={styles.error}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {!data.enabled && (
            <div style={styles.disabled}>
              <Trophy
                size={48}
                color="#9ca3af"
                style={{ marginBottom: '1rem' }}
              />
              <p
                style={{
                  fontSize: '1.125rem',
                  fontWeight: '600',
                  margin: '0 0 0.5rem 0',
                }}
              >
                Leaderboard is disabled
              </p>
              <p style={{ fontSize: '0.9375rem', margin: 0 }}>
                {data.message ||
                  'The leaderboard feature is currently disabled for this organization.'}
              </p>
            </div>
          )}

          {data.enabled && (
            <>
              <div style={styles.periodSelector}>
                {(['all-time', 'weekly', 'monthly'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      ...styles.periodButton,
                      ...(period === p ? styles.periodButtonActive : {}),
                    }}
                  >
                    <Calendar
                      size={14}
                      style={{
                        display: 'inline',
                        marginRight: '0.375rem',
                        verticalAlign: 'text-bottom',
                      }}
                    />
                    {periodLabels[p]}
                  </button>
                ))}
              </div>

              {data.config && (period === 'weekly' || period === 'monthly') && (
                <div style={styles.prizeCard}>
                  <div style={styles.prizeIcon}>
                    <Gift size={32} color="#f59e0b" />
                  </div>
                  <div style={styles.prizeContent}>
                    <p style={styles.prizeTitle}>
                      {period === 'weekly' ? 'Weekly Prize' : 'Monthly Prize'}
                    </p>
                    <p style={styles.prizeAmount}>
                      {period === 'weekly'
                        ? formatPrizeAmount(data.config.weekly_prize_amount)
                        : formatPrizeAmount(data.config.monthly_prize_amount)}
                    </p>
                    {data.config.prize_description && (
                      <p
                        style={{
                          fontSize: '0.875rem',
                          color: '#92400e',
                          margin: '0.25rem 0 0 0',
                        }}
                      >
                        {data.config.prize_description}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {data.config && (
                <div style={styles.pointsInfo}>
                  <div style={styles.pointItem}>
                    <span style={styles.pointLabel}>Low Priority:</span>
                    <span style={styles.pointValue}>
                      {data.config.points_low} pts
                    </span>
                  </div>
                  <div style={styles.pointItem}>
                    <span style={styles.pointLabel}>Medium Priority:</span>
                    <span style={styles.pointValue}>
                      {data.config.points_medium} pts
                    </span>
                  </div>
                  <div style={styles.pointItem}>
                    <span style={styles.pointLabel}>High Priority:</span>
                    <span style={styles.pointValue}>
                      {data.config.points_high} pts
                    </span>
                  </div>
                  <div style={styles.pointItem}>
                    <span style={styles.pointLabel}>Critical Priority:</span>
                    <span style={styles.pointValue}>
                      {data.config.points_critical} pts
                    </span>
                  </div>
                </div>
              )}

              {data.leaderboard.length === 0 && (
                <div style={styles.empty}>
                  <TrendingUp
                    size={48}
                    color="#9ca3af"
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <p
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: '600',
                      margin: '0 0 0.5rem 0',
                    }}
                  >
                    No entries yet
                  </p>
                  <p style={{ fontSize: '0.9375rem', margin: 0 }}>
                    Be the first to report a bug and climb the leaderboard!
                  </p>
                </div>
              )}

              {data.leaderboard.length > 0 && (
                <table style={styles.leaderboardTable}>
                  <thead style={styles.tableHeader}>
                    <tr>
                      <th style={{ ...styles.tableHeaderCell, width: '80px' }}>
                        Rank
                      </th>
                      <th style={styles.tableHeaderCell}>Reporter</th>
                      <th
                        style={{
                          ...styles.tableHeaderCell,
                          textAlign: 'right',
                        }}
                      >
                        Bugs
                      </th>
                      <th
                        style={{
                          ...styles.tableHeaderCell,
                          textAlign: 'right',
                        }}
                      >
                        Points
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((entry) => (
                      <tr
                        key={entry.user_id}
                        style={styles.tableRow}
                        onMouseEnter={(e: MouseEvent<HTMLTableRowElement>) => {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }}
                        onMouseLeave={(e: MouseEvent<HTMLTableRowElement>) => {
                          e.currentTarget.style.backgroundColor = 'white';
                        }}
                      >
                        <td
                          style={{ ...styles.tableCell, ...styles.rankCell }}
                        >
                          <div style={styles.medalIcon}>
                            {getRankIcon(entry.rank)}
                          </div>
                        </td>
                        <td style={styles.tableCell}>
                          <div style={styles.userCell}>
                            <div style={styles.avatar}>
                              {entry.avatar_url ? (
                                <img
                                  src={entry.avatar_url}
                                  alt={entry.full_name}
                                  style={styles.avatarImage}
                                />
                              ) : (
                                getInitials(entry.full_name)
                              )}
                            </div>
                            <div>
                              <p style={styles.userName}>{entry.full_name}</p>
                              {entry.email && (
                                <p style={styles.userEmail}>{entry.email}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td
                          style={{ ...styles.tableCell, ...styles.statsCell }}
                        >
                          <p style={styles.statValue}>{entry.total_bugs}</p>
                          <p style={styles.statLabel}>bugs reported</p>
                        </td>
                        <td
                          style={{ ...styles.tableCell, ...styles.statsCell }}
                        >
                          <p style={{ ...styles.statValue, color: '#16a34a' }}>
                            {entry.total_points}
                          </p>
                          <p style={styles.statLabel}>total points</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
