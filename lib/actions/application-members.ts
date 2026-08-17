'use server';

import { ApplicationMemberServerService } from '../services/application-members/server';
import type {
  AddApplicationMemberPayload,
  UpdateApplicationMemberPayload,
} from '../services/application-members/server';

/**
 * Server Actions for Application Member Management
 */

export async function addApplicationMemberAction(
  payload: AddApplicationMemberPayload
) {
  try {
    const data = await ApplicationMemberServerService.addMemberToApplication(
      payload
    );
    return { data, error: null };
  } catch (error) {
    console.error('[addApplicationMemberAction] Error:', error);
    return {
      data: null,
      error:
        error instanceof Error ? error.message : 'Failed to add member to application',
    };
  }
}

export async function removeApplicationMemberAction(
  applicationId: string,
  userId: string
) {
  try {
    await ApplicationMemberServerService.removeMemberFromApplication(
      applicationId,
      userId
    );
    return { success: true, error: null };
  } catch (error) {
    console.error('[removeApplicationMemberAction] Error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to remove member from application',
    };
  }
}

export async function updateApplicationMemberRoleAction(
  payload: UpdateApplicationMemberPayload
) {
  try {
    const data = await ApplicationMemberServerService.updateMemberRole(payload);
    return { data, error: null };
  } catch (error) {
    console.error('[updateApplicationMemberRoleAction] Error:', error);
    return {
      data: null,
      error:
        error instanceof Error ? error.message : 'Failed to update member role',
    };
  }
}

export async function getApplicationMembersAction(applicationId: string) {
  try {
    const data = await ApplicationMemberServerService.getApplicationMembers(
      applicationId
    );
    return { data, error: null };
  } catch (error) {
    console.error('[getApplicationMembersAction] Error:', error);
    return {
      data: null,
      error:
        error instanceof Error ? error.message : 'Failed to fetch application members',
    };
  }
}

export async function getManageableApplicationIdsAction() {
  try {
    const data =
      await ApplicationMemberServerService.getManageableApplicationIds();
    return { data, error: null };
  } catch (error) {
    console.error('[getManageableApplicationIdsAction] Error:', error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch manageable applications',
    };
  }
}

export async function getUserApplicationsAction(userId: string) {
  try {
    const data = await ApplicationMemberServerService.getUserApplications(
      userId
    );
    return { data, error: null };
  } catch (error) {
    console.error('[getUserApplicationsAction] Error:', error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch user applications',
    };
  }
}
