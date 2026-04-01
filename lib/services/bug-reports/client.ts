'use client';

import { createClient } from '@/lib/supabase/client';
import type {
  BugReport,
  BugReportMessage,
  BugReportFilters,
  UpdateBugReportPayload,
  BugReportStats,
} from '@boobalan_jkkn/shared';

interface BugReportQueryResult extends Omit<BugReport, 'title' | 'reporter_name' | 'reporter_email'> {
  metadata?: {
    title?: string;
    reporter_name?: string;
    reporter_email?: string;
  };
}

export class BugReportClientService {
  /**
   * Get bug reports with advanced filtering and pagination
   */
  static async getBugReports(filters: BugReportFilters = {}, page = 1, pageSize = 20) {
    try {
      const supabase = createClient();

      let query = supabase
        .from('bug_reports')
        .select(
          `
          *,
          application:applications(id, name, slug),
          organization:organizations(id, name)
        `,
          { count: 'exact' }
        );

      // Apply filters
      if (filters.organization_id) {
        query = query.eq('organization_id', filters.organization_id);
      }
      if (filters.application_id) {
        query = query.eq('application_id', filters.application_id);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.category) {
        query = query.eq('category', filters.category);
      }
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`);
      }

      // Sort
      const sortBy = filters.sort_by || 'created_at';
      const sortOrder = filters.sort_order || 'desc';
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      // Pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      // Extract metadata fields to top level for easier access
      const transformedData: BugReport[] = (data?.map((bug: BugReportQueryResult) => ({
        ...bug,
        title: bug.metadata?.title || 'Untitled',
        reporter_name: bug.metadata?.reporter_name || null,
        reporter_email: bug.metadata?.reporter_email || null,
      })) || []) as BugReport[];

      console.log(`[BugReportClientService] Fetched ${transformedData.length} bugs (total: ${count})`);
      return { data: transformedData, total: count || 0, page, pageSize };
    } catch (error) {
      console.error('[BugReportClientService] Error fetching bug reports:', error);
      throw error;
    }
  }

  /**
   * Get single bug report by ID with full details
   */
  static async getBugReportById(id: string): Promise<BugReport | null> {
    try {
      const supabase = createClient();

      const { data, error} = await supabase
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
          console.warn(`[BugReportClientService] Bug report not found: ${id}`);
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
      console.error('[BugReportClientService] Error fetching bug report by ID:', error);
      throw error;
    }
  }

  /**
   * Update bug report status
   */
  static async updateBugStatus(id: string, status: string): Promise<BugReport> {
    const response = await fetch(`/api/internal/bug-reports/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update bug status.');
    }

    const data = await response.json();
    console.log(`[BugReportClientService] Updated status for ${id}: ${status}`);
    return data.bug;
  }

  /**
   * Update bug report details
   */
  static async updateBugReport(payload: UpdateBugReportPayload): Promise<BugReport> {
    try {
      const supabase = createClient();

      const { id, ...updates } = payload;

      const { data, error } = await supabase
        .from('bug_reports')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      console.log(`[BugReportClientService] Updated bug report: ${id}`);
      return data;
    } catch (error) {
      console.error('[BugReportClientService] Error updating bug report:', error);
      throw error;
    }
  }

  /**
   * Assign bug to user
   */
  static async assignBug(bugId: string, userId: string | null): Promise<BugReport> {
    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from('bug_reports')
        .update({
          assigned_to: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bugId)
        .select()
        .single();

      if (error) throw error;

      console.log(`[BugReportClientService] Assigned bug ${bugId} to ${userId || 'unassigned'}`);
      return data;
    } catch (error) {
      console.error('[BugReportClientService] Error assigning bug:', error);
      throw error;
    }
  }

  /**
   * Update bug priority
   */
  static async updatePriority(bugId: string, priority: string): Promise<BugReport> {
    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from('bug_reports')
        .update({
          priority,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bugId)
        .select()
        .single();

      if (error) throw error;

      console.log(`[BugReportClientService] Updated priority for ${bugId}: ${priority}`);
      return data;
    } catch (error) {
      console.error('[BugReportClientService] Error updating priority:', error);
      throw error;
    }
  }

  /**
   * Send message on bug report
   */
  static async sendMessage(bugReportId: string, message: string): Promise<BugReportMessage> {
    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('bug_report_messages')
        .insert([
          {
            bug_report_id: bugReportId,
            sender_user_id: user.id,
            message_text: message,
          },
        ])
        .select('*')
        .single();

      if (error) throw error;

      console.log(`[BugReportClientService] Sent message on bug ${bugReportId}`);
      return data;
    } catch (error) {
      console.error('[BugReportClientService] Error sending message:', error);
      throw error;
    }
  }

  /**
   * Get bug report messages
   */
  static async getMessages(bugReportId: string): Promise<BugReportMessage[]> {
    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from('bug_report_messages')
        .select('*')
        .eq('bug_report_id', bugReportId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('[BugReportClientService] Error fetching messages:', error);
      throw error;
    }
  }

  /**
   * Get bug report statistics
   */
  static async getBugStats(organizationId: string): Promise<BugReportStats> {
    try {
      const supabase = createClient();

      const { data: bugs, error } = await supabase
        .from('bug_reports')
        .select('status, category, created_at')
        .eq('organization_id', organizationId);

      if (error) throw error;

      const stats: BugReportStats = {
        total: bugs?.length || 0,
        by_status: {
          open: bugs?.filter((b) => b.status === 'open' || b.status === 'new').length || 0,
          in_progress: bugs?.filter((b) => b.status === 'in_progress').length || 0,
          resolved: bugs?.filter((b) => b.status === 'resolved').length || 0,
          closed: bugs?.filter((b) => b.status === 'closed' || b.status === 'wont_fix').length || 0,
        },
        by_priority: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
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
      console.error('[BugReportClientService] Error fetching bug stats:', error);
      throw error;
    }
  }

  /**
   * Bulk update bug status
   */
  static async bulkUpdateStatus(bugIds: string[], status: string): Promise<void> {
    try {
      const supabase = createClient();

      const updateData: { status: string; resolved_at: string | null } = {
        status,
        resolved_at: null,
      };

      if (status === 'resolved' || status === 'wont_fix') {
        updateData.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase.from('bug_reports').update(updateData).in('id', bugIds);

      if (error) throw error;

      console.log(`[BugReportClientService] Bulk updated ${bugIds.length} bugs to ${status}`);
    } catch (error) {
      console.error('[BugReportClientService] Error bulk updating status:', error);
      throw error;
    }
  }

  /**
   * Delete bug report
   */
  static async deleteBugReport(id: string): Promise<void> {
    try {
      const supabase = createClient();

      const { error } = await supabase.from('bug_reports').delete().eq('id', id);

      if (error) throw error;

      console.log(`[BugReportClientService] Deleted bug report: ${id}`);
    } catch (error) {
      console.error('[BugReportClientService] Error deleting bug report:', error);
      throw error;
    }
  }
}
