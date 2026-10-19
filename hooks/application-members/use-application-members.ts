'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getApplicationMembersAction,
  addApplicationMemberAction,
  removeApplicationMemberAction,
  updateApplicationMemberRoleAction,
  getManageableApplicationIdsAction,
} from '@/lib/actions/application-members';
import type {
  AddApplicationMemberPayload,
  UpdateApplicationMemberPayload,
} from '@/lib/services/application-members/server';

/**
 * Hook to fetch members of a specific application
 */
export function useApplicationMembers(applicationId: string | undefined) {
  return useQuery({
    queryKey: ['application-members', applicationId],
    queryFn: async () => {
      if (!applicationId) {
        return [];
      }
      const result = await getApplicationMembersAction(applicationId);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data ?? [];
    },
    enabled: !!applicationId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook resolving which applications the current user may manage access for.
 *
 * Returns a `canManage(applicationId)` predicate so callers can gate the
 * "Manage access" action without a query per application card.
 */
export function useManageableApplications() {
  const query = useQuery({
    queryKey: ['manageable-applications'],
    queryFn: async () => {
      const result = await getManageableApplicationIdsAction();
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data ?? { isSuperAdmin: false, applicationIds: [] };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  const manageable = query.data;

  return {
    ...query,
    canManage: (applicationId: string) =>
      !!manageable &&
      (manageable.isSuperAdmin ||
        manageable.applicationIds.includes(applicationId)),
  };
}

/**
 * Hook to add a member to an application
 */
export function useAddApplicationMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: AddApplicationMemberPayload) => {
      const result = await addApplicationMemberAction(payload);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate application members list
      queryClient.invalidateQueries({
        queryKey: ['application-members', variables.application_id],
      });
      // Invalidate user applications
      queryClient.invalidateQueries({
        queryKey: ['user-applications', variables.user_id],
      });
    },
  });
}

/**
 * Hook to remove a member from an application
 */
export function useRemoveApplicationMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      applicationId,
      userId,
    }: {
      applicationId: string;
      userId: string;
    }) => {
      const result = await removeApplicationMemberAction(applicationId, userId);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.success;
    },
    onSuccess: (_, variables) => {
      // Invalidate application members list
      queryClient.invalidateQueries({
        queryKey: ['application-members', variables.applicationId],
      });
      // Invalidate user applications
      queryClient.invalidateQueries({
        queryKey: ['user-applications', variables.userId],
      });
    },
  });
}

/**
 * Hook to update a member's role in an application
 */
export function useUpdateApplicationMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateApplicationMemberPayload) => {
      const result = await updateApplicationMemberRoleAction(payload);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: (data) => {
      // Invalidate application members list using the returned data
      if (data) {
        queryClient.invalidateQueries({
          queryKey: ['application-members', data.application_id],
        });
      }
    },
  });
}
