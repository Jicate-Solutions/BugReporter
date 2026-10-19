import { createClient } from '@/lib/supabase/server';
import type { BugReport, BugReportStats, BugReportStatus } from '@boobalan_jkkn/shared';
import {
  BUG_REPORT_CATEGORIES,
  BUG_STATUSES,
  type BugReportCategory,
} from '@boobalan_jkkn/shared';

export class BugReportServerService {
  /**
   * Get bug report by ID
   */
  static async getBugReportById(id: string): Promise<BugReport | null> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('bug_reports')
        .select(
          `
          *,
          application:applications(id, name, slug),
          organization:organizations(id, name)
        `
        )
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.warn(`[BugReportServerService] Bug report not found: ${id}`);
          return null;
        }
        throw error;
      }

      // Extract metadata fields to top level
      const transformedData = {
        ...data,
        title: data.metadata?.title || 'Untitled',
        reporter_name: data.metadata?.reporter_name || null,
        reporter_email: data.metadata?.reporter_email || null,
      };

      return transformedData;
    } catch (error) {
      console.error('[BugReportServerService] Error fetching bug report by ID:', error);
      throw error;
    }
  }

  /**
   * Get recent bug reports for a single application, newest first.
   */
  static async getRecentByApplication(
    applicationId: string,
    limit = 5
  ): Promise<BugReport[]> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('bug_reports')
        .select(
          `
          *,
          application:applications(id, name, slug)
        `
        )
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((bug) => ({
        ...bug,
        title: bug.metadata?.title || 'Untitled',
        reporter_name: bug.metadata?.reporter_name || null,
        reporter_email: bug.metadata?.reporter_email || null,
      }));
    } catch (error) {
      console.error(
        '[BugReportServerService] Error fetching recent bugs by application:',
        error
      );
      throw error;
    }
  }

  /**
   * Get bug report statistics for an organization
   */
  static async getBugStats(organizationId: string): Promise<BugReportStats> {
    try {
      const supabase = await createClient();

      // NB: `priority` is deliberately absent from this select. There is no
      // priority column on bug_reports — asking PostgREST for it made this whole
      // query error out, so these stats never rendered at all.
      const { data: bugs, error } = await supabase
        .from('bug_reports')
        .select('status, category, created_at')
        .eq('organization_id', organizationId);

      if (error) throw error;

      const countByStatus = (status: BugReportStatus) =>
        bugs?.filter((b) => b.status === status).length || 0;

      const stats: BugReportStats = {
        total: bugs?.length || 0,
        by_status: BUG_STATUSES.reduce(
          (acc, status) => ({ ...acc, [status]: countByStatus(status) }),
          {} as Record<BugReportStatus, number>
        ),
        // Always zero until a priority column exists. Kept so the shape is stable
        // for consumers rather than silently disappearing from the response.
        by_priority: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
        // Driven by the constant, like by_status above, so it cannot drift from
        // the vocabulary again. The hand-written version counted `ui` and
        // `functionality` — neither of which the database has ever held — and
        // omitted `bug`, `ui_design` and `feature_request`, which between them
        // are 91% of every report ever filed.
        by_category: BUG_REPORT_CATEGORIES.reduce(
          (acc, category) => ({
            ...acc,
            [category]: bugs?.filter((b) => b.category === category).length || 0,
          }),
          {} as Record<BugReportCategory, number>
        ),
        recent_count:
          bugs?.filter((b) => {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return new Date(b.created_at) > weekAgo;
          }).length || 0,
      };

      return stats;
    } catch (error) {
      console.error('[BugReportServerService] Error fetching bug stats:', error);
      throw error;
    }
  }
}
