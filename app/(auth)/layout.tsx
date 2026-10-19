import { SiteNavbar } from '@/components/shared/site-navbar';
import { ReactNode } from 'react';


export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-screen flex flex-col bg-gray-50'>
      {/* Header */}
      <SiteNavbar />

      {/* Main Content */}
      <main className='flex-1 flex items-center justify-center p-4'>
        <div className='w-full max-w-md'>{children}</div>
      </main>

      {/* Footer */}
      <footer className='border-t bg-white py-6'>
        <div className='container mx-auto px-4 text-center text-sm text-muted-foreground'>
          <p>&copy; 2026 JICATE Solutions. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
