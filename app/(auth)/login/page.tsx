'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bug } from 'lucide-react';

/**
 * Login Page - Google OAuth Only
 * Replaces email/password authentication with Google OAuth
 */
export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
      }

      // If successful, user will be redirected to Google OAuth
      // No need to handle further here
    } catch (err) {
      console.error('[Login] Unexpected error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50'>
      <div className='flex items-center justify-center p-4 pt-16'>
        <div className='w-full max-w-md'>
          {/* Login Card */}
          <Card className='border-2 shadow-xl'>
            <CardHeader className='space-y-3 pb-6'>
              <div className='flex justify-center'>
                <div className='p-3 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl shadow-lg'>
                  <Bug className='h-8 w-8 text-white' />
                </div>
              </div>
              <CardTitle className='text-2xl font-bold text-center'>
                Welcome to JICATE Control Tower
              </CardTitle>
              <CardDescription className='text-center text-base'>
                Sign in with your Google account to continue
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              {error && (
                <Alert variant='destructive' className='border-red-200'>
                  <AlertDescription className='text-sm'>
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              {/* Google Sign In Button */}
              <Button
                onClick={handleGoogleLogin}
                disabled={loading}
                className='w-full h-12 bg-white hover:bg-gray-50 text-gray-700 border-2 border-gray-300 hover:border-gray-400 shadow-sm font-medium text-base'
              >
                {loading ? (
                  <span className='flex items-center gap-3'>
                    <div className='h-5 w-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin' />
                    Redirecting to Google...
                  </span>
                ) : (
                  <span className='flex items-center gap-3'>
                    <svg className='h-5 w-5' viewBox='0 0 24 24'>
                      <path
                        fill='#4285F4'
                        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
                      />
                      <path
                        fill='#34A853'
                        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
                      />
                      <path
                        fill='#FBBC05'
                        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
                      />
                      <path
                        fill='#EA4335'
                        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
                      />
                    </svg>
                    Continue with Google
                  </span>
                )}
              </Button>

              {/* Information Box */}
              <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                <p className='text-sm text-blue-800 text-center'>
                  <strong>Note:</strong> Only authorized users can access this
                  platform. If you don&apos;t have access yet, please contact
                  your administrator.
                </p>
              </div>

              {/* Divider */}
              <div className='relative'>
                <div className='absolute inset-0 flex items-center'>
                  <div className='w-full border-t border-gray-300'></div>
                </div>
                <div className='relative flex justify-center text-sm'>
                  <span className='px-4 bg-white text-gray-500'>
                    Secure authentication powered by Google
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Back to Home */}
          <div className='text-center mt-6'>
            <Link
              href='/'
              className='text-sm text-gray-600 hover:text-gray-900 hover:underline inline-flex items-center gap-1'
            >
              <span>←</span> Back to Home
            </Link>
          </div>

          {/* Footer Info */}
          <div className='mt-8 text-center'>
            <p className='text-xs text-gray-500'>
              By signing in, you agree to our Terms of Service and Privacy
              Policy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
