import { createClient } from '@/lib/supabase/server';
import { SuperAdminServerService } from '../super-admins/server';

/**
 * Application Members Service (Server-side)
 * Manages application-level access control
 */

export type ApplicationMemberRole = 'maintainer' | 'developer' | 'viewer';

export interface ApplicationMember {
  id: string;
  application_id: string;
  user_id: string;
  role: ApplicationMemberRole;
  added_by: string;
  added_at: string;
  user?: {
    id: string;
    email: string;
    user_metadata?: {
      full_name?: string;
      avatar_url?: string;
    };
  };
}

export interface AddApplicationMemberPayload {
  application_id: string;
  user_id: string;
  role: ApplicationMemberRole;
}

export interface UpdateApplicationMemberPayload {
  member_id: string;
  role: ApplicationMemberRole;
}

export class ApplicationMemberServerService {
  /**
   * Get all applications a user has access to
   */
  static async getUserApplications(userId: string): Promise<string[]> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('application_members')
        .select('application_id')
        .eq('user_id', userId);

      if (error) {
        console.error('[ApplicationMemberService] Error fetching user apps:', error);
        throw new Error(error.message);
      }

      return (data || []).map((item) => item.application_id);
    } catch (error) {
      console.error('[ApplicationMemberService] Error fetching user apps:', error);
      throw error;
    }
  }

  /**
   * Get all members of an application
   */
  static async getApplicationMembers(
    applicationId: string
  ): Promise<ApplicationMember[]> {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('application_members')
        .select('*')
        .eq('application_id', applicationId)
        .order('added_at', { ascending: false });

      if (error) {
        console.error('[ApplicationMemberService] Error fetching members:', error);
        throw new Error(error.message);
      }

      const members = data || [];

      if (members.length === 0) {
        return [];
      }

      // Resolve identities from `profiles` in one query. The admin API
      // (auth.admin.getUserById) is not usable here --- this client is built
      // from the anon key + the caller's cookies, so it has no service role.
      // `profiles` is readable by any authenticated user (profiles_select_policy).
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in(
          'id',
          members.map((member) => member.user_id)
        );

      const profileById = new Map(
        (profiles || []).map((profile) => [profile.id, profile])
      );

      return members.map((member) => {
        const profile = profileById.get(member.user_id);

        return {
          ...member,
          user: profile
            ? {
                id: profile.id,
                email: profile.email || '',
                user_metadata: {
                  full_name: profile.full_name || undefined,
                  avatar_url: profile.avatar_url || undefined,
                },
              }
            : undefined,
        };
      });
    } catch (error) {
      console.error('[ApplicationMemberService] Error fetching members:', error);
      throw error;
    }
  }

  /**
   * Add a member to an application
   */
  static async addMemberToApplication(
    payload: AddApplicationMemberPayload
  ): Promise<ApplicationMember> {
    try {
      const supabase = await createClient();

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not authenticated');
      }

      // Check if current user is super admin or app maintainer
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        user.id
      );

      if (!isSuperAdmin) {
        // Check if user is maintainer of this app
        const { data: membership } = await supabase
          .from('application_members')
          .select('role')
          .eq('application_id', payload.application_id)
          .eq('user_id', user.id)
          .single();

        if (!membership || membership.role !== 'maintainer') {
          throw new Error(
            'Only super admins and app maintainers can add members'
          );
        }
      }

      // Add member
      const { data, error } = await supabase
        .from('application_members')
        .insert({
          application_id: payload.application_id,
          user_id: payload.user_id,
          role: payload.role,
          added_by: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('[ApplicationMemberService] Error adding member:', error);
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      console.error('[ApplicationMemberService] Error adding member:', error);
      throw error;
    }
  }

  /**
   * Remove a member from an application
   */
  static async removeMemberFromApplication(
    applicationId: string,
    userId: string
  ): Promise<void> {
    try {
      const supabase = await createClient();

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not authenticated');
      }

      // Check if current user is super admin or app maintainer
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        user.id
      );

      if (!isSuperAdmin) {
        // Check if user is maintainer of this app
        const { data: membership } = await supabase
          .from('application_members')
          .select('role')
          .eq('application_id', applicationId)
          .eq('user_id', user.id)
          .single();

        if (!membership || membership.role !== 'maintainer') {
          throw new Error(
            'Only super admins and app maintainers can remove members'
          );
        }
      }

      // Remove member
      const { error } = await supabase
        .from('application_members')
        .delete()
        .eq('application_id', applicationId)
        .eq('user_id', userId);

      if (error) {
        console.error('[ApplicationMemberService] Error removing member:', error);
        throw new Error(error.message);
      }
    } catch (error) {
      console.error('[ApplicationMemberService] Error removing member:', error);
      throw error;
    }
  }

  /**
   * Update a member's role
   */
  static async updateMemberRole(
    payload: UpdateApplicationMemberPayload
  ): Promise<ApplicationMember> {
    try {
      const supabase = await createClient();

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not authenticated');
      }

      // Get the member to update
      const { data: targetMember } = await supabase
        .from('application_members')
        .select('application_id')
        .eq('id', payload.member_id)
        .single();

      if (!targetMember) {
        throw new Error('Member not found');
      }

      // Check if current user is super admin or app maintainer
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        user.id
      );

      if (!isSuperAdmin) {
        // Check if user is maintainer of this app
        const { data: membership } = await supabase
          .from('application_members')
          .select('role')
          .eq('application_id', targetMember.application_id)
          .eq('user_id', user.id)
          .single();

        if (!membership || membership.role !== 'maintainer') {
          throw new Error(
            'Only super admins and app maintainers can update member roles'
          );
        }
      }

      // Update role
      const { data, error } = await supabase
        .from('application_members')
        .update({ role: payload.role })
        .eq('id', payload.member_id)
        .select()
        .single();

      if (error) {
        console.error('[ApplicationMemberService] Error updating role:', error);
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      console.error('[ApplicationMemberService] Error updating role:', error);
      throw error;
    }
  }

  /**
   * Check if a user has access to an application
   */
  static async checkUserHasAppAccess(
    userId: string,
    applicationId: string
  ): Promise<boolean> {
    try {
      // Check if super admin
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        userId
      );

      if (isSuperAdmin) {
        return true;
      }

      const supabase = await createClient();

      const { data, error } = await supabase
        .from('application_members')
        .select('id')
        .eq('user_id', userId)
        .eq('application_id', applicationId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[ApplicationMemberService] Error checking access:', error);
        return false;
      }

      return !!data;
    } catch (error) {
      console.error('[ApplicationMemberService] Error checking access:', error);
      return false;
    }
  }

  /**
   * Get a user's role in an application
   */
  static async getUserRoleInApp(
    userId: string,
    applicationId: string
  ): Promise<ApplicationMemberRole | null> {
    try {
      // Check if super admin (they have all permissions)
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        userId
      );

      if (isSuperAdmin) {
        return 'maintainer'; // Super admins have maintainer-level access
      }

      const supabase = await createClient();

      const { data, error } = await supabase
        .from('application_members')
        .select('role')
        .eq('user_id', userId)
        .eq('application_id', applicationId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[ApplicationMemberService] Error fetching role:', error);
        return null;
      }

      return data?.role || null;
    } catch (error) {
      console.error('[ApplicationMemberService] Error fetching role:', error);
      return null;
    }
  }

  /**
   * Applications the current user may manage access for.
   *
   * Adding/removing members requires super admin OR app maintainer --- both in
   * this service and in RLS ("admins_add_app_members_fixed"). The UI uses this
   * to decide where to show the "Manage access" action, so it resolves the
   * whole set in one query rather than probing per application.
   */
  static async getManageableApplicationIds(): Promise<{
    isSuperAdmin: boolean;
    applicationIds: string[];
  }> {
    try {
      const supabase = await createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return { isSuperAdmin: false, applicationIds: [] };
      }

      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(
        user.id
      );

      if (isSuperAdmin) {
        // Super admins can manage every application; callers treat this flag
        // as "allow all" and ignore the (empty) id list.
        return { isSuperAdmin: true, applicationIds: [] };
      }

      const { data, error } = await supabase
        .from('application_members')
        .select('application_id')
        .eq('user_id', user.id)
        .eq('role', 'maintainer');

      if (error) {
        console.error(
          '[ApplicationMemberService] Error fetching maintainer apps:',
          error
        );
        return { isSuperAdmin: false, applicationIds: [] };
      }

      return {
        isSuperAdmin: false,
        applicationIds: (data || []).map((row) => row.application_id),
      };
    } catch (error) {
      console.error(
        '[ApplicationMemberService] Error fetching maintainer apps:',
        error
      );
      return { isSuperAdmin: false, applicationIds: [] };
    }
  }
}
