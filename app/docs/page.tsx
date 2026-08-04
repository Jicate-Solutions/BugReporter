import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Code,
  ArrowRight,
  CheckCircle2,
  Package,
  Settings,
  Zap,
  AlertCircle,
  BookOpen,
  Copy,
  ExternalLink,
  FileUp,
  BarChart3,
  Trophy,
  Network
} from 'lucide-react';
import { HomepageNav } from '../_components/homepage-nav';
import { DocActions, FullDocDownloadCard } from './_components/doc-actions';

export default function DocumentationPage() {
  return (
    <div className='min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50'>
      {/* Header */}
      <header className='border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm'>
        <div className='container mx-auto px-4 py-4'>
          <div className='flex items-center justify-between'>
            <Link href='/' className='flex items-center gap-3'>
              <div className='h-10 w-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center text-white font-bold shadow-md'>
                <BookOpen className='h-6 w-6' />
              </div>
              <div>
                <h1 className='text-xl font-bold text-gray-900'>
                  Integration Documentation
                </h1>
                <p className='text-xs text-gray-600'>JKKN Bug Reporter</p>
              </div>
            </Link>
            <HomepageNav />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className='py-16 bg-gradient-to-r from-blue-600 to-blue-900 text-white'>
        <div className='container mx-auto px-4'>
          <div className='max-w-4xl mx-auto text-center space-y-6'>
            <div className='inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium mb-4'>
              <Code className='h-4 w-4' />
              Developer Documentation
            </div>
            <h1 className='text-4xl md:text-6xl font-extrabold'>
              Integration Guide
            </h1>
            <p className='text-xl text-blue-100 max-w-2xl mx-auto'>
              Complete Bug Bounty Platform SDK v1.3.0 - File Attachments, Leaderboards, Enhanced Bug Viewing, and More
            </p>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className='py-16'>
        <div className='container mx-auto px-4'>
          <div className='max-w-6xl mx-auto'>

            {/* Quick Start */}
            <Card className='mb-8 border-2 border-blue-200 bg-blue-50/50'>
              <CardHeader>
                <div className='flex items-center gap-3'>
                  <div className='h-12 w-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center'>
                    <Zap className='h-6 w-6 text-white' />
                  </div>
                  <div>
                    <CardTitle className='text-2xl'>Quick Start</CardTitle>
                    <CardDescription className='text-base'>
                      Get up and running in 5 minutes
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid md:grid-cols-3 gap-4'>
                  <div className='flex items-start gap-3 p-4 bg-white rounded-lg border'>
                    <div className='h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0'>
                      <span className='text-blue-700 font-bold'>1</span>
                    </div>
                    <div>
                      <h4 className='font-semibold mb-1'>Install SDK</h4>
                      <p className='text-sm text-muted-foreground'>
                        Add the bug reporter package to your project
                      </p>
                    </div>
                  </div>
                  <div className='flex items-start gap-3 p-4 bg-white rounded-lg border'>
                    <div className='h-8 w-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0'>
                      <span className='text-green-700 font-bold'>2</span>
                    </div>
                    <div>
                      <h4 className='font-semibold mb-1'>Get API Key</h4>
                      <p className='text-sm text-muted-foreground'>
                        Create an application and generate API key
                      </p>
                    </div>
                  </div>
                  <div className='flex items-start gap-3 p-4 bg-white rounded-lg border'>
                    <div className='h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0'>
                      <span className='text-purple-700 font-bold'>3</span>
                    </div>
                    <div>
                      <h4 className='font-semibold mb-1'>Initialize</h4>
                      <p className='text-sm text-muted-foreground'>
                        Wrap your app with BugReporterProvider
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Full Documentation Download */}
            <FullDocDownloadCard />

            {/* Detailed Steps */}
            <Tabs defaultValue="installation" className='space-y-8'>
              <TabsList className='grid w-full grid-cols-3 lg:w-auto lg:grid-cols-6'>
                <TabsTrigger value="installation">Installation</TabsTrigger>
                <TabsTrigger value="configuration">Configuration</TabsTrigger>
                <TabsTrigger value="nextjs">Next.js Setup</TabsTrigger>
                <TabsTrigger value="features">Features</TabsTrigger>
                <TabsTrigger value="portal">Status Portal</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              {/* Installation Tab */}
              <TabsContent value="installation" className='space-y-6'>
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <Package className='h-5 w-5' />
                          Step 1: Installation
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Install the Bug Reporter SDK package in your Next.js project
                        </CardDescription>
                      </div>
                      <DocActions tabId="installation" />
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div>
                      <h4 className='font-semibold mb-2 flex items-center gap-2'>
                        <span className='h-6 w-6 bg-blue-100 rounded flex items-center justify-center text-xs text-blue-700'>
                          1
                        </span>
                        Install the SDK Package
                      </h4>

                      <div className='space-y-3'>
                        <div>
                          <p className='text-sm font-medium mb-2 flex items-center gap-2'>
                            <span className='px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-semibold'>
                              Recommended
                            </span>
                            Option A: Install from npm
                          </p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-sm overflow-x-auto'>
                            <pre>npm install @boobalan_jkkn/bug-reporter-sdk</pre>
                          </div>
                          <p className='text-sm text-muted-foreground mt-2'>
                            Or using yarn:
                          </p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-sm overflow-x-auto mt-2'>
                            <pre>yarn add @boobalan_jkkn/bug-reporter-sdk</pre>
                          </div>
                        </div>

                        <div>
                          <p className='text-sm font-medium mb-2'>Option B: Install from file path (for development)</p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-sm overflow-x-auto'>
                            <pre>npm install file:../packages/bug-reporter-sdk</pre>
                          </div>
                        </div>

                        <div>
                          <p className='text-sm font-medium mb-2'>Option C: Install from built package</p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                            <pre>{`# First, build the SDK package
cd packages/bug-reporter-sdk
npm run build

# Then install in your project
cd your-project-directory
npm install file:path/to/packages/bug-reporter-sdk`}</pre>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className='bg-green-50 border border-green-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <CheckCircle2 className='h-5 w-5 text-green-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-green-900 mb-1'>
                            ✅ Published on npm Registry
                          </h5>
                          <p className='text-sm text-green-800 mb-2'>
                            The SDK is now available on npm as <code className='bg-green-100 px-1 rounded'>@boobalan_jkkn/bug-reporter-sdk@1.3.0</code>. Simply install it using npm or yarn - no additional setup required!
                          </p>
                          <div className='flex flex-col sm:flex-row gap-2 mt-3'>
                            <a
                              href='https://www.npmjs.com/package/@boobalan_jkkn/bug-reporter-sdk'
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-sm text-green-700 hover:text-green-900 underline inline-flex items-center gap-1'
                            >
                              View SDK on npm <ExternalLink className='h-3 w-3' />
                            </a>
                            <span className='hidden sm:inline text-green-600'>•</span>
                            <a
                              href='https://www.npmjs.com/package/@boobalan_jkkn/shared'
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-sm text-green-700 hover:text-green-900 underline inline-flex items-center gap-1'
                            >
                              View Shared Types <ExternalLink className='h-3 w-3' />
                            </a>
                          </div>
                          <div className='mt-3 pt-3 border-t border-green-200'>
                            <p className='text-xs text-green-700 font-medium mb-1'>📦 Package Details:</p>
                            <ul className='text-xs text-green-800 space-y-0.5'>
                              <li>• Version: 1.3.0 (Latest)</li>
                              <li>• Size: 41.3 KB (211.5 KB unpacked)</li>
                              <li>• Includes: CJS, ESM, TypeScript definitions</li>
                              <li>• Dependencies: 3 (including @boobalan_jkkn/shared)</li>
                              <li>✨ NEW in v1.3.0: File Attachments + Leaderboard + Enhanced Bug Viewing</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <AlertCircle className='h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-blue-900 mb-1'>
                            Getting 404 Error?
                          </h5>
                          <p className='text-sm text-blue-800 mb-2'>
                            If you see "npm error 404 Not Found" when installing, clear your npm cache first:
                          </p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-3 font-mono text-xs overflow-x-auto'>
                            <pre>npm cache clean --force{'\n'}npm install @boobalan_jkkn/bug-reporter-sdk</pre>
                          </div>
                          <p className='text-xs text-blue-700 mt-2'>
                            This happens when npm's local cache hasn't updated with newly published packages.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className='bg-amber-50 border border-amber-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <AlertCircle className='h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-amber-900 mb-1'>
                            Requirements
                          </h5>
                          <p className='text-sm text-amber-800'>
                            • Next.js 15+ with App Router<br />
                            • React 19+<br />
                            • TypeScript 5+ (recommended)<br />
                            • Node.js 18+
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Configuration Tab */}
              <TabsContent value="configuration" className='space-y-6'>
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <Settings className='h-5 w-5' />
                          Step 2: Get Your API Key
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Generate API credentials from the JKKN Bug Reporter platform
                        </CardDescription>
                      </div>
                      <DocActions tabId="configuration" />
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-6'>
                    <div className='space-y-4'>
                      <div className='flex items-start gap-3'>
                        <CheckCircle2 className='h-5 w-5 text-green-600 mt-0.5' />
                        <div>
                          <h4 className='font-semibold mb-1'>1. Sign up / Log in</h4>
                          <p className='text-sm text-muted-foreground'>
                            Go to{' '}
                            <Link href='/login' className='text-blue-600 hover:underline'>
                              platform login page
                            </Link>{' '}
                            and authenticate
                          </p>
                        </div>
                      </div>

                      <div className='flex items-start gap-3'>
                        <CheckCircle2 className='h-5 w-5 text-green-600 mt-0.5' />
                        <div>
                          <h4 className='font-semibold mb-1'>2. Create Organization</h4>
                          <p className='text-sm text-muted-foreground'>
                            Create a new organization (usually your department name) or join an existing one
                          </p>
                        </div>
                      </div>

                      <div className='flex items-start gap-3'>
                        <CheckCircle2 className='h-5 w-5 text-green-600 mt-0.5' />
                        <div>
                          <h4 className='font-semibold mb-1'>3. Register Application</h4>
                          <p className='text-sm text-muted-foreground'>
                            Navigate to Applications → New Application and register your app
                          </p>
                          <div className='mt-2 bg-slate-100 rounded p-3 text-sm space-y-2'>
                            <div className='flex gap-2'>
                              <span className='font-medium min-w-[100px]'>Name:</span>
                              <span>Your application name</span>
                            </div>
                            <div className='flex gap-2'>
                              <span className='font-medium min-w-[100px]'>Slug:</span>
                              <span>unique-app-slug</span>
                            </div>
                            <div className='flex gap-2'>
                              <span className='font-medium min-w-[100px]'>Description:</span>
                              <span>Brief description of your app</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className='flex items-start gap-3'>
                        <CheckCircle2 className='h-5 w-5 text-green-600 mt-0.5' />
                        <div>
                          <h4 className='font-semibold mb-1'>4. Copy API Key</h4>
                          <p className='text-sm text-muted-foreground mb-2'>
                            After creating the application, you'll receive an API key. Copy and save it securely.
                          </p>
                          <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs'>
                            <pre>app_xxxxxxxxxxxxxxxxxxxxxxxxxx</pre>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className='bg-red-50 border border-red-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <AlertCircle className='h-5 w-5 text-red-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-red-900 mb-1'>
                            Security Warning
                          </h5>
                          <p className='text-sm text-red-800'>
                            Never commit API keys to version control. Use environment variables to store sensitive credentials.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Next.js Setup Tab */}
              <TabsContent value="nextjs" className='space-y-6'>
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <Code className='h-5 w-5' />
                          Step 3: Next.js Integration
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Complete setup for Next.js 15 with App Router
                        </CardDescription>
                      </div>
                      <DocActions tabId="nextjs" />
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-6'>
                    {/* Environment Variables */}
                    <div>
                      <h4 className='font-semibold mb-3 text-lg'>3.1. Environment Variables</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Create a <code className='bg-slate-100 px-2 py-0.5 rounded text-xs'>.env.local</code> file in your project root:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-sm overflow-x-auto'>
                        <pre>{`# JKKN Bug Reporter Configuration
NEXT_PUBLIC_BUG_REPORTER_API_KEY=app_your_api_key_here
NEXT_PUBLIC_BUG_REPORTER_API_URL=https://your-platform.vercel.app`}</pre>
                      </div>
                    </div>

                    {/* Root Layout Setup */}
                    <div>
                      <h4 className='font-semibold mb-3 text-lg'>3.2. Root Layout Setup</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Update your <code className='bg-slate-100 px-2 py-0.5 rounded text-xs'>app/layout.tsx</code>:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`import { BugReporterProvider } from '@boobalan_jkkn/bug-reporter-sdk';
import { Toaster } from 'react-hot-toast';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BugReporterProvider
          apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
          apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
          enabled={true}
          debug={process.env.NODE_ENV === 'development'}
          userContext={{
            userId: 'user-id-here', // Optional
            name: 'John Doe',       // Optional
            email: 'user@jkkn.ac.in' // Optional
          }}
        >
          {children}
        </BugReporterProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}`}</pre>
                      </div>
                    </div>

                    {/* With Auth (Supabase) */}
                    <div>
                      <h4 className='font-semibold mb-3 text-lg'>3.3. With Supabase Authentication</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        For authenticated apps using Supabase:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`'use client';

import { BugReporterProvider } from '@boobalan_jkkn/bug-reporter-sdk';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function BugReporterWrapper({
  children
}: {
  children: React.ReactNode
}) {
  const [user, setUser] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  return (
    <BugReporterProvider
      apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
      apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
      enabled={true}
      userContext={user ? {
        userId: user.id,
        name: user.user_metadata?.full_name,
        email: user.email
      } : undefined}
    >
      {children}
    </BugReporterProvider>
  );
}`}</pre>
                      </div>
                    </div>

                    {/* Features */}
                    <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                      <h5 className='font-semibold text-blue-900 mb-2 flex items-center gap-2'>
                        <Zap className='h-4 w-4' />
                        What You Get (v1.3.0)
                      </h5>
                      <ul className='space-y-1 text-sm text-blue-800'>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          🐛 Floating bug report button (bottom-right)
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          📸 <strong>MANDATORY</strong> screenshot capture
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          📎 <strong>NEW:</strong> File attachments (up to 5 files, 10MB each)
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          🔍 <strong>AUTOMATIC</strong> console logs capture
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          🌐 <strong>NEW:</strong> Network request capture (fetch/XHR)
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          📊 <strong>NEW:</strong> Enhanced bug viewing with stats & filters
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          🏆 <strong>NEW:</strong> Leaderboard system with medals & prizes
                        </li>
                        <li className='flex items-center gap-2'>
                          <CheckCircle2 className='h-4 w-4' />
                          👤 User context tracking
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Features Tab - v1.3.0 */}
              <TabsContent value="features" className='space-y-6'>
                {/* File Attachments */}
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <FileUp className='h-5 w-5 text-purple-600' />
                          File Attachments
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Upload files directly with bug reports for better context
                        </CardDescription>
                      </div>
                      <div className='inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold'>
                        NEW in v1.3.0
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='bg-purple-50 border border-purple-200 rounded-lg p-4'>
                      <h5 className='font-semibold text-purple-900 mb-2'>Key Features</h5>
                      <ul className='space-y-1.5 text-sm text-purple-800'>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Up to 5 files</strong> per bug report</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>10MB per file</strong> size limit with validation</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span>Supported types: <strong>Images</strong> (PNG, JPG, GIF, WebP), <strong>PDF</strong>, <strong>TXT</strong>, <strong>CSV</strong>, <strong>JSON</strong></span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Image preview thumbnails</strong> in upload dialog</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Automatic validation</strong> for file size and type</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span>Stored securely in <strong>Supabase Storage</strong> organized by application</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h5 className='font-semibold mb-2'>How It Works</h5>
                      <p className='text-sm text-muted-foreground mb-3'>
                        File upload is built directly into the bug reporting widget. No additional configuration needed!
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`// Files upload automatically available in bug widget
<BugReporterProvider
  apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
  apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
>
  {children}
</BugReporterProvider>

// When users click the bug button:
// 1. They fill out bug details
// 2. Click "Choose Files" to add attachments
// 3. Preview shows selected files
// 4. Submit - files are uploaded automatically!`}</pre>
                      </div>
                    </div>

                    <div className='bg-amber-50 border border-amber-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <AlertCircle className='h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-amber-900 mb-1'>File Size Limits</h5>
                          <p className='text-sm text-amber-800'>
                            • Maximum <strong>10MB per file</strong><br />
                            • Maximum <strong>5 files</strong> per bug report<br />
                            • Compress large images before uploading
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Enhanced MyBugsPanel */}
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <BarChart3 className='h-5 w-5 text-blue-600' />
                          Enhanced Bug Viewing
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Completely redesigned MyBugsPanel with statistics and advanced filtering
                        </CardDescription>
                      </div>
                      <div className='inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold'>
                        ENHANCED in v1.3.0
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                      <h5 className='font-semibold text-blue-900 mb-2'>What's New</h5>
                      <ul className='space-y-1.5 text-sm text-blue-800'>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Statistics Dashboard</strong> - Total, Open, In Progress, Resolved counts</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Advanced Filtering</strong> - Filter by All, Open, In Progress, Resolved, Closed</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Expandable Cards</strong> - Click to view full bug details</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Attachment Grid Viewer</strong> - View all files with image previews</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Screenshot Preview</strong> - Integrated screenshot viewer</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Color-coded Badges</strong> - Status and category visual indicators</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Smart Dates</strong> - "Just now", "5m ago", "2h ago" formatting</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Mobile Responsive</strong> - Works perfectly on all devices</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h5 className='font-semibold mb-2'>Usage Example</h5>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Add the MyBugsPanel component to any page where users should see their bugs:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`import { MyBugsPanel } from '@boobalan_jkkn/bug-reporter-sdk';

export default function MyBugsPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">My Bug Reports</h1>

      {/* No props needed - uses context from BugReporterProvider */}
      <MyBugsPanel />

      {/* Features:
        ✓ Statistics bar at top
        ✓ Status filter tabs
        ✓ Expandable bug cards
        ✓ Attachment viewer
        ✓ Screenshot preview
        ✓ Status badges
        ✓ Empty states
      */}
    </div>
  );
}`}</pre>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Leaderboard System */}
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <Trophy className='h-5 w-5 text-amber-600' />
                          Leaderboard System
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Track and reward top bug reporters with medals, points, and prizes
                        </CardDescription>
                      </div>
                      <div className='inline-flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold'>
                        NEW in v1.3.0
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='bg-amber-50 border border-amber-200 rounded-lg p-4'>
                      <h5 className='font-semibold text-amber-900 mb-2'>Key Features</h5>
                      <ul className='space-y-1.5 text-sm text-amber-800'>
                        <li className='flex items-start gap-2'>
                          <Trophy className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Medal System</strong> - Gold, Silver, Bronze for top 3 positions</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Period Toggles</strong> - View All Time, This Week, or This Month rankings</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Prize Display</strong> - Shows weekly and monthly prize amounts</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Points System</strong> - Configurable points per priority (Low/Medium/High/Critical)</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>User Profiles</strong> - Avatars, names, emails displayed</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Rankings Table</strong> - Professional leaderboard design</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h5 className='font-semibold mb-2'>Usage Example</h5>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Add the LeaderboardPanel component to display top bug reporters:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`import { LeaderboardPanel } from '@boobalan_jkkn/bug-reporter-sdk';

export default function LeaderboardPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Top Bug Reporters</h1>

      <LeaderboardPanel
        applicationId="your-app-id"  // Required: Your application ID
        limit={10}                    // Optional: Max entries (default: 10)
        defaultPeriod="all-time"      // Optional: 'all-time' | 'weekly' | 'monthly'
      />

      {/* Features:
        ✓ Period selector (All Time / This Week / This Month)
        ✓ Prize information card
        ✓ Points system breakdown
        ✓ Top 3 with medal icons
        ✓ User avatars with initials fallback
        ✓ Sortable rankings
        ✓ Empty state handling
        ✓ Disabled state support
      */}
    </div>
  );
}`}</pre>
                      </div>
                    </div>

                    <div>
                      <h5 className='font-semibold mb-2'>Props Reference</h5>
                      <div className='overflow-x-auto'>
                        <table className='w-full text-sm border rounded-lg'>
                          <thead className='bg-slate-100'>
                            <tr>
                              <th className='text-left p-3 font-semibold border-b'>Prop</th>
                              <th className='text-left p-3 font-semibold border-b'>Type</th>
                              <th className='text-left p-3 font-semibold border-b'>Required</th>
                              <th className='text-left p-3 font-semibold border-b'>Default</th>
                              <th className='text-left p-3 font-semibold border-b'>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className='border-b'>
                              <td className='p-3 font-mono text-xs'>applicationId</td>
                              <td className='p-3 font-mono text-xs'>string</td>
                              <td className='p-3'><span className='px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs'>Yes</span></td>
                              <td className='p-3'>-</td>
                              <td className='p-3'>Application ID to show leaderboard for</td>
                            </tr>
                            <tr className='border-b'>
                              <td className='p-3 font-mono text-xs'>limit</td>
                              <td className='p-3 font-mono text-xs'>number</td>
                              <td className='p-3'><span className='px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs'>No</span></td>
                              <td className='p-3 font-mono text-xs'>10</td>
                              <td className='p-3'>Maximum number of entries to display</td>
                            </tr>
                            <tr>
                              <td className='p-3 font-mono text-xs'>defaultPeriod</td>
                              <td className='p-3 font-mono text-xs'>'all-time' | 'weekly' | 'monthly'</td>
                              <td className='p-3'><span className='px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs'>No</span></td>
                              <td className='p-3 font-mono text-xs'>'all-time'</td>
                              <td className='p-3'>Initial time period to display</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Network Request Capture */}
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          <Network className='h-5 w-5 text-green-600' />
                          Network Request Capture
                        </CardTitle>
                        <CardDescription className='mt-1.5'>
                          Automatically capture HTTP/XHR requests for debugging context (from v1.2.0)
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='bg-green-50 border border-green-200 rounded-lg p-4'>
                      <h5 className='font-semibold text-green-900 mb-2'>Key Features</h5>
                      <ul className='space-y-1.5 text-sm text-green-800'>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Automatic Capture</strong> - Intercepts fetch() and XMLHttpRequest</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Circular Buffer</strong> - Stores last N requests (default: 10)</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Security</strong> - Automatically filters sensitive headers (Authorization, Cookie, API keys)</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Custom Exclusions</strong> - Configure URL patterns to exclude from capture</span>
                        </li>
                        <li className='flex items-start gap-2'>
                          <CheckCircle2 className='h-4 w-4 mt-0.5 flex-shrink-0' />
                          <span><strong>Self-Excluding</strong> - SDK's own API calls are automatically excluded</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h5 className='font-semibold mb-2'>Configuration Example</h5>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Customize network capture behavior:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`<BugReporterProvider
  apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
  apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}

  // Network capture configuration
  networkCapture={true}              // Enable/disable (default: true)
  networkBufferSize={10}             // Max requests to store (default: 10)
  networkExcludePatterns={[          // Custom exclusions
    /analytics\\.google\\.com/,
    /tracking-service\\.com/,
    /\\/api\\/internal\\//
  ]}
