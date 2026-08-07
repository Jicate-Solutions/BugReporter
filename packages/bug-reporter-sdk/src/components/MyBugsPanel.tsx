'use client';

import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Filter,
  Paperclip,
  X,
} from 'lucide-react';
import type { BugReport } from '@boobalan_jkkn/shared';
import { useBugReporter } from '../hooks/useBugReporter';

const styles: Record<string, CSSProperties> = {
  container: { padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' },
  header: { marginBottom: '1.5rem' },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    marginBottom: '0.5rem',
    margin: '0 0 0.5rem 0',
    color: '#111827',
  },
  description: { color: '#6b7280', fontSize: '0.9375rem', margin: 0 },
  filterBar: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  filterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
  },
  filterButton: {
    padding: '0.5rem 1rem',
    border: '1px solid #e5e7eb',
    borderRadius: '0.375rem',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    transition: 'all 0.2s',
    color: '#6b7280',
  },
  filterButtonActive: {
    backgroundColor: '#16a34a',
    color: 'white',
    borderColor: '#16a34a',
  },
  statsBar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '0.5rem',
    flexWrap: 'wrap',
  },
  statItem: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  statValue: { fontSize: '1.5rem', fontWeight: '700', color: '#111827' },
  loading: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  error: {
    textAlign: 'center',
    padding: '2rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '0.5rem',
    color: '#dc2626',
  },
  empty: { textAlign: 'center', padding: '4rem 2rem', color: '#6b7280' },
  bugCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '0.75rem',
    padding: '1.25rem',
    marginBottom: '1rem',
    backgroundColor: 'white',
    transition: 'all 0.2s',
    cursor: 'pointer',
  },
  bugCardHover: {
    boxShadow:
      '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    borderColor: '#d1d5db',
  },
  bugHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '0.75rem',
    gap: '1rem',
  },
  bugTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 0.5rem 0',
    flex: 1,
  },
  bugId: {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    fontWeight: '500',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '0.25rem 0.5rem',
    borderRadius: '0.25rem',
  },
  badgeContainer: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badgeBase: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.375rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.025em',
  },
  bugDescription: {
    fontSize: '0.9375rem',
    color: '#4b5563',
    lineHeight: '1.6',
    marginBottom: '0.75rem',
    margin: '0 0 0.75rem 0',
  },
  bugMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    fontSize: '0.8125rem',
    color: '#6b7280',
    marginBottom: '0.75rem',
  },
  metaItem: { display: 'flex', alignItems: 'center', gap: '0.375rem' },
  expandButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem',
    marginTop: '0.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#16a34a',
    width: '100%',
    justifyContent: 'center',
    transition: 'background-color 0.2s',
  },
  expandedContent: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '1px solid #e5e7eb',
  },
  attachmentsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '0.75rem',
    marginTop: '0.75rem',
  },
  attachmentCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    padding: '0.75rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: 'white',
  },
  attachmentPreview: {
    width: '100%',
    height: '80px',
    objectFit: 'cover',
    borderRadius: '0.375rem',
    marginBottom: '0.5rem',
  },
  attachmentIcon: {
    width: '100%',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: '0.375rem',
    marginBottom: '0.5rem',
  },
  attachmentName: {
    fontSize: '0.75rem',
    color: '#374151',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  detailsSection: { marginTop: '0.75rem' },
  detailsTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem',
    margin: '0 0 0.5rem 0',
  },
  detailsContent: {
    fontSize: '0.875rem',
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    padding: '0.75rem',
    borderRadius: '0.375rem',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
  },
};

/*
  RECONSTRUCTION NOTE — the status vocabulary below is wrong, deliberately kept.

  This file reproduces the published 1.3.2 build exactly, including a bug: it
  styles, counts and filters by `open` and `closed`, which the database has never
  held. The real values are new | seen | in_progress | resolved | wont_fix,
  enforced by a CHECK constraint. So "Open" reads 0 forever, two filter buttons
  match nothing, and new/seen/wont_fix are unreachable.

  It is faithful on purpose: rebuilding this package has to be diffable against
  the published bundle to prove the recovery, and fixing behaviour in the same
  pass would make a reconstruction error indistinguishable from an intended
  change. The fix lands separately, on top of a verified baseline.

  `string` rather than BugReportStatus for the same reason — the real union does
  not contain these values and would not compile.
*/
const getStatusBadgeStyle = (status: string): CSSProperties => ({
  ...styles.badgeBase,
  backgroundColor:
    status === 'resolved'
      ? '#d1fae5'
      : status === 'in_progress'
        ? '#fef3c7'
        : status === 'open'
          ? '#dbeafe'
          : status === 'closed'
            ? '#f3f4f6'
            : '#f3f4f6',
  color:
    status === 'resolved'
      ? '#065f46'
      : status === 'in_progress'
        ? '#92400e'
        : status === 'open'
          ? '#1e40af'
          : status === 'closed'
            ? '#374151'
            : '#374151',
});

