'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BugReportClientService } from '@/lib/services/bug-reports/client';
import type { FleetBugRollup } from '@/lib/services/bug-reports/client';
import type {
  BugReport,
  BugReportFilters,
  BugReportMessage,
  UpdateBugReportPayload,
  BugReportStats,
} from '@boobalan_jkkn/shared';
import toast from 'react-hot-toast';

/**
 * Hook to fetch all bug reports with filtering and pagination
 */
export function useBugReports(
  organizationId: string,
  initialFilters: BugReportFilters = {}
) {
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<BugReportFilters>(initialFilters);
  const pageSize = 10000; // Fetch all bugs for client-side pagination

  const fetchBugs = useCallback(async () => {
    if (!organizationId) {
      setBugs([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const effectiveFilters = {
        ...filters,
        organization_id: organizationId,
      };

      const response = await BugReportClientService.getBugReports(
        effectiveFilters,
        page,
        pageSize
      );

      setBugs(response.data);
      setTotal(response.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch bugs';
      setError(message);
      console.error('[hooks/bug-reports] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId, filters, page, pageSize]);

  useEffect(() => {
    fetchBugs();
  }, [fetchBugs]);

  return {
    bugs,
    loading,
    error,
    total,
    page,
    setPage,
    pageSize,
    filters,
    setFilters,
    refetch: fetchBugs,
  };
}

/**
 * Hook to fetch a specific bug report by ID
 */
export function useBugReport(id: string) {
  const [bug, setBug] = useState<BugReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBug = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const data = await BugReportClientService.getBugReportById(id);
      setBug(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch bug';
      setError(message);
      console.error('[hooks/bug-report] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBug();
  }, [fetchBug]);

  return {
    bug,
    loading,
    error,
    refetch: fetchBug,
  };
}

/**
 * Hook to update bug status
 */
export function useUpdateBugStatus() {
  const [updating, setUpdating] = useState(false);

  const updateStatus = useCallback(async (bugId: string, status: string) => {
    try {
      setUpdating(true);

      const updated = await BugReportClientService.updateBugStatus(bugId, status);

      toast.success(`Bug status updated to ${status}`);

      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      toast.error(message);
      console.error('[hooks/bug-reports] Update status error:', err);
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  return {
    updateStatus,
    updating,
  };
}

/**
 * Hook to update bug report details
 */
export function useUpdateBugReport() {
  const [updating, setUpdating] = useState(false);

  const updateBugReport = useCallback(async (payload: UpdateBugReportPayload) => {
    try {
      setUpdating(true);

      const updated = await BugReportClientService.updateBugReport(payload);

      toast.success('Bug report updated successfully!');

      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update bug report';
      toast.error(message);
      console.error('[hooks/bug-reports] Update error:', err);
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  return {
    updateBugReport,
    updating,
  };
}

/**
 * Hook to assign bug to a user
 */
export function useAssignBug() {
  const [assigning, setAssigning] = useState(false);

  const assignBug = useCallback(async (bugId: string, userId: string | null) => {
    try {
      setAssigning(true);

      const updated = await BugReportClientService.assignBug(bugId, userId);

      toast.success(userId ? 'Bug assigned successfully!' : 'Bug unassigned');

      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign bug';
      toast.error(message);
      console.error('[hooks/bug-reports] Assign error:', err);
      throw err;
    } finally {
      setAssigning(false);
    }
  }, []);

  return {
    assignBug,
    assigning,
  };
}

/**
 * Hook to update bug priority
 */
export function useUpdateBugPriority() {
  const [updating, setUpdating] = useState(false);

  const updatePriority = useCallback(async (bugId: string, priority: string) => {
    try {
      setUpdating(true);

      const updated = await BugReportClientService.updatePriority(bugId, priority);

      toast.success(`Priority updated to ${priority}`);

      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update priority';
      toast.error(message);
      console.error('[hooks/bug-reports] Update priority error:', err);
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  return {
    updatePriority,
    updating,
  };
}

/**
 * Hook to send a message on a bug report
 */
export function useSendMessage() {
  const [sending, setSending] = useState(false);

  const sendMessage = useCallback(
    async (bugReportId: string, message: string): Promise<BugReportMessage> => {
      try {
        setSending(true);

        const newMessage = await BugReportClientService.sendMessage(bugReportId, message);

        toast.success('Message sent!');

        return newMessage;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        toast.error(message);
        console.error('[hooks/bug-reports] Send message error:', err);
        throw err;
      } finally {
        setSending(false);
      }
    },
    []
  );

  return {
    sendMessage,
    sending,
  };
}

/**
 * Hook to get bug report statistics
 */
export function useBugStats(organizationId: string) {
  const [stats, setStats] = useState<BugReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!organizationId) {
      setStats(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await BugReportClientService.getBugStats(organizationId);
      setStats(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch stats';
      setError(message);
      console.error('[hooks/bug-stats] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
  };
}

/**
 * Hook to fetch the cross-app bug rollup (per-app loads + fleet trend + totals)
 * for an organization.
 */
export function useFleetBugRollup(organizationId: string) {
  const [rollup, setRollup] = useState<FleetBugRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRollup = useCallback(async () => {
    if (!organizationId) {
      setRollup(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await BugReportClientService.getFleetBugRollup(organizationId);
      setRollup(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch rollup';
      setError(message);
      console.error('[hooks/fleet-bug-rollup] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchRollup();
  }, [fetchRollup]);

  return {
    rollup,
    loading,
    error,
    refetch: fetchRollup,
  };
}

/**
 * Hook to bulk update bug status
 */
export function useBulkUpdateStatus() {
  const [updating, setUpdating] = useState(false);

  const bulkUpdateStatus = useCallback(async (bugIds: string[], status: string) => {
    try {
      setUpdating(true);

      await BugReportClientService.bulkUpdateStatus(bugIds, status);

      toast.success(`${bugIds.length} bugs updated to ${status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to bulk update status';
      toast.error(message);
      console.error('[hooks/bug-reports] Bulk update error:', err);
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  return {
    bulkUpdateStatus,
    updating,
  };
}

/**
 * Hook to delete a bug report
 */
export function useDeleteBugReport() {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const deleteBugReport = useCallback(
    async (id: string, redirectPath = '/org') => {
      try {
        setDeleting(true);

        await BugReportClientService.deleteBugReport(id);

        toast.success('Bug report deleted successfully');

        // Redirect after deletion
        router.push(redirectPath);

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete bug report';
        toast.error(message);
        console.error('[hooks/bug-reports] Delete error:', err);
        throw err;
      } finally {
        setDeleting(false);
      }
    },
    [router]
  );

  return {
    deleteBugReport,
    deleting,
  };
}