>
  {children}
</BugReporterProvider>

// Network requests are automatically captured and sent with bug reports!`}</pre>
                      </div>
                    </div>

                    <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                      <div className='flex items-start gap-3'>
                        <AlertCircle className='h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5' />
                        <div>
                          <h5 className='font-semibold text-blue-900 mb-1'>Privacy Note</h5>
                          <p className='text-sm text-blue-800'>
                            • Request/response <strong>bodies are NOT captured</strong> for privacy and performance<br />
                            • Sensitive headers are automatically filtered<br />
                            • Only last N requests are kept (configurable)<br />
                            • SDK's own API calls are excluded to prevent recursion
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Bug Status Portal Tab */}
              <TabsContent value="portal" className='space-y-6'>
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle>Bug Status Portal</CardTitle>
                        <CardDescription className='mt-1.5'>
                          Let reporters track their own bugs and reply to your
                          team. Off by default — enable it per application.
                        </CardDescription>
                      </div>
                      <DocActions tabId="portal" />
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-6'>
                    <ol className='space-y-4'>
                      <li className='flex gap-3'>
                        <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium'>
                          1
                        </span>
                        <div>
                          <p className='font-medium'>Turn it on</p>
                          <p className='text-sm text-muted-foreground'>
                            Your application &rarr; Settings &rarr; Bug Status
                            Portal &rarr; flip the switch.
                          </p>
                        </div>
                      </li>
                      <li className='flex gap-3'>
                        <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium'>
                          2
                        </span>
                        <div>
                          <p className='font-medium'>Copy the link</p>
                          <p className='text-sm text-muted-foreground'>
                            It arrives with your application&apos;s slug already
                            filled in.
                          </p>
                        </div>
                      </li>
                      <li className='flex gap-3'>
                        <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium'>
                          3
                        </span>
                        <div>
                          <p className='font-medium'>Paste it into your app</p>
                          <p className='text-sm text-muted-foreground'>
                            Append the signed-in user&apos;s email. No SDK
                            upgrade and no API key required.
                          </p>
                        </div>
                      </li>
                    </ol>

                    <pre className='rounded-md bg-muted p-4 text-xs overflow-x-auto'>
{`<a href={\`https://<your-bugreporter-host>/portal/my-app?u=\${encodeURIComponent(user.email)}\`}>
  My bug reports
</a>`}
                    </pre>

                    <p className='text-sm text-muted-foreground'>
                      Use the download button above for the full reference —
                      per-reporter scoping, the read and notes endpoints, signed
                      links, and webhook signature verification.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Advanced Tab */}
              <TabsContent value="advanced" className='space-y-6'>
                <Card>
                  <CardHeader>
                    <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
                      <div>
                        <CardTitle>Advanced Configuration</CardTitle>
                        <CardDescription className='mt-1.5'>
                          Customize behavior and add advanced features
                        </CardDescription>
                      </div>
                      <DocActions tabId="advanced" />
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-6'>
                    {/* Custom Styling */}
                    <div>
                      <h4 className='font-semibold mb-2'>Custom Widget Styling</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Override default styles using CSS classes:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`/* globals.css */
.bug-reporter-widget {
  /* Custom floating button styles */
  bottom: 2rem !important;
  right: 2rem !important;
}

.bug-reporter-sdk {
  /* Custom modal/widget styles */
  font-family: 'Your Custom Font' !important;
}`}</pre>
                      </div>
                    </div>

                    {/* Conditional Rendering */}
                    <div>
                      <h4 className='font-semibold mb-2'>Conditional Rendering</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Show/hide bug reporter based on conditions:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`<BugReporterProvider
  apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
  apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
  enabled={
    process.env.NODE_ENV === 'production' &&
    user?.role === 'beta-tester'
  }
  debug={false}
>
  {children}
</BugReporterProvider>`}</pre>
                      </div>
                    </div>

                    {/* My Bugs Panel */}
                    <div>
                      <h4 className='font-semibold mb-2'>Add "My Bugs" Panel</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Let users view their submitted bugs:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`import { MyBugsPanel } from '@boobalan_jkkn/bug-reporter-sdk';

export default function ProfilePage() {
  return (
    <div>
      <h1>My Profile</h1>
      <MyBugsPanel />
    </div>
  );
}`}</pre>
                      </div>
                    </div>

                    {/* Programmatic Reporting */}
                    <div>
                      <h4 className='font-semibold mb-2'>Programmatic Bug Reporting</h4>
                      <p className='text-sm text-muted-foreground mb-3'>
                        Trigger bug reports from code:
                      </p>
                      <div className='bg-slate-950 text-slate-50 rounded-lg p-4 font-mono text-xs overflow-x-auto'>
                        <pre>{`import { useBugReporter } from '@boobalan_jkkn/bug-reporter-sdk';

function MyComponent() {
  const { apiClient } = useBugReporter();

  const handleError = async (error: Error) => {
    try {
      await apiClient?.createBugReport({
        title: 'Automatic Error Report',
        description: error.message,
        page_url: window.location.href,
        category: 'error',
        console_logs: [],
      });
    } catch (err) {
      console.error('Failed to report bug:', err);
    }
  };

  return <button onClick={() => handleError(new Error('Test'))}>
    Report Error
  </button>;
}`}</pre>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Troubleshooting */}
                <Card>
                  <CardHeader>
                    <CardTitle>Troubleshooting</CardTitle>
                    <CardDescription>
                      Common issues and solutions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='space-y-4'>
                      <div className='border-l-4 border-purple-500 bg-purple-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>npm install shows 404 error?</h5>
                        <p className='text-sm text-muted-foreground mb-2'>
                          • Clear npm cache: <code className='bg-purple-100 px-1.5 py-0.5 rounded text-xs'>npm cache clean --force</code><br />
                          • Wait 5-10 minutes if package was just published<br />
                          • Try with explicit registry: <code className='bg-purple-100 px-1.5 py-0.5 rounded text-xs'>npm install @boobalan_jkkn/bug-reporter-sdk --registry=https://registry.npmjs.org/</code><br />
                          • Verify package exists at: <a href='https://www.npmjs.com/package/@boobalan_jkkn/bug-reporter-sdk' target='_blank' className='text-purple-700 hover:underline'>npmjs.com</a>
                        </p>
                      </div>

                      <div className='border-l-4 border-amber-500 bg-amber-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>Widget not appearing?</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Check that <code>enabled={true}</code> is set<br />
                          • Verify API key is correct<br />
                          • Check browser console for errors<br />
                          • Ensure API URL is reachable
                        </p>
                      </div>

                      <div className='border-l-4 border-red-500 bg-red-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>API key validation failed?</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Verify API key starts with "app_"<br />
                          • Check that application is active<br />
                          • Ensure API URL matches platform URL<br />
                          • Try regenerating the API key
                        </p>
                      </div>

                      <div className='border-l-4 border-blue-500 bg-blue-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>Screenshots not capturing? (v1.1.0+)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Screenshot is now MANDATORY - widget won't open without it<br />
                          • Browser may block html2canvas library<br />
                          • Check Content Security Policy (CSP)<br />
                          • Verify no conflicting screenshot libraries<br />
                          • Try closing overlays/modals and retry
                        </p>
                      </div>

                      <div className='border-l-4 border-green-500 bg-green-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>Console logs empty? (v1.1.0+)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Logs capture automatically in v1.1.0+<br />
                          • Perform actions that generate console output before reporting<br />
                          • Verify you're using v1.1.0 or later: <code className='bg-green-100 px-1 rounded text-xs'>npm list @boobalan_jkkn/bug-reporter-sdk</code><br />
                          • Check BugReporterProvider wraps your app correctly
                        </p>
                      </div>

                      <div className='border-l-4 border-orange-500 bg-orange-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>How to update to v1.3.0?</h5>
                        <p className='text-sm text-muted-foreground mb-2'>
                          If you already have the SDK installed, update to the latest version:
                        </p>
                        <div className='bg-slate-950 text-slate-50 rounded p-2 font-mono text-xs mb-2'>
                          npm install @boobalan_jkkn/bug-reporter-sdk@latest
                        </div>
                        <p className='text-sm text-muted-foreground'>
                          ✅ No breaking changes - fully backward compatible!<br />
                          ✅ New features work automatically<br />
                          ✅ No configuration changes needed
                        </p>
                      </div>

                      <div className='border-l-4 border-purple-500 bg-purple-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>File upload fails? (v1.3.0)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Check file size: Max <strong>10MB per file</strong><br />
                          • Check file type: Only images, PDF, TXT, CSV, JSON allowed<br />
                          • Check file count: Max <strong>5 files</strong> per report<br />
                          • Verify Supabase Storage bucket is created and public<br />
                          • Check browser console for upload errors
                        </p>
                      </div>

                      <div className='border-l-4 border-cyan-500 bg-cyan-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>Leaderboard not showing? (v1.3.0)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • <strong>"Leaderboard is disabled"</strong> message: Enable in organization settings<br />
                          • Verify correct <code className='bg-cyan-100 px-1 rounded text-xs'>applicationId</code> prop<br />
                          • Check API key has access to application<br />
                          • Open browser DevTools Network tab to see API errors<br />
                          • Ensure organization has leaderboard config created
                        </p>
                      </div>

                      <div className='border-l-4 border-indigo-500 bg-indigo-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>MyBugsPanel not showing data? (v1.3.0)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Verify API key and URL are correct<br />
                          • Check that bugs exist for this application<br />
                          • Open browser console for error messages<br />
                          • Ensure <code className='bg-indigo-100 px-1 rounded text-xs'>BugReporterProvider</code> wraps the component<br />
                          • Verify user has submitted bugs (panel shows user's own bugs only)
                        </p>
                      </div>

                      <div className='border-l-4 border-teal-500 bg-teal-50 p-4 rounded'>
                        <h5 className='font-semibold mb-1'>Network requests not captured? (v1.2.0+)</h5>
                        <p className='text-sm text-muted-foreground'>
                          • Verify <code className='bg-teal-100 px-1 rounded text-xs'>networkCapture</code> prop is not explicitly <code className='bg-teal-100 px-1 rounded text-xs'>false</code><br />
                          • Check console for "Network interceptor initialized" message<br />
                          • Requests might match exclude patterns<br />
                          • Reduce <code className='bg-teal-100 px-1 rounded text-xs'>networkBufferSize</code> if too many requests<br />
                          • SDK's own API calls are automatically excluded
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* API Reference Card */}
            <Card className='mt-8 border-2 border-purple-200 bg-purple-50/50'>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Code className='h-5 w-5' />
                  API Reference & Examples
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='grid md:grid-cols-2 gap-4'>
                  <div className='bg-white p-4 rounded-lg border'>
                    <h4 className='font-semibold mb-2'>TypeScript Types</h4>
                    <p className='text-sm text-muted-foreground mb-3'>
                      Full type definitions for SDK
                    </p>
                    <Button variant='outline' size='sm' asChild>
                      <a href='#' className='gap-2'>
                        View Types <ExternalLink className='h-3 w-3' />
                      </a>
                    </Button>
                  </div>
                  <div className='bg-white p-4 rounded-lg border'>
                    <h4 className='font-semibold mb-2'>Example Projects</h4>
                    <p className='text-sm text-muted-foreground mb-3'>
                      Demo apps and code samples
                    </p>
                    <Button variant='outline' size='sm' asChild>
                      <a href='#' className='gap-2'>
                        Browse Examples <ExternalLink className='h-3 w-3' />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Support */}
            <Card className='mt-8 bg-gradient-to-r from-blue-600 to-blue-900 text-white'>
              <CardHeader>
                <CardTitle>Need Help?</CardTitle>
                <CardDescription className='text-blue-100'>
                  Our team is here to support JKKN developers
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col sm:flex-row gap-4'>
                <Button variant='secondary' size='lg' asChild>
                  <Link href='/login' className='gap-2'>
                    Go to Dashboard <ArrowRight className='h-4 w-4' />
                  </Link>
                </Button>
                <Button variant='outline' size='lg' className='bg-transparent text-white border-2 border-white hover:bg-white hover:text-blue-900'>
                  Contact Support
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className='bg-gray-900 text-white py-8'>
        <div className='container mx-auto px-4 text-center'>
          <p className='text-sm text-gray-400'>
            &copy; 2025 JKKN Bug Reporter. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
