import { createClient } from '@/lib/supabase/server';
import type { BugReport, BugReportStats } from '@boobalan_jkkn/shared';

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

      const { data: bugs, error } = await supabase
        .from('bug_reports')
        .select('status, category, priority, created_at')
        .eq('organization_id', organizationId);

      if (error) throw error;

      const stats: BugReportStats = {
        total: bugs?.length || 0,
        by_status: {
          open: bugs?.filter((b) => b.status === 'open').length || 0,
          in_progress: bugs?.filter((b) => b.status === 'in_progress').length || 0,
          resolved: bugs?.filter((b) => b.status === 'resolved').length || 0,
          closed: bugs?.filter((b) => b.status === 'closed').length || 0,
        },
        by_priority: {
          low: bugs?.filter((b) => b.priority === 'low').length || 0,
          medium: bugs?.filter((b) => b.priority === 'medium').length || 0,
          high: bugs?.filter((b) => b.priority === 'high').length || 0,
          critical: bugs?.filter((b) => b.priority === 'critical').length || 0,
        },
        by_category: {
          ui: bugs?.filter((b) => b.category === 'ui').length || 0,
          functionality: bugs?.filter((b) => b.category === 'functionality').length || 0,
          performance: bugs?.filter((b) => b.category === 'performance').length || 0,
          security: bugs?.filter((b) => b.category === 'security').length || 0,
          other: bugs?.filter((b) => b.category === 'other').length || 0,
        },
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
