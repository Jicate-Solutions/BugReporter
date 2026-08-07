export { BugReporterProvider } from './components/BugReporterProvider';
export type {
  BugReporterConfig,
  BugReporterContextValue,
  BugReporterProviderProps,
} from './components/BugReporterProvider';

export { BugReporterWidget } from './components/BugReporterWidget';
export { useBugReporter } from './hooks/useBugReporter';
export type { ApiClientConfig } from './api/client';

// TODO(reconstruction): MyBugsPanel and LeaderboardPanel are still being
// recovered from the published bundle. The published .d.ts exports both, so
// this barrel is incomplete until they land — do not publish from here yet.

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
