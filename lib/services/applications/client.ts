'use client';

import { createClient } from '@/lib/supabase/client';
import { generateApiKey } from '@/lib/utils/api-key-generator';
import { AI_TASK_KEYS } from '@/lib/ai/tasks';
import { getCatalogEntry } from '@/lib/routines/catalog';
import type {
  Application,
  CreateApplicationPayload,
  UpdateApplicationPayload,
  RegenerateApiKeyResponse,
} from '@boobalan_jkkn/shared';

export class ApplicationClientService {
  /**
   * Get all applications for an organization
   */
  static async getOrganizationApplications(organizationId: string): Promise<Application[]> {
    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[ApplicationClientService] Fetch error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Fetched applications:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
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
      const supabase = createClient();

      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('slug', slug)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          console.log('[ApplicationClientService] Application not found:', slug);
          return null;
        }
        console.error('[ApplicationClientService] Fetch error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Fetched application:', data?.name);
      return data;
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Create a new application
   */
  static async createApplication(payload: CreateApplicationPayload): Promise<Application> {
    try {
      const supabase = createClient();

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      // Generate API key
      const apiKey = generateApiKey();

      const { data, error } = await supabase
        .from('applications')
        .insert({
          organization_id: payload.organization_id,
          name: payload.name,
          slug: payload.slug,
          app_url: payload.app_url,
          api_key: apiKey,
          created_by_user_id: user.id,
          settings: payload.settings || {},
        })
        .select()
        .single();

      if (error) {
        console.error('[ApplicationClientService] Create error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Created application:', data.name);
      return data;
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Update an application
   */
  static async updateApplication(payload: UpdateApplicationPayload): Promise<Application> {
    try {
      const supabase = createClient();

      const { id, ...updates } = payload;

      const { data, error } = await supabase
        .from('applications')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[ApplicationClientService] Update error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Updated application:', data.name);
      return data;
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Delete an application
   */
  static async deleteApplication(id: string): Promise<void> {
    try {
      const supabase = createClient();

      const { error } = await supabase.from('applications').delete().eq('id', id);

      if (error) {
        console.error('[ApplicationClientService] Delete error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Deleted application:', id);
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
      throw error;
    }
  }

  /**
   * Regenerate API key for an application
   */
  static async regenerateApiKey(id: string): Promise<RegenerateApiKeyResponse> {
    try {
      const supabase = createClient();

      // Generate new API key
      const newApiKey = generateApiKey();

      const { error } = await supabase
        .from('applications')
        .update({ api_key: newApiKey })
        .eq('id', id);

      if (error) {
        console.error('[ApplicationClientService] Regenerate API key error:', error);
        throw new Error(error.message);
      }

      console.log('[ApplicationClientService] Regenerated API key for application:', id);
      return { api_key: newApiKey };
    } catch (error) {
      console.error('[ApplicationClientService] Unexpected error:', error);
      throw error;
    }
  }
}
