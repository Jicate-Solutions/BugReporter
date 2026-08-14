'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Clock, Mail, Shield, ArrowRight, UserCheck } from 'lucide-react';

/**
 * Copy for each reason a user can land here. Approval and organization
 * assignment are two independent gates - a user can clear the first and still
 * be stuck on the second, so the page must not describe both as "pending
 * approval".
 */
const REASONS = {
  pending_approval: {
    icon: Clock,
    iconClass: 'from-yellow-400 to-orange-500',
    title: 'Access Pending',
    description: 'Your account is awaiting administrator approval',
    statusHeading: 'Account Created Successfully',
    statusBody: (email: string) => (
      <>
        Your account (<strong>{email}</strong>) has been created and is waiting for
        a platform administrator to approve it.
      </>
    ),
    steps: [
      'A platform administrator will review your request',
      "You'll be assigned to appropriate organizations and applications",
      "Once approved, you'll be able to access the platform"
    ]
  },
  no_organization: {
    icon: UserCheck,
    iconClass: 'from-blue-400 to-indigo-500',
    title: 'Awaiting Organization Access',
    description: 'Your account is approved, but no organization has been assigned',
    statusHeading: 'Account Approved',
    statusBody: (email: string) => (
      <>
        Your account (<strong>{email}</strong>) has been approved, but you
        haven&apos;t been added to any organization yet.
      </>
    ),
    steps: [
      'An administrator adds you to an organization and its applications',
      'Sign out and sign back in so your new access is picked up',
      "You'll land in your organization's workspace"
    ]
  }
} as const;

/**
 * Waiting Access Content Component
 */
function WaitingAccessContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || 'your email';
  const reasonParam = searchParams.get('reason');
  const reason =
    reasonParam === 'no_organization'
      ? REASONS.no_organization
      : REASONS.pending_approval;
  const ReasonIcon = reason.icon;

  return (
    <div className='min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4'>
      <div className='w-full max-w-lg'>
        <Card className='border-2 shadow-xl'>
          <CardHeader className='space-y-4 pb-6'>
            <div className='flex justify-center'>
              <div
                className={`p-4 bg-gradient-to-br ${reason.iconClass} rounded-2xl shadow-lg`}
              >
                <ReasonIcon className='h-10 w-10 text-white' />
              </div>
            </div>
            <CardTitle className='text-2xl font-bold text-center'>
              {reason.title}
            </CardTitle>
            <CardDescription className='text-center text-base'>
              {reason.description}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-6'>
            {/* Status Message */}
            <div className='bg-blue-50 border-2 border-blue-200 rounded-lg p-5'>
              <div className='flex items-start gap-3'>
                <Shield className='h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0' />
                <div className='space-y-2'>
                  <p className='text-sm font-medium text-blue-900'>
                    {reason.statusHeading}
                  </p>
                  <p className='text-sm text-blue-800'>
                    {reason.statusBody(email)}
                  </p>
                </div>
              </div>
            </div>

            {/* What's Next */}
            <div className='space-y-3'>
              <h3 className='font-semibold text-gray-900'>What happens next?</h3>
              <ul className='space-y-3'>
                {reason.steps.map((step, index) => (
                  <li key={step} className='flex items-start gap-3'>
                    <div className='h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5'>
                      <span className='text-xs font-bold text-blue-600'>
                        {index + 1}
                      </span>
                    </div>
                    <p className='text-sm text-gray-700'>{step}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact Admin */}
            <div className='bg-gray-50 border border-gray-200 rounded-lg p-4'>
              <div className='flex items-start gap-3'>
                <Mail className='h-5 w-5 text-gray-600 mt-0.5 flex-shrink-0' />
                <div className='space-y-1'>
                  <p className='text-sm font-medium text-gray-900'>
                    Need immediate access?
                  </p>
                  <p className='text-sm text-gray-600'>
                    Contact your platform administrator to expedite the approval process.
                  </p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className='relative'>
              <div className='absolute inset-0 flex items-center'>
                <div className='w-full border-t border-gray-300'></div>
              </div>
              <div className='relative flex justify-center text-sm'>
                <span className='px-4 bg-white text-gray-500'>
                  or
                </span>
              </div>
            </div>

            {/* Action Button */}
            <Button
              onClick={() => window.location.reload()}
              variant='outline'
              className='w-full h-11 border-2 border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-700 font-medium'
            >
              <span className='flex items-center gap-2'>
                Check Access Status
                <ArrowRight className='h-4 w-4' />
              </span>
            </Button>
          </CardContent>
        </Card>

        {/* Back to Login */}
        <div className='text-center mt-6'>
          <Link
            href='/login'
            className='text-sm text-gray-600 hover:text-gray-900 hover:underline inline-flex items-center gap-1'
          >
            <span>←</span> Back to Login
          </Link>
        </div>

        {/* Footer Info */}
        <div className='mt-8 p-4 bg-white/50 backdrop-blur-sm border border-gray-200 rounded-lg'>
          <p className='text-xs text-gray-600 text-center'>
            <strong>Note:</strong> This is a secure platform with role-based access control.
            All users must be explicitly granted access by administrators.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Waiting Access Page
 * Shown to users who have logged in but don't have any organization assignments
 */
export default function WaitingAccessPage() {
  return (
    <Suspense fallback={<div className='min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center'><div className='text-gray-600'>Loading...</div></div>}>
      <WaitingAccessContent />
    </Suspense>
  );
}
