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
import { Checkbox } from '@/components/ui/checkbox';
import { AllowedDomainsInput } from './allowed-domains-input';
import { AVAILABLE_AI_TASKS } from '@/lib/ai/tasks';
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
      .optional(),
    // AI door (₹0 Max lane). MUST stay registered in this schema: zod strips
    // unknown keys, so an unregistered settings.ai would be silently wiped on
    // every app edit (same reason auto_triage_policy lives here).
    ai: z
      .object({
        enabled: z.boolean().optional(),
        allowed_tasks: z.array(z.string()).optional()
      })
      .optional(),
    // Screenshot annotation. Edited from its own Settings card, NOT from this
    // form — registered here for the same reason as bug_portal below.
    annotation: z
      .object({
        enabled: z.boolean().optional(),
        tools: z.array(z.string()).optional()
      })
      .optional(),
    // Bug Status Portal. Edited from its own Settings card, NOT from this form —
    // but it must still be registered here, for exactly the reason above: this
    // form submits the whole `settings` object, so an unregistered bug_portal
    // would be stripped and the app's portal would switch itself off the next
    // time anyone edited the application's name or URL.
    bug_portal: z
      .object({
        enabled: z.boolean().optional(),
        allow_reporter_notes: z.boolean().optional(),
        allow_reporter_reopen: z.boolean().optional(),
        allow_reporter_status: z.boolean().optional(),
        require_signature: z.boolean().optional(),
        webhook_enabled: z.boolean().optional(),
        webhook_secret: z.string().optional()
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
        },
        ai: {
          enabled: application?.settings?.ai?.enabled ?? false,
          allowed_tasks: application?.settings?.ai?.allowed_tasks || []
        },
        // Passed straight through so saving this form preserves whatever the
        // Bug Status Portal and Screenshot annotation cards have configured.
        bug_portal: application?.settings?.bug_portal ?? undefined,
        annotation: application?.settings?.annotation ?? undefined
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

        <FormField
          control={form.control}
          name='settings.ai.enabled'
          render={({ field }) => (
            <FormItem className='flex flex-row items-start gap-3 rounded-md border p-4'>
              <FormControl>
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className='space-y-1 leading-none'>
                <FormLabel>Enable AI (₹0 Max lane)</FormLabel>
                <FormDescription>
                  When ON, this app may run the AI tasks ticked below using its
                  existing API key — jobs queue behind MyJKKN&apos;s own work
                  and run at ₹0 on the Max lane. When OFF (default), AI calls
                  return <code>ai_not_enabled</code>. Bug reporting is
                  unaffected either way.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        {form.watch('settings.ai.enabled') && (
          <FormField
            control={form.control}
            name='settings.ai.allowed_tasks'
            render={({ field }) => (
              <FormItem className='rounded-md border p-4'>
                <FormLabel>Approved AI tasks</FormLabel>
                <FormDescription>
                  The app can run ONLY the tasks ticked here (the &quot;set
                  menu&quot;). Anything else returns{' '}
                  <code>task_not_permitted</code>.
                </FormDescription>
                <div className='mt-3 space-y-3'>
                  {AVAILABLE_AI_TASKS.map((task) => {
                    const selected = field.value ?? [];
                    const checked = selected.includes(task.key);
                    return (
                      <div key={task.key} className='flex items-start gap-3'>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            field.onChange(
                              next === true
                                ? [...selected, task.key]
                                : selected.filter((k) => k !== task.key)
                            );
                          }}
                        />
                        <div className='space-y-0.5 leading-none'>
                          <p className='text-sm font-medium'>
                            {task.label}{' '}
                            <code className='text-muted-foreground text-xs'>
                              {task.key}
                            </code>
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {task.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

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