const getCategoryBadgeStyle = (category: string): CSSProperties => ({
  ...styles.badgeBase,
  backgroundColor:
    category === 'bug'
      ? '#fee2e2'
      : category === 'feature_request'
        ? '#ede9fe'
        : category === 'ui_design'
          ? '#fef3c7'
          : category === 'performance'
            ? '#fef9c3'
            : category === 'security'
              ? '#cffafe'
              : '#f3f4f6',
  color:
    category === 'bug'
      ? '#991b1b'
      : category === 'feature_request'
        ? '#5b21b6'
        : category === 'ui_design'
          ? '#92400e'
          : category === 'performance'
            ? '#854d0e'
            : category === 'security'
              ? '#155e75'
              : '#374151',
});

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};

const isImage = (filetype: string) => filetype.startsWith('image/');

/**
 * The reporter's own bug reports, as a standalone panel.
 *
 * Reconstructed from the published 1.3.2 bundle. Exported from the package but
 * mounted only where an application chooses to render it.
 */
export function MyBugsPanel() {
  const { apiClient, config } = useBugReporter();
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedBugs, setExpandedBugs] = useState<Set<string>>(new Set());
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBugs() {
      if (!apiClient) {
        setError('Bug Reporter not initialized');
        setIsLoading(false);
        return;
      }
      try {
        const data = await apiClient.getMyBugReports();
        setBugs(data.bug_reports);
        setError(null);
      } catch (err) {
        console.error('[BugReporter SDK] Failed to fetch bugs:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load bug reports'
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchBugs();
  }, [apiClient]);

  const toggleExpanded = (bugId: string) => {
    setExpandedBugs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(bugId)) {
        newSet.delete(bugId);
      } else {
        newSet.add(bugId);
      }
      return newSet;
    });
  };

  const filteredBugs =
    statusFilter === 'all'
      ? bugs
      : bugs.filter((bug) => bug.status === statusFilter);

  // See the reconstruction note above: `open` is not a status the database has,
  // so this counter has always read zero.
  const stats = {
    total: bugs.length,
    open: bugs.filter((b) => b.status === ('open' as string)).length,
    inProgress: bugs.filter((b) => b.status === 'in_progress').length,
    resolved: bugs.filter((b) => b.status === 'resolved').length,
  };

  if (!config.enabled) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Bug Reports</h1>
        <p style={styles.description}>
          Track your submitted bug reports and their status
        </p>
      </div>

      {isLoading && (
        <div style={styles.loading}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔄</div>
          Loading your bug reports...
        </div>
      )}

      {error && (
        <div style={styles.error}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!isLoading && !error && (
        <>
          {bugs.length > 0 && (
            <div style={styles.statsBar}>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Total</span>
                <span style={styles.statValue}>{stats.total}</span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Open</span>
                <span style={{ ...styles.statValue, color: '#2563eb' }}>
                  {stats.open}
                </span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>In Progress</span>
                <span style={{ ...styles.statValue, color: '#f59e0b' }}>
                  {stats.inProgress}
                </span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Resolved</span>
                <span style={{ ...styles.statValue, color: '#16a34a' }}>
                  {stats.resolved}
                </span>
              </div>
            </div>
          )}

          {bugs.length > 0 && (
            <div style={styles.filterBar}>
              <div style={styles.filterLabel}>
                <Filter size={16} />
                Filter:
              </div>
              {['all', 'open', 'in_progress', 'resolved', 'closed'].map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    style={{
                      ...styles.filterButton,
                      ...(statusFilter === status
                        ? styles.filterButtonActive
                        : {}),
                    }}
                    onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                      if (statusFilter !== status) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                      if (statusFilter !== status) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {status === 'all' ? 'All' : status.replace('_', ' ')}
                  </button>
                )
              )}
              {statusFilter !== 'all' && (
                <button
                  onClick={() => setStatusFilter('all')}
                  style={{
                    ...styles.filterButton,
                    color: '#dc2626',
                    padding: '0.5rem',
                  }}
                  onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.backgroundColor = '#fee2e2';
                  }}
                  onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
                  aria-label="Clear filter"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}

          {filteredBugs.length === 0 && bugs.length === 0 && (
            <div style={styles.empty}>
              <p
                style={{
                  fontSize: '3rem',
                  marginBottom: '0.5rem',
                  margin: '0 0 0.5rem 0',
                }}
              >
                🐛
              </p>
              <p
                style={{
                  fontSize: '1.125rem',
                  fontWeight: '600',
                  margin: '0 0 0.5rem 0',
                }}
              >
                No bug reports yet
              </p>
              <p style={{ fontSize: '0.9375rem', margin: '0.25rem 0 0 0' }}>
                Found a bug? Click the bug button to report it!
              </p>
            </div>
          )}

          {filteredBugs.length === 0 && bugs.length > 0 && (
            <div style={styles.empty}>
              <p
                style={{
                  fontSize: '2rem',
                  marginBottom: '0.5rem',
                  margin: '0 0 0.5rem 0',
                }}
              >
                🔍
              </p>
              <p
                style={{
                  fontSize: '1.125rem',
                  fontWeight: '600',
                  margin: '0 0 0.5rem 0',
                }}
              >
                No {statusFilter} reports found
              </p>
              <p style={{ fontSize: '0.9375rem', margin: '0.25rem 0 0 0' }}>
                Try a different filter
              </p>
            </div>
          )}

          {filteredBugs.length > 0 && (
            <div>
              {filteredBugs.map((bug) => {
                const isExpanded = expandedBugs.has(bug.id);
                const isHovered = hoveredCard === bug.id;
                const title =
                  (bug.metadata as { title?: string } | undefined)?.title ||
                  'Untitled Bug Report';
                const attachments = bug.attachments || [];

                return (
                  <div
                    key={bug.id}
                    style={{
                      ...styles.bugCard,
                      ...(isHovered ? styles.bugCardHover : {}),
                    }}
                    onMouseEnter={() => setHoveredCard(bug.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                    onClick={() => toggleExpanded(bug.id)}
                  >
                    <div style={styles.bugHeader}>
                      <div style={{ flex: 1 }}>
                        <h3 style={styles.bugTitle}>{title}</h3>
                        <div style={styles.badgeContainer}>
                          <span style={getStatusBadgeStyle(bug.status)}>
                            {bug.status === 'in_progress'
                              ? 'In Progress'
                              : bug.status}
                          </span>
                          <span style={getCategoryBadgeStyle(bug.category)}>
                            {bug.category.replace('_', ' ')}
                          </span>
                          {attachments.length > 0 && (
                            <span
                              style={{
                                ...styles.badgeBase,
                                backgroundColor: '#f3f4f6',
                                color: '#6b7280',
                              }}
                            >
                              <Paperclip size={12} />
                              {attachments.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={styles.bugId}>#{bug.id.substring(0, 8)}</span>
                    </div>

                    <p style={styles.bugDescription}>
                      {isExpanded
                        ? bug.description
                        : bug.description.length > 200
                          ? `${bug.description.substring(0, 200)}...`
                          : bug.description}
                    </p>

                    <div style={styles.bugMeta}>
                      <div style={styles.metaItem}>
                        📅 {formatDate(bug.created_at)}
                      </div>
                      <div style={styles.metaItem}>
                        🔗 {new URL(bug.page_url).pathname}
                      </div>
                      {bug.priority && (
                        <div style={styles.metaItem}>⚡ {bug.priority}</div>
                      )}
                    </div>

                    {isExpanded && (
                      <div
                        style={styles.expandedContent}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {attachments.length > 0 && (
                          <div style={styles.detailsSection}>
                            <h4 style={styles.detailsTitle}>
                              <Paperclip
                                size={14}
                                style={{
                                  display: 'inline',
                                  marginRight: '0.375rem',
                                }}
                              />
                              Attachments ({attachments.length})
                            </h4>
                            <div style={styles.attachmentsGrid}>
                              {attachments.map((attachment, index) => (
                                <a
                                  key={index}
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    ...styles.attachmentCard,
                                    textDecoration: 'none',
                                  }}
                                  onMouseEnter={(
                                    e: MouseEvent<HTMLAnchorElement>
                                  ) => {
                                    e.currentTarget.style.borderColor =
                                      '#16a34a';
                                    e.currentTarget.style.backgroundColor =
                                      '#f0fdf4';
                                  }}
                                  onMouseLeave={(
                                    e: MouseEvent<HTMLAnchorElement>
                                  ) => {
                                    e.currentTarget.style.borderColor =
                                      '#e5e7eb';
                                    e.currentTarget.style.backgroundColor =
                                      'white';
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {isImage(attachment.filetype) &&
                                  attachment.url ? (
                                    <img
                                      src={attachment.url}
                                      alt={attachment.filename}
                                      style={styles.attachmentPreview}
                                    />
                                  ) : (
                                    <div style={styles.attachmentIcon}>
                                      {attachment.filetype ===
                                      'application/pdf' ? (
                                        <FileText size={32} color="#dc2626" />
                                      ) : (
                                        <Paperclip size={32} color="#6b7280" />
                                      )}
                                    </div>
                                  )}
                                  <p
                                    style={styles.attachmentName}
                                    title={attachment.filename}
                                  >
                                    {attachment.filename}
                                  </p>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={styles.detailsSection}>
                          <h4 style={styles.detailsTitle}>Page URL</h4>
                          <a
                            href={bug.page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.875rem',
                              color: '#16a34a',
                              textDecoration: 'none',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.375rem',
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {bug.page_url}
                            <ExternalLink size={14} />
                          </a>
                        </div>

                        {bug.screenshot_url && (
                          <div style={styles.detailsSection}>
                            <h4 style={styles.detailsTitle}>Screenshot</h4>
                            <a
                              href={bug.screenshot_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <img
                                src={bug.screenshot_url}
                                alt="Bug screenshot"
                                style={{
                                  width: '100%',
                                  borderRadius: '0.5rem',
                                  border: '1px solid #e5e7eb',
                                  cursor: 'pointer',
                                }}
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      style={styles.expandButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(bug.id);
                      }}
                      onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                        e.currentTarget.style.backgroundColor = '#f0fdf4';
                      }}
                      onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {isExpanded ? (
                        <>
                          Show Less <ChevronUp size={16} />
                        </>
                      ) : (
                        <>
                          Show More <ChevronDown size={16} />
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
