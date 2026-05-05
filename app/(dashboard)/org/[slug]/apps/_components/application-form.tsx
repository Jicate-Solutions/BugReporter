'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AllowedDomainsInput } from './allowed-domains-input';
import type { Application } from '@boobalan_jkkn/shared';

const applicationFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase letters, numbers, and hyphens'
    ),
  app_url: z.string().url('Must be a valid URL'),
  settings: z.object({
    allowed_domains: z.array(z.string()).optional(),
    webhook_url: z
      .string()
      .url('Must be a valid URL')
      .optional()
      .or(z.literal('')),
    github_repo: z
      .string()
      .regex(
        /^[\w.-]+\/[\w.-]+$/,
        'Must be in the form owner/repo (e.g. Jicate-Solutions/BugReporter)'
      )
      .optional()
      .or(z.literal('')),
    deploy_hook_url: z
      .string()
      .url('Must be a valid URL')
      .optional()
      .or(z.literal('')),
    test_credentials_note: z.string().optional().or(z.literal('')),
    auto_triage_policy: z
      .object({
        auto_merge_eligible: z.boolean().optional()
      })
      .optional()
  })
});

type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

interface ApplicationFormProps {
  application?: Application;
  onSubmit: (values: ApplicationFormValues) => Promise<void>;
  submitLabel?: string;
}

export function ApplicationForm({
  application,
  onSubmit,
  submitLabel = 'Create Application'
}: ApplicationFormProps) {
  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: {
      name: application?.name || '',
      slug: application?.slug || '',
      app_url: application?.app_url || '',
      settings: {
        allowed_domains: application?.settings?.allowed_domains || [],
        webhook_url: application?.settings?.webhook_url || '',
        github_repo: application?.settings?.github_repo || '',
        deploy_hook_url: application?.settings?.deploy_hook_url || '',
        test_credentials_note:
          application?.settings?.test_credentials_note || '',
        auto_triage_policy: {
          auto_merge_eligible:
            application?.settings?.auto_triage_policy?.auto_merge_eligible ??
            false
        }
      }
    }
  });

  // Auto-generate slug from name
  const handleNameChange = (name: string) => {
    if (!application) {
      // Only auto-generate for new applications
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
      form.setValue('slug', slug);
    }
  };

  const handleSubmit = async (values: ApplicationFormValues) => {
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className='space-y-6'>
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Application Name</FormLabel>
              <FormControl>
                <Input
                  placeholder='My Awesome App'
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    handleNameChange(e.target.value);
                  }}
                />
              </FormControl>
              <FormDescription>
                The display name of your application
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='slug'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug</FormLabel>
              <FormControl>
                <Input
                  placeholder='my-awesome-app'
                  {...field}
                  disabled={!!application}
                />
              </FormControl>
              <FormDescription>
                URL-friendly identifier for your application
                {application && ' (cannot be changed)'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='app_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Application URL</FormLabel>
              <FormControl>
                <Input type='url' placeholder='https://myapp.com' {...field} />
              </FormControl>
              <FormDescription>
                The main URL of your application
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='settings.allowed_domains'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Allowed Domains</FormLabel>
              <FormControl>
                <AllowedDomainsInput
                  value={field.value || []}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription>
                Domains allowed to submit bug reports (leave empty to allow all)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='settings.webhook_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Webhook URL (Optional)</FormLabel>
              <FormControl>
                <Input
                  type='url'
                  placeholder='https://myapp.com/webhooks/bugs'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Receive notifications when new bugs are reported
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='space-y-1 pt-2'>
          <h3 className='text-base font-semibold'>
            Auto-Triage Substrate (Optional)
          </h3>
          <p className='text-sm text-muted-foreground'>
            Fill these in to make bugs for this app eligible for the auto-triage
            agent (clone repo → fix → deploy → verify → resolve).
          </p>
        </div>

        <FormField
          control={form.control}
          name='settings.github_repo'
          render={({ field }) => (
            <FormItem>
              <FormLabel>GitHub Repository (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder='owner/repo (e.g. Jicate-Solutions/BugReporter)'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Where the app&apos;s source code lives. Required for the
                auto-triage agent to open fix PRs.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='settings.deploy_hook_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vercel Deploy Hook URL (Optional)</FormLabel>
              <FormControl>
                <Input
                  type='url'
                  placeholder='https://api.vercel.com/v1/integrations/deploy/...'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                The auto-triage agent fires this after merging a fix to ship the
                build. Generate one from your Vercel project&apos;s Git settings.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='settings.test_credentials_note'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Test Credentials Note (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder='e.g. creator@example.in / demo123, or "Vercel env TEST_USER_EMAIL"'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                How the auto-triage agent should authenticate when verifying
                fixes in the browser. Use a demo account, never a real
                production credential.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='settings.auto_triage_policy.auto_merge_eligible'
          render={({ field }) => (
            <FormItem className='flex flex-row items-start gap-3 rounded-md border p-4'>
              <FormControl>
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className='space-y-1 leading-none'>
                <FormLabel>Allow Auto-Merge of Verified Fixes</FormLabel>
                <FormDescription>
                  When ON, the auto-triage agent may merge fixes for this app
                  without human review — but only if the diff stays clear of
                  danger zones (auth, RLS, migrations, payments, env, vercel
                  config) AND CI passes AND CFT verifies the fix. When OFF
                  (default), every PR waits for a human approver.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <Button
          type='submit'
          disabled={form.formState.isSubmitting}
          className='bg-linear-to-r from-blue-600 to-blue-700 text-white'
        >
          {form.formState.isSubmitting ? 'Saving...' : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
