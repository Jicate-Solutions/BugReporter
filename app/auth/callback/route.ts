import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SuperAdminServerService } from '@/lib/services/super-admins/server';
import { InvitationServerService } from '@/lib/services/invitations/server';

/**
 * OAuth Callback Handler
 * Handles Google OAuth callback and routes users based on their access level
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;

  console.log('[OAuth Callback] Processing callback...');

  if (code) {
    try {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
              try {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options)
                );
              } catch (error) {
                console.error('[OAuth Callback] Cookie setting error:', error);
              }
            },
          },
        }
      );

      // Exchange code for session
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        console.error('[OAuth Callback] Exchange error:', exchangeError);
        return NextResponse.redirect(new URL('/auth/error?message=auth_failed', origin));
      }

      // Get user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error('[OAuth Callback] User fetch error:', userError);
        return NextResponse.redirect(new URL('/auth/error?message=user_not_found', origin));
      }

      console.log('[OAuth Callback] User authenticated:', user.email);

      // Bootstrap super admin if needed
      const bootstrapEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL;
      if (bootstrapEmail && user.email) {
        const bootstrapped = await SuperAdminServerService.bootstrapSuperAdminIfNeeded(
          user.id,
          user.email,
          bootstrapEmail
        );

        if (bootstrapped) {
          console.log('[OAuth Callback] Bootstrap super admin created:', user.email);
        }
      }

      // Check if user is super admin
      const isSuperAdmin = await SuperAdminServerService.checkIsSuperAdmin(user.id);

      if (isSuperAdmin) {
        console.log('[OAuth Callback] Super admin detected, redirecting to admin dashboard');
        return NextResponse.redirect(new URL('/admin/dashboard', origin));
      }

      // Check if user needs approval
      const { data: existingApproval } = await supabase
        .from('user_approvals')
        .select('status')
        .eq('user_id', user.id)
        .single();

      // If no approval record exists, create one
      if (!existingApproval) {
        console.log('[OAuth Callback] Creating approval request for new user:', user.email);
        const { error: approvalError } = await supabase
          .from('user_approvals')
          .insert({
            user_id: user.id,
            email: user.email || '',
            full_name: user.user_metadata?.full_name || null,
            status: 'pending'
          });

        if (approvalError) {
          console.error('[OAuth Callback] Error creating approval request:', approvalError);
        }

        // New user needs approval
        console.log('[OAuth Callback] New user needs approval, showing waiting page');
        return NextResponse.redirect(
          new URL(
            `/auth/waiting-access?email=${encodeURIComponent(user.email || '')}&reason=pending_approval`,
            origin
          )
        );
      }

      // Check approval status
      if (existingApproval.status === 'pending') {
        console.log('[OAuth Callback] User approval is pending, showing waiting page');
        return NextResponse.redirect(
          new URL(
            `/auth/waiting-access?email=${encodeURIComponent(user.email || '')}&reason=pending_approval`,
            origin
          )
        );
      }

      if (existingApproval.status === 'rejected') {
        console.log('[OAuth Callback] User approval was rejected');
        return NextResponse.redirect(
          new URL('/auth/error?message=access_denied', origin)
        );
      }

      // User is approved, continue with normal flow
      console.log('[OAuth Callback] User is approved, checking organization access');

      // Check organization memberships
      const { data: orgMemberships, error: orgsError } = await supabase
        .from('organization_members')
        .select(`
          organization_id,
          organizations!inner (
            id,
            slug,
            name
          )
        `)
        .eq('user_id', user.id);

      if (orgsError) {
        console.error('[OAuth Callback] Error fetching organizations:', orgsError);
      }

      if (orgMemberships && orgMemberships.length > 0) {
        // Get first organization
        const firstOrg = orgMemberships[0].organizations;

        if (firstOrg && typeof firstOrg === 'object' && 'slug' in firstOrg) {
          console.log('[OAuth Callback] User has orgs, redirecting to:', firstOrg.slug);
          return NextResponse.redirect(new URL(`/org/${firstOrg.slug}`, origin));
        }
      }

      // Check for pending invitations using server service (bypasses RLS)
      console.log('[OAuth Callback] Checking for invitations for email:', user.email);
      const invitations = await InvitationServerService.getPendingInvitationsByEmail(user.email || '');
      console.log('[OAuth Callback] Invitations found:', invitations?.length || 0);

      if (invitations && invitations.length > 0) {
        // User has pending invitations - redirect to accept page
        console.log('[OAuth Callback] User has pending invitations, redirecting to accept page');
        return NextResponse.redirect(
          new URL(`/auth/accept-invitations?email=${encodeURIComponent(user.email || '')}`, origin)
        );
      }

      // Approved, but nobody has assigned them to an organization yet. This is a
      // different problem from "waiting on an admin to approve you" and the
      // waiting page needs to say so - otherwise admins who already approved the
      // user are told, wrongly, that approval is still outstanding.
      console.log('[OAuth Callback] User approved but has no org assignment, showing waiting page');
      return NextResponse.redirect(
        new URL(
          `/auth/waiting-access?email=${encodeURIComponent(user.email || '')}&reason=no_organization`,
          origin
        )
      );
    } catch (error) {
      console.error('[OAuth Callback] Unexpected error:', error);
      return NextResponse.redirect(
        new URL('/auth/error?message=unexpected_error', origin)
      );
    }
  }

  // No code provided
  console.error('[OAuth Callback] No code provided');
  return NextResponse.redirect(new URL('/auth/error?message=no_code', origin));
}
