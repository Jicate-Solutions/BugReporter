// Public API Request/Response Types
// Used by the SDK to communicate with the platform

import { BugReport, BugReportCategory, CreateBugReportPayload } from './bug-reports';
import { EnhancedBugReportMessage } from './messaging';
import type { Application } from './applications';

// =============================================
// NETWORK TRACE TYPES (SDK Capture)
// =============================================

export interface NetworkRequest {
  id?: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  duration_ms: number;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  timestamp: string;
  error?: string;
  request_body_size?: number;
  response_body_size?: number;
}

// =============================================
// FILE ATTACHMENTS
// =============================================

/**
 * File attachment for bug reports
 */
export interface Attachment {
  filename: string;            // Original filename
  filesize: number;            // File size in bytes
  filetype: string;            // MIME type (e.g., 'image/png', 'text/plain')
  data_url?: string;           // Base64 data URL for upload (client → server)
  url?: string;                // Public URL after upload (server → client)
}

// =============================================
// API RESPONSE WRAPPER
// =============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface PaginatedApiResponse<T = any> extends ApiResponse<T> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// =============================================
// API ERROR CODES
// =============================================

export const API_ERROR_CODES = {
  // Authentication
  INVALID_API_KEY: 'INVALID_API_KEY',
  MISSING_API_KEY: 'MISSING_API_KEY',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',

  // Authorization
  FORBIDDEN: 'FORBIDDEN',
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
  APPLICATION_NOT_FOUND: 'APPLICATION_NOT_FOUND',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // Resources
  BUG_REPORT_NOT_FOUND: 'BUG_REPORT_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',

  // Feature gating — the application has not opted into this capability
  FEATURE_NOT_ENABLED: 'FEATURE_NOT_ENABLED',

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// =============================================
// BUG REPORT SUBMISSION
// =============================================

export interface SubmitBugReportRequest {
  // Bug details
  title: string;
  description: string;
  category?: BugReportCategory;

  // Context
  page_url: string;
  screenshot_data_url?: string;

  // System information
  browser_info?: {
    name?: string;
    version?: string;
    os?: string;
    user_agent?: string;
  };
  system_info?: {
    platform?: string;
    screen_resolution?: string;
    viewport?: string;
    language?: string;
  };
  console_logs?: Array<{
    // 'debug' included: the widget patches console.debug and ships it too.
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    message: string;
    timestamp: string;
  }>;

  // Network trace (captured by SDK)
  network_trace?: NetworkRequest[];

  // File attachments
  attachments?: Attachment[];

  // Reporter information (optional)
  reporter_name?: string;
  reporter_email?: string;

  // Custom metadata
  metadata?: Record<string, any>;
}

export interface SubmitBugReportResponse {
  bug_report: BugReport;
  message: string;
}

// =============================================
// GET USER'S BUG REPORTS
// =============================================

export interface GetMyBugReportsRequest {
  // Pagination
  page?: number;
  limit?: number;

  // Filters
  status?: 'new' | 'seen' | 'in_progress' | 'resolved' | 'wont_fix';
  category?: BugReportCategory;
  search?: string;

  // Sorting
  sort_by?: 'created_at' | 'updated_at' | 'priority';
  sort_order?: 'asc' | 'desc';
}

export interface GetMyBugReportsResponse {
  bug_reports: BugReport[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// =============================================
// GET BUG REPORT DETAILS
// =============================================

export interface GetBugReportDetailsRequest {
  id: string;
  include_messages?: boolean;
}

export interface GetBugReportDetailsResponse {
  bug_report: BugReport;
  messages?: EnhancedBugReportMessage[];
}

// =============================================
// UPDATE BUG REPORT STATUS (Public API)
// =============================================

export interface UpdateBugReportStatusRequest {
  status?: 'new' | 'seen' | 'in_progress' | 'resolved' | 'wont_fix';
  resolution_notes?: string;
}

export interface UpdateBugReportStatusResponse {
  bug_report: BugReport;
  message: string;
}

// =============================================
// SEND MESSAGE
// =============================================

export interface SendBugReportMessageRequest {
  bug_report_id: string;
  message: string;
  attachments?: string[]; // URLs to uploaded attachments
}

export interface SendBugReportMessageResponse {
  message: EnhancedBugReportMessage;
  success: boolean;
}

// =============================================
// API KEY VALIDATION
// =============================================

export interface ValidatedApiKey {
  id: string;
  application_id: string;
  organization_id: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
}

// =============================================
// API REQUEST CONTEXT
// =============================================

export interface ApiRequestContext {
  api_key: ValidatedApiKey;
  application: {
    id: string;
    name: string;
    slug: string;
    organization_id: string;
    /** Per-app config, including the bug_portal opt-in flags. */
    settings?: Application['settings'];
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  request_ip?: string;
  user_agent?: string;
}
