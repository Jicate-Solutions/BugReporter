import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Bug,
  Zap,
  Shield,
  Users,
  BarChart3,
  MessageSquare,
  Award,
  Code,
  ArrowRight,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { HomepageNav } from './_components/homepage-nav';

export default function Home() {
  return (
    <div className='min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50'>
      {/* Header */}
      <header className='border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm'>
        <div className='container mx-auto px-4 py-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-10 w-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center text-white font-bold shadow-md'>
                <Bug className='h-6 w-6' />
              </div>
              <div>
                <h1 className='text-xl font-bold text-gray-900'>
                  JICATE Control Tower
                </h1>
                <p className='text-xs text-gray-600'>
                  Bugs, AI, routines and uptime for every JICATE app
                </p>
              </div>
            </div>
            <HomepageNav />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className='py-20 md:py-32'>
        <div className='container mx-auto px-4'>
          <div className='max-w-5xl mx-auto'>
            <div className='text-center space-y-8 mb-16'>
              <div className='inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-full text-sm font-medium text-blue-700 mb-4'>
                <Sparkles className='h-4 w-4' />
                Enterprise-Grade Bug Tracking for JKKN Institution
              </div>
              <h1 className='text-5xl md:text-7xl font-extrabold tracking-tight leading-tight'>
                <span className='bg-linear-to-r from-blue-600 via-blue-700 to-purple-600 bg-clip-text text-transparent'>
                  Streamline Bug Management
                </span>
                <br />
                <span className='text-gray-900'>Across All Departments</span>
              </h1>
              <p className='text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed'>
                A powerful, centralized platform designed exclusively for JKKN
                Institution to track, manage, and resolve bugs across all
                applications and departments with real-time collaboration and
                comprehensive analytics.
              </p>
              <div className='flex flex-col sm:flex-row gap-4 justify-center pt-8'>
                <Link href='/login'>
                  <Button
                    size='lg'
                    className='text-lg px-10 py-6 bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 shadow-xl hover:shadow-2xl transition-all'
                  >
                    Sign In to Dashboard
                    <ArrowRight className='ml-2 h-5 w-5' />
                  </Button>
                </Link>
                <Link href='#features'>
                  <Button
                    size='lg'
                    variant='outline'
                    className='text-lg px-10 py-6 border-2 hover:bg-gray-50'
                  >
                    Explore Features
                  </Button>
                </Link>
              </div>
            </div>

            {/* Stats Section */}
            <div className='grid grid-cols-2 md:grid-cols-4 gap-6 mt-20'>
              <div className='text-center p-6 bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-shadow'>
                <div className='text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent mb-2'>
                  100+
                </div>
                <div className='text-sm font-medium text-gray-600'>
                  Active Applications
                </div>
              </div>
              <div className='text-center p-6 bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-shadow'>
                <div className='text-4xl font-bold bg-gradient-to-r from-green-600 to-green-800 bg-clip-text text-transparent mb-2'>
                  50+
                </div>
                <div className='text-sm font-medium text-gray-600'>
                  Departments
                </div>
              </div>
              <div className='text-center p-6 bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-shadow'>
                <div className='text-4xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent mb-2'>
                  1000+
                </div>
                <div className='text-sm font-medium text-gray-600'>
                  Active Users
                </div>
              </div>
              <div className='text-center p-6 bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-shadow'>
                <div className='text-4xl font-bold bg-gradient-to-r from-orange-600 to-orange-800 bg-clip-text text-transparent mb-2'>
                  24/7
                </div>
                <div className='text-sm font-medium text-gray-600'>
                  Platform Availability
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id='features' className='py-24 bg-white'>
        <div className='container mx-auto px-4'>
          <div className='text-center space-y-4 mb-20'>
            <div className='inline-block px-4 py-2 bg-gradient-to-r from-blue-50 to-purple-50 rounded-full text-sm font-semibold text-blue-700 mb-2'>
              Platform Features
            </div>
            <h2 className='text-4xl md:text-5xl font-bold text-gray-900'>
              Everything You Need to Manage Bugs Effectively
            </h2>
            <p className='text-lg text-gray-600 max-w-2xl mx-auto'>
              Built specifically for JKKN Institution with enterprise-grade
              features and security
            </p>
          </div>

          <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto'>
            {/* Feature 1 */}
            <Card className='border-2 hover:border-blue-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <Code className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Easy SDK Integration
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Integrate bug reporting into any React application with just a
                  few lines of code. Our lightweight SDK captures bugs,
                  screenshots, and console logs automatically.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 2 */}
            <Card className='border-2 hover:border-green-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-green-500 to-green-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <Users className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Multi-Department Support
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Manage bugs across all JKKN departments and applications from
                  a single centralized platform with complete data isolation and
                  role-based access control.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 3 */}
            <Card className='border-2 hover:border-purple-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <MessageSquare className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Real-Time Collaboration
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Communicate with bug reporters instantly. Add comments,
                  attachments, update status, and collaborate with your team in
                  real-time to resolve issues faster.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 4 */}
            <Card className='border-2 hover:border-orange-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-orange-500 to-orange-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <BarChart3 className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Comprehensive Analytics
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Get deep insights into bug trends, resolution times,
                  department performance, and user contributions with powerful
                  analytics and customizable dashboards.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 5 */}
            <Card className='border-2 hover:border-red-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-red-500 to-red-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <Shield className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Enterprise Security
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Built with security first. Features row-level security,
                  role-based access control, Google OAuth authentication, and
                  secure API key management.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 6 */}
            <Card className='border-2 hover:border-yellow-400 hover:shadow-xl transition-all group'>
              <CardHeader>
                <div className='h-16 w-16 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform'>
                  <Award className='h-8 w-8 text-white' />
                </div>
                <CardTitle className='text-xl mb-2'>
                  Gamified Leaderboards
                </CardTitle>
                <CardDescription className='text-base leading-relaxed'>
                  Encourage quality bug reports with an integrated leaderboard
                  system. Recognize top contributors and build a culture of
                  quality assurance.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className='py-24 bg-gradient-to-b from-blue-50 to-white'>
        <div className='container mx-auto px-4'>
          <div className='text-center space-y-4 mb-20'>
            <div className='inline-block px-4 py-2 bg-white rounded-full text-sm font-semibold text-blue-700 mb-2 shadow-sm'>
              Simple 3-Step Process
            </div>
            <h2 className='text-4xl md:text-5xl font-bold text-gray-900'>
              How the Platform Works
            </h2>
            <p className='text-lg text-gray-600 max-w-2xl mx-auto'>
              From integration to resolution - streamlined for maximum
              efficiency
            </p>
          </div>

          <div className='max-w-6xl mx-auto'>
            <div className='grid md:grid-cols-3 gap-12'>
              {/* Step 1 */}
              <div className='text-center group'>
                <div className='relative mb-8'>
                  <div className='h-24 w-24 bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl flex items-center justify-center text-white text-4xl font-bold mx-auto shadow-xl group-hover:scale-110 transition-transform'>
                    1
                  </div>
                  <div className='absolute -top-2 -right-2 h-6 w-6 bg-green-500 rounded-full flex items-center justify-center'>
                    <CheckCircle2 className='h-4 w-4 text-white' />
                  </div>
                </div>
                <h3 className='text-2xl font-bold mb-4 text-gray-900'>
                  Integrate SDK
                </h3>
                <p className='text-gray-600 leading-relaxed'>
                  Add our lightweight React SDK to your application with minimal
                  configuration. Start capturing bugs, screenshots, and logs
                  instantly.
                </p>
              </div>

              {/* Step 2 */}
              <div className='text-center group'>
                <div className='relative mb-8'>
                  <div className='h-24 w-24 bg-gradient-to-br from-green-500 to-green-700 rounded-3xl flex items-center justify-center text-white text-4xl font-bold mx-auto shadow-xl group-hover:scale-110 transition-transform'>
                    2
                  </div>
                  <div className='absolute -top-2 -right-2 h-6 w-6 bg-green-500 rounded-full flex items-center justify-center'>
                    <CheckCircle2 className='h-4 w-4 text-white' />
                  </div>
                </div>
                <h3 className='text-2xl font-bold mb-4 text-gray-900'>
                  Capture & Report
                </h3>
                <p className='text-gray-600 leading-relaxed'>
                  Users report bugs with comprehensive details including
                  screenshots, console logs, device info, and step-by-step
                  descriptions.
                </p>
              </div>

              {/* Step 3 */}
              <div className='text-center group'>
                <div className='relative mb-8'>
                  <div className='h-24 w-24 bg-gradient-to-br from-purple-500 to-purple-700 rounded-3xl flex items-center justify-center text-white text-4xl font-bold mx-auto shadow-xl group-hover:scale-110 transition-transform'>
                    3
                  </div>
                  <div className='absolute -top-2 -right-2 h-6 w-6 bg-green-500 rounded-full flex items-center justify-center'>
                    <CheckCircle2 className='h-4 w-4 text-white' />
                  </div>
                </div>
                <h3 className='text-2xl font-bold mb-4 text-gray-900'>
                  Track & Resolve
                </h3>
                <p className='text-gray-600 leading-relaxed'>
                  Manage, prioritize, assign, and resolve bugs efficiently
                  through your comprehensive dashboard with real-time updates
                  and analytics.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className='py-24 bg-gradient-to-r from-blue-600 via-blue-700 to-purple-700 text-white relative overflow-hidden'>
        <div className='absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]'></div>
        <div className='container mx-auto px-4 relative z-10'>
          <div className='max-w-4xl mx-auto text-center space-y-8'>
            <h2 className='text-4xl md:text-6xl font-bold leading-tight'>
              Access Your Bug Tracking Dashboard
            </h2>
            <p className='text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto leading-relaxed'>
              Sign in to manage bugs across all JKKN departments, view
              comprehensive analytics, and collaborate with your team in
              real-time.
            </p>
            <div className='flex flex-col sm:flex-row gap-4 justify-center pt-6'>
              <Link href='/login'>
                <Button
                  size='lg'
                  variant='secondary'
                  className='text-lg px-12 py-6 shadow-2xl hover:shadow-3xl bg-white text-blue-900 hover:bg-gray-50'
                >
                  Sign In Now
                  <ArrowRight className='ml-2 h-5 w-5' />
                </Button>
              </Link>
            </div>
            <p className='text-sm text-blue-200 pt-4'>
              Secured with Google OAuth • Enterprise-grade security
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className='bg-gray-900 text-white py-16'>
        <div className='container mx-auto px-4'>
          <div className='grid md:grid-cols-4 gap-12 mb-12'>
            <div>
              <div className='flex items-center gap-2 mb-4'>
                <div className='h-10 w-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center shadow-md'>
                  <Bug className='h-6 w-6' />
                </div>
                <div>
                  <span className='font-bold text-lg'>JICATE Control Tower</span>
                </div>
              </div>
              <p className='text-sm text-gray-400 leading-relaxed'>
                Enterprise-grade bug tracking platform designed exclusively for
                JKKN Institution to streamline development and improve software
                quality.
              </p>
            </div>
            <div>
              <h3 className='font-semibold mb-4 text-lg'>Platform</h3>
              <ul className='space-y-3 text-sm text-gray-400'>
                <li>
                  <Link
                    href='#features'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    href='/login'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link
                    href='#'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Dashboard
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className='font-semibold mb-4 text-lg'>Resources</h3>
              <ul className='space-y-3 text-sm text-gray-400'>
                <li>
                  <Link
                    href='/docs'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Documentation
                  </Link>
                </li>
                <li>
                  <Link
                    href='/docs'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    API Reference
                  </Link>
                </li>
                <li>
                  <Link
                    href='/docs'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    SDK Integration Guide
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className='font-semibold mb-4 text-lg'>Institution</h3>
              <ul className='space-y-3 text-sm text-gray-400'>
                <li>
                  <a
                    href='https://jkkn.ac.in'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    About JKKN
                  </a>
                </li>
                <li>
                  <Link
                    href='#'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href='#'
                    className='hover:text-white transition-colors flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className='border-t border-gray-800 pt-8 text-center text-sm text-gray-400'>
            <p>&copy; 2026 JICATE Solutions. All rights reserved.</p>
            <p className='mt-2'>
              Built for JKKN Institution | Powered by Next.js & Supabase
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
