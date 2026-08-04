'use client';

import { useParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApplicationForm } from '../../_components/application-form';
import { ApiKeyDisplay } from '../../_components/api-key-display';
import { BugPortalCard } from '../_components/bug-portal-card';
import {
  useApplication,
  useUpdateApplication,
  useDeleteApplication,
  useRegenerateApiKey
} from '@/hooks/applications/use-applications';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { Trash2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

export default function EditApplicationPage() {
  const params = useParams();
  const appSlug = params?.appSlug as string;

  const { organization, loading: orgLoading } = useOrganizationContext();
  const { application, loading: appLoading } = useApplication(
    organization?.id || '',
    appSlug
  );
  const { updateApplication, updating } = useUpdateApplication();
  const { deleteApplication, deleting } = useDeleteApplication(
    organization?.slug || ''
  );
  const { regenerateApiKey, regenerating } = useRegenerateApiKey();

  const [currentApiKey, setCurrentApiKey] = useState<string | null>(null);

  const loading = orgLoading || appLoading;

  if (loading) {
    return (
      <div className='max-w-2xl space-y-6'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-96 w-full' />
      </div>
    );
  }

  if (!organization || !application) {
    return <div>Application not found</div>;
  }

  const handleRegenerateApiKey = async () => {
    try {
      const result = await regenerateApiKey(application.id);
      setCurrentApiKey(result.api_key);
    } catch (error) {
      console.error('Failed to regenerate API key:', error);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteApplication(application.id);
    } catch (error) {
      console.error('Failed to delete application:', error);
    }
  };

  return (
    <div className='max-w-7xl space-y-6'>
      <div>
        <h1 className='text-3xl font-bold'>Edit Application</h1>
        <p className='text-muted-foreground'>
          Update your application settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Details</CardTitle>
          <CardDescription>Update your application information</CardDescription>
        </CardHeader>
        <CardContent>
          <ApplicationForm
            application={application}
            onSubmit={async (values) => {
              await updateApplication({
                id: application.id,
                ...values
              });
            }}
            submitLabel={updating ? 'Saving...' : 'Save Changes'}
          />
        </CardContent>
      </Card>

      <BugPortalCard application={application} />

      <Card>
        <CardHeader>
          <CardTitle>API Key Management</CardTitle>
          <CardDescription>
            View and regenerate your application API key
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <ApiKeyDisplay apiKey={currentApiKey || application.api_key} />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='outline' disabled={regenerating}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    regenerating ? 'animate-spin' : ''
                  }`}
                />
                {regenerating ? 'Regenerating...' : 'Regenerate API Key'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will generate a new API key and invalidate the old one.
                  Make sure to update your SDK integration with the new key.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRegenerateApiKey}>
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <Card className='border-destructive'>
        <CardHeader>
          <CardTitle className='text-destructive'>Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete this application and all associated data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='destructive' disabled={deleting}>
                <Trash2 className='mr-2 h-4 w-4' />
                {deleting ? 'Deleting...' : 'Delete Application'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  application &quot;{application.name}&quot; and all bug reports
                  associated with it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className='bg-destructive'
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
