import type { EnhancedBugReportMessage } from './messaging';
import type { NetworkRequest, Attachment } from './api';
import type { BugReportStatus } from '../constants/bug-status';

// Status lives in ../constants/bug-status.ts, which is the single source of truth
// and matches the database CHECK constraint. This module previously declared its
// own union (`open | in_progress | resolved | closed`) that the database has
// never accepted — re-exported here so existing importers keep working.
export type { BugReportStatus };

export type BugReportPriority = 'low' | 'medium' | 'high' | 'critical';

export type BugReportCategory =
  | 'ui'
  | 'functionality'
  | 'performance'
  | 'security'
  | 'other';

export interface BugReport {
  id: string;
  organization_id: string;
  application_id: string;

  // Bug information
  title: string;
  description: string;
  category: BugReportCategory;
  priority: BugReportPriority;
  status: BugReportStatus;

  // Reporter information
  reporter_name?: string | null;
  reporter_email?: string | null;
  reporter_user_id?: string | null;

  // System information
  browser_info?: any;
  system_info?: any;
  screenshot_url?: string | null;
  page_url: string;
  console_logs?: any;

  // File attachments (stored in JSONB)
  attachments?: Attachment[] | null;

  // Assignment
  assigned_to?: string | null;

  // Points for gamification
  points: number;

  // SDK Metadata (stored in JSONB)
  metadata?: {
    title?: string;
    reporter_name?: string | null;
    reporter_email?: string | null;
    browser_info?: string | null;
    system_info?: string | null;
    viewport?: { width: number; height: number } | null;
    screen_resolution?: { width: number; height: number } | null;
    timestamp?: string;
    network_trace?: NetworkRequest[] | null;
  } | null;

  // Status tracking
  is_resolved: boolean;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;

  // Optional relations (populated via joins)
  application?: {
    id: string;
    name: string;
    slug: string;
  };
  organization?: {
    id: string;
    name: string;
  };
  assigned_user?: {
    id: string;
    email: string;
    raw_user_meta_data?: any;
  };
  messages?: EnhancedBugReportMessage[];
}

export interface BugReportMessage {
  id: string;
  bug_report_id: string;
  user_id?: string | null;
  message: string;
  created_at: string;

  // Optional relations (populated via joins)
  user?: {
    id: string;
    email: string;
    full_name?: string | null;
  }[];
}

export interface BugReportParticipant {
  id: string;
  bug_report_id: string;
  user_id: string;
  added_at: string;
}

export interface BugReportFilters {
  organization_id?: string;
  application_id?: string;
  status?: BugReportStatus;
  category?: BugReportCategory;
  priority?: BugReportPriority;
  assigned_to?: string;
  search?: string;
  sort_by?: 'created_at' | 'updated_at' | 'priority' | 'status';
  sort_order?: 'asc' | 'desc';
}

export interface BugReportStats {
  total: number;
  by_status: Record<BugReportStatus, number>;
  by_priority: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  by_category: {
    ui: number;
    functionality: number;
    performance: number;
    security: number;
    other: number;
  };
  recent_count: number;
}

// SDK-specific types
export interface CreateBugReportPayload {
  page_url: string;
  title: string;
  description: string;
  category?: BugReportCategory;
  screenshot_data_url?: string;
  console_logs?: any[];
  metadata?: object;

  // User context (optional, provided by SDK)
  user_email?: string;
  user_name?: string;
  user_id?: string;
}

export interface UpdateBugReportPayload {
  id: string;
  title?: string;
  description?: string;
  category?: BugReportCategory;
  priority?: BugReportPriority;
  status?: BugReportStatus;
  assigned_to?: string | null;
  points?: number;
}
