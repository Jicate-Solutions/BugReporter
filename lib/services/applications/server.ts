import { createClient } from '@/lib/supabase/server';
import type { Application } from '@boobalan_jkkn/shared';
import { TERMINAL_BUG_STATUSES } from '@boobalan_jkkn/shared';

export class ApplicationServerService {
  /**
   * Get all applications for an organization
   */
  static async getOrganizationApplications(organizationId: string): Promise<Application[]> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[ApplicationServerService] Fetch error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationServerService] Fetched applications:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('[ApplicationServerService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Get application by ID
   */
  static async getApplicationById(id: string): Promise<Application | null> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          console.log('[ApplicationServerService] Application not found:', id);
          return null;
        }
        console.error('[ApplicationServerService] Fetch error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationServerService] Fetched application:', data?.name);
      return data;
    } catch (error) {
      console.error('[ApplicationServerService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Get application by slug within an organization
   */
  static async getApplicationBySlug(
    organizationId: string,
    slug: string
  ): Promise<Application | null> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('slug', slug)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          console.log('[ApplicationServerService] Application not found:', slug);
          return null;
        }
        console.error('[ApplicationServerService] Fetch error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationServerService] Fetched application:', data?.name);
      return data;
    } catch (error) {
      console.error('[ApplicationServerService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Get application statistics
   * Returns bug counts by status
   */
  static async getApplicationStats(
    id: string
  ): Promise<{ total_bugs: number; resolved_bugs: number; pending_bugs: number }> {
    try {
      const supabase = await createClient();

      // Get total bugs
      const { count: totalBugs, error: totalError } = await supabase
        .from('bug_reports')
        .select('*', { count: 'exact', head: true })
        .eq('application_id', id);

      if (totalError) {
        console.error('[ApplicationServerService] Total bugs count error:', totalError);
      }

      // Get resolved bugs
      const { count: resolvedBugs, error: resolvedError } = await supabase
        .from('bug_reports')
        .select('*', { count: 'exact', head: true })
        .eq('application_id', id)
        .eq('status', 'resolved');

      if (resolvedError) {
        console.error('[ApplicationServerService] Resolved bugs count error:', resolvedError);
      }

      // Get pending bugs — anything not in a terminal status. This used to look
      // for 'open', which the database has never stored, so freshly reported
      // ('new') and triaged ('seen') bugs were both missing from the count.
      const { count: pendingBugs, error: pendingError } = await supabase
        .from('bug_reports')
        .select('*', { count: 'exact', head: true })
        .eq('application_id', id)
        .not('status', 'in', `(${TERMINAL_BUG_STATUSES.join(',')})`);

      if (pendingError) {
        console.error('[ApplicationServerService] Pending bugs count error:', pendingError);
      }

      const stats = {
        total_bugs: totalBugs || 0,
        resolved_bugs: resolvedBugs || 0,
        pending_bugs: pendingBugs || 0,
      };

      console.log('[ApplicationServerService] Fetched application stats:', stats);
      return stats;
    } catch (error) {
      console.error('[ApplicationServerService] Unexpected error:', error);
      return {
        total_bugs: 0,
        resolved_bugs: 0,
        pending_bugs: 0,
      };
    }
  }
}
