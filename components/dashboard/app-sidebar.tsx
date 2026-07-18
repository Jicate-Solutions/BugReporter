'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bug,
  LayoutDashboard,
  AppWindow,
  Users,
  Trophy,
  Settings,
  LogOut,
  Home,
  Sparkles,
  Shield,
  Activity,
  CalendarClock
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { createClient } from '@/lib/supabase/client';
import { Separator } from '@/components/ui/separator';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { useBugStats } from '@/hooks/bug-reports/use-bug-reports';
import { useIsSuperAdmin } from '@/hooks/super-admins/use-super-admin-status';

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  orgSlug: string;
  orgName: string;
}

export function AppSidebar({ orgSlug, orgName, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { organization, userRole } = useOrganizationContext();
  const { stats } = useBugStats(organization?.id || '');
  const isSuperAdmin = useIsSuperAdmin();

  const bugCount = stats?.total || 0;

  // Only show settings for owner and admin roles
  const canAccessSettings = userRole === 'owner' || userRole === 'admin';

  const mainNavItems = [
    {
      title: 'Dashboard',
      url: `/org/${orgSlug}`,
      icon: LayoutDashboard,
      badge: null
    },
    {
      title: 'Applications',
      url: `/org/${orgSlug}/apps`,
      icon: AppWindow,
      badge: null
    },
    {
      title: 'Bug Reports',
      url: `/org/${orgSlug}/bugs`,
      icon: Bug,
      badge: bugCount > 0 ? bugCount.toString() : null
    },
    {
      title: 'AI',
      url: `/org/${orgSlug}/ai`,
      icon: Sparkles,
      badge: '₹0'
    },
    {
      title: 'Routines',
      url: `/org/${orgSlug}/routines`,
      icon: CalendarClock,
      badge: '₹0'
    },
    {
      title: 'Uptime',
      url: `/org/${orgSlug}/uptime`,
      icon: Activity,
      badge: null
    }
  ];

  const teamNavItems = [
    {
      title: 'Team Members',
      url: `/org/${orgSlug}/team`,
      icon: Users,
      badge: null
    },
    {
      title: 'Leaderboard',
      url: `/org/${orgSlug}/leaderboard`,
      icon: Trophy,
      badge: 'New'
    }
  ];

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <Sidebar collapsible='icon' {...props} className='border-r'>
      <SidebarHeader className='border-b px-2 py-4'>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' asChild className='hover:bg-accent'>
              <Link href='/'>
                <div className='flex text-center aspect-square size-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md'>
                  <Bug className='size-5' />
                </div>
                <div className='grid flex-1 text-left text-sm leading-tight ml-1'>
                  <span className='truncate font-bold text-base'>
                    JKKN Bug Reporter
                  </span>
                  <span className='truncate text-xs text-muted-foreground font-medium'>
                    {orgName}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className='py-4'>
        {/* Main Navigation */}
        <SidebarGroup className='mb-4'>
          <SidebarGroupLabel className='px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
            Main Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className='space-y-1'>
              {mainNavItems.map((item) => {
                const isActive =
                  pathname === item.url ||
                  (pathname.startsWith(item.url + '/') &&
                    item.url !== `/org/${orgSlug}`);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={cn(
                        'h-10 rounded-lg transition-all',
                        isActive
                          ? 'bg-linear-to-r from-blue-600 to-blue-700 text-white shadow-lg hover:text-white'
                          : 'hover:bg-accent'
                      )}
                    >
                      <Link href={item.url} className='flex items-center gap-3'>
                        <item.icon className='size-4' />
                        <span className='font-medium'>{item.title}</span>
                        {item.badge && (
                          <span
                            className={cn(
                              'ml-auto rounded-full px-2 py-0.5 text-xs font-semibold',
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-blue-100 text-blue-700'
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className='my-4' />

        {/* Team Navigation */}
        <SidebarGroup className='mb-4'>
          <SidebarGroupLabel className='px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
            Team & Rewards
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className='space-y-1'>
              {teamNavItems.map((item) => {
                const isActive =
                  pathname === item.url || pathname.startsWith(item.url + '/');
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={cn(
                        'h-10 rounded-lg transition-all',
                        isActive
                          ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg hover:from-blue-700 hover:to-blue-800 hover:text-white'
                          : 'hover:bg-accent'
                      )}
                    >
                      <Link href={item.url} className='flex items-center gap-3'>
                        <item.icon className='size-4' />
                        <span className='font-medium'>{item.title}</span>
                        {item.badge && (
                          <span
                            className={cn(
                              'ml-auto rounded-full px-2 py-0.5 text-xs font-semibold shadow-sm',
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-white'
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className='my-4' />

        {/* Super Admin Link (only for super admins) */}
        {isSuperAdmin && (
          <>
            <SidebarGroup className='mb-4'>
              <SidebarGroupLabel className='px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
                Administration
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className='space-y-1'>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip='Super Admin Dashboard'
                      className={cn(
                        'h-10 rounded-lg transition-all',
                        pathname.startsWith('/admin')
                          ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg hover:from-purple-700 hover:to-purple-800 hover:text-white'
                          : 'hover:bg-accent'
                      )}
                    >
                      <Link
                        href='/admin/dashboard'
                        className='flex items-center gap-3'
                      >
                        <Shield className='size-4' />
                        <span className='font-medium'>Admin Panel</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <Separator className='my-4' />
          </>
        )}

        {/* Settings (only for owner and admin) */}
        {canAccessSettings && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className='space-y-1'>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip='Settings'
                    className={cn(
                      'h-10 rounded-lg transition-all',
                      pathname.startsWith(`/org/${orgSlug}/settings`)
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg hover:from-blue-700 hover:to-blue-800 hover:text-white'
                        : 'hover:bg-accent'
                    )}
                  >
                    <Link
                      href={`/org/${orgSlug}/settings`}
                      className='flex items-center gap-3'
                    >
                      <Settings className='size-4' />
                      <span className='font-medium'>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className='border-t p-3'>
        <SidebarMenu className='space-y-1'>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip='Back to Home'
              className='h-10 rounded-lg hover:bg-accent'
            >
              <Link href='/' className='flex items-center gap-3'>
                <Home className='size-4' />
                <span className='font-medium'>Back to Home</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip='Logout'
              className='h-10 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50'
            >
              <LogOut className='size-4' />
              <span className='font-medium'>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
