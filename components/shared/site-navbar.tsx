'use client';

import Link from 'next/link';
import { Bug } from 'lucide-react';
import { HomepageNav } from '@/app/_components/homepage-nav';

export function SiteNavbar() {
  return (
    <header className='border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm'>
      <div className='container mx-auto px-4 py-4'>
        <div className='flex items-center justify-between'>
          <Link href='/' className='flex items-center gap-3 hover:opacity-80 transition-opacity'>
            <div className='h-10 w-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center text-white font-bold shadow-md'>
              <Bug className='h-6 w-6' />
            </div>
            <div>
              <h1 className='text-xl font-bold text-gray-900'>
                JICATE Control Tower
              </h1>
              <p className='text-xs text-gray-600'>Run every JICATE app</p>
            </div>
          </Link>
          <HomepageNav />
        </div>
      </div>
    </header>
  );
}
