export { BugReporterProvider } from './components/BugReporterProvider';

// Only BugReporterConfig is public. BugReporterContextValue and
// BugReporterProviderProps are declared but deliberately not re-exported —
// the published 1.3.2 declaration does not export them, and widening the
// public surface during a reconstruction is a change, not a recovery.
export type { BugReporterConfig } from './components/BugReporterProvider';

export { BugReporterWidget } from './components/BugReporterWidget';
export { MyBugsPanel } from './components/MyBugsPanel';
export { LeaderboardPanel } from './components/LeaderboardPanel';
export type { LeaderboardPanelProps } from './components/LeaderboardPanel';

export { useBugReporter } from './hooks/useBugReporter';
export type { ApiClientConfig } from './api/client';

// Re-exported for consumers, matching the published surface.
export type {
  ApiResponse,
  Attachment,
  BugReport,
  BugReportCategory,
  BugReportMessage,
  BugReportStatus,
  GetBugReportDetailsResponse,
  GetLeaderboardResponse,
  GetMyBugReportsResponse,
  PublicLeaderboardEntry,
  SendBugReportMessageRequest,
  SendBugReportMessageResponse,
  SubmitBugReportRequest,
  SubmitBugReportResponse,
} from '@boobalan_jkkn/shared';
