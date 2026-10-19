import type {
  BugReport,
  GetBugReportDetailsResponse,
  GetLeaderboardResponse,
  GetMyBugReportsResponse,
  SendBugReportMessageResponse,
  SubmitBugReportRequest,
} from '@boobalan_jkkn/shared';

export interface ApiClientConfig {
  apiUrl: string;
  apiKey: string;
  debug?: boolean;
}

/**
 * Abandon a request after this long.
 *
 * Generous because a submission carries a full-page screenshot as a base64 data
 * URL, which on a slow connection is a genuinely large upload.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** The envelope every /api/v1/public route replies with. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { message?: string };
}

/**
 * The SDK's HTTP client for the public API.
 *
 * Reconstructed from the published 1.3.2 bundle after the original repository
 * was lost; the shape is pinned by the `.d.ts` that shipped alongside it, which
 * is the contract the consuming applications compile against.
 */
export class BugReporterApiClient {
  constructor(private config: ApiClientConfig) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
      ...options.headers,
    };

    if (this.config.debug) {
      console.log('[BugReporter SDK] Request:', {
        url,
        method: options.method || 'GET',
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = (await response.json()) as ApiEnvelope<T>;

      // Both conditions matter: the route can answer 200 with success:false.
      if (!response.ok || !data.success) {
        const errorMessage = data.error?.message || `HTTP ${response.status}`;
        const error = new Error(errorMessage);
        if (this.config.debug) {
          console.error('[BugReporter SDK] Error:', data.error);
        }
        throw error;
      }

      if (this.config.debug) {
        console.log('[BugReporter SDK] Response:', data.data);
      }

      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        const timeoutError = new Error(
          'Request timeout - the request took longer than 60 seconds'
        );
        if (this.config.debug) {
          console.error('[BugReporter SDK] Timeout error');
        }
        throw timeoutError;
      }
      throw error;
    }
  }

  /**
   * Submit a new bug report
   */
  async createBugReport(payload: SubmitBugReportRequest): Promise<BugReport> {
    const response = await this.request<{ bug_report: BugReport }>(
      '/api/v1/public/bug-reports',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return response.bug_report;
  }

  /**
   * Get all bug reports for this application
   */
  async getMyBugReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
    search?: string;
  }): Promise<GetMyBugReportsResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.status) params.append('status', options.status);
    if (options?.category) params.append('category', options.category);
    if (options?.search) params.append('search', options.search);

    const queryString = params.toString();
    const endpoint = queryString
      ? `/api/v1/public/bug-reports/me?${queryString}`
      : '/api/v1/public/bug-reports/me';

    return this.request<GetMyBugReportsResponse>(endpoint);
  }

  /**
   * Get details of a specific bug report
   */
  async getBugReportById(
    id: string,
    includeMessages = true
  ): Promise<GetBugReportDetailsResponse> {
    const params = new URLSearchParams();
    if (!includeMessages) params.append('include_messages', 'false');

    const queryString = params.toString();
    const endpoint = queryString
      ? `/api/v1/public/bug-reports/${id}?${queryString}`
      : `/api/v1/public/bug-reports/${id}`;

    return this.request<GetBugReportDetailsResponse>(endpoint);
  }

  /**
   * Send a message on a bug report
   */
  async sendMessage(
    bugReportId: string,
    messageText: string,
    attachments?: string[]
  ): Promise<SendBugReportMessageResponse> {
    const payload = {
      bug_report_id: bugReportId,
      message: messageText,
      attachments,
    };

    return this.request<SendBugReportMessageResponse>(
      `/api/v1/public/bug-reports/${bugReportId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * Get leaderboard for the current application
   */
  async getLeaderboard(
    applicationId: string,
    options?: {
      period?: 'all-time' | 'weekly' | 'monthly';
      limit?: number;
    }
  ): Promise<GetLeaderboardResponse> {
    const params = new URLSearchParams();
    if (options?.period) params.append('period', options.period);
    if (options?.limit) params.append('limit', options.limit.toString());

    const queryString = params.toString();
    const endpoint = queryString
      ? `/api/v1/public/leaderboard/${applicationId}?${queryString}`
      : `/api/v1/public/leaderboard/${applicationId}`;

    return this.request<GetLeaderboardResponse>(endpoint);
  }
}
