'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus, Loader2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  useApplicationMembers,
  useAddApplicationMember,
  useRemoveApplicationMember,
  useUpdateApplicationMemberRole,
} from '@/hooks/application-members/use-application-members';
import type { ApplicationMemberRole } from '@/lib/services/application-members/server';

interface ManageAccessDialogProps {
  applicationId: string;
  applicationName: string;
}

interface AvailableUser {
  id: string;
  email: string;
  full_name: string | null;
}

const ROLE_DESCRIPTIONS: Record<ApplicationMemberRole, string> = {
  maintainer: 'Full access, and can share this app with others',
  developer: 'Can see and work on this app’s bugs',
  viewer: 'Read-only access',
};

export function ManageAccessDialog({
  applicationId,
  applicationName,
}: ManageAccessDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [role, setRole] = useState<ApplicationMemberRole>('developer');
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: members = [], isLoading: loadingMembers } =
    useApplicationMembers(open ? applicationId : undefined);
  const addMember = useAddApplicationMember();
  const removeMember = useRemoveApplicationMember();
  const updateRole = useUpdateApplicationMemberRole();

  // Same source as the org invite dialog: `profiles` is readable by any
  // authenticated user, so this needs no elevated privileges.
  useEffect(() => {
    if (!open) return;

    const fetchAvailableUsers = async () => {
      try {
        setLoadingUsers(true);
        const supabase = createClient();

        const { data: users, error: fetchError } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .order('full_name', { ascending: true });

        if (fetchError) throw fetchError;

        setAvailableUsers(users || []);
      } catch (err) {
        console.error('[ManageAccessDialog] Error fetching users:', err);
        setError('Could not load the user list.');
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchAvailableUsers();
  }, [open]);

  const memberUserIds = new Set(members.map((member) => member.user_id));
  const grantableUsers = availableUsers.filter(
    (user) => !memberUserIds.has(user.id)
  );

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;

    setError(null);

    try {
      await addMember.mutateAsync({
        application_id: applicationId,
        user_id: selectedUserId,
        role,
      });
      setSelectedUserId('');
      setRole('developer');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to grant access.'
      );
    }
  };

  const handleRoleChange = async (
    memberId: string,
    nextRole: ApplicationMemberRole
  ) => {
    setError(null);
    try {
      await updateRole.mutateAsync({ member_id: memberId, role: nextRole });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      await removeMember.mutateAsync({ applicationId, userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove access.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm' title='Manage access'>
          <UserPlus className='h-4 w-4' />
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-lg max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>
            Choose who can see and work on{' '}
            <span className='font-medium text-foreground'>
              {applicationName}
            </span>
            . People without access cannot filter or open this app&apos;s bugs.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className='rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
            {error}
          </div>
        )}

        {/* Grant access */}
        <form onSubmit={handleGrant} className='space-y-4 py-2'>
          <div className='space-y-2'>
            <Label htmlFor='grant-user'>Add someone</Label>
            {loadingUsers ? (
              <div className='flex items-center justify-center py-4'>
                <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
              </div>
            ) : (
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id='grant-user'>
                  <SelectValue placeholder='Choose a user...' />
                </SelectTrigger>
                <SelectContent
                  position='popper'
                  className='max-h-[200px] overflow-y-auto'
                  align='start'
                  side='bottom'
                  sideOffset={4}
                >
                  {grantableUsers.length === 0 ? (
                    <div className='py-4 text-center text-sm text-muted-foreground'>
                      Everyone already has access
                    </div>
                  ) : (
                    grantableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        <div className='flex flex-col py-1'>
                          <span className='font-medium text-sm'>
                            {user.full_name || 'Unknown'}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {user.email}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='grant-role'>Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as ApplicationMemberRole)}
            >
              <SelectTrigger id='grant-role'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='developer'>Developer</SelectItem>
                <SelectItem value='maintainer'>Maintainer</SelectItem>
                <SelectItem value='viewer'>Viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              {ROLE_DESCRIPTIONS[role]}
            </p>
          </div>

          <Button
            type='submit'
            disabled={!selectedUserId || addMember.isPending}
            className='w-full'
          >
            {addMember.isPending ? 'Granting...' : 'Grant access'}
          </Button>
        </form>

        {/* Existing members */}
        <div className='space-y-2 border-t pt-4'>
          <Label>People with access</Label>
          {loadingMembers ? (
            <div className='flex items-center justify-center py-4'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          ) : members.length === 0 ? (
            <p className='py-3 text-sm text-muted-foreground'>
              Nobody has been given access yet.
            </p>
          ) : (
            <ul className='space-y-2'>
              {members.map((member) => (
                <li
                  key={member.id}
                  className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'
                >
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>
                      {member.user?.user_metadata?.full_name ||
                        member.user?.email ||
                        'Unknown user'}
                    </p>
                    {member.user?.email && (
                      <p className='truncate text-xs text-muted-foreground'>
                        {member.user.email}
                      </p>
                    )}
                  </div>

                  <Select
                    value={member.role}
                    onValueChange={(v) =>
                      handleRoleChange(member.id, v as ApplicationMemberRole)
                    }
                  >
                    <SelectTrigger className='h-8 w-[130px]'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='developer'>Developer</SelectItem>
                      <SelectItem value='maintainer'>Maintainer</SelectItem>
                      <SelectItem value='viewer'>Viewer</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    title='Remove access'
                    disabled={removeMember.isPending}
                    onClick={() => handleRemove(member.user_id)}
                  >
                    <Trash2 className='h-4 w-4 text-destructive' />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {members.length > 0 && (
            <p className='pt-1 text-xs text-muted-foreground'>
              Changes take effect as soon as the person refreshes the page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
