import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { ApiResponse, ApiRequestContext } from '@boobalan_jkkn/shared';

/**
 * API Key Authentication Middleware
 * Validates API keys for public SDK endpoints
 */

/**
 * CORS headers shared by every public response and preflight handler.
 *
 * PATCH was missing from the method list even though the public bug-report
 * route exposes it, so a cross-origin PATCH preflight was rejected by the
 * browser before the handler ever ran.
 */
export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-api-key',
  'Access-Control-Max-Age': '86400'
} as const;

/** Standard preflight response for public routes. */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 200, headers: PUBLIC_CORS_HEADERS });
}

export interface ApiKeyAuthResult {
  success: boolean;
  context?: ApiRequestContext;
  error?: {
    code: string;
    message: string;
    status: number;
  };
}

/**
 * Validate API key from request headers
 * Expects header: X-API-Key: your-api-key
 */
export async function validateApiKey(
  request: NextRequest
): Promise<ApiKeyAuthResult> {
  try {
    // Extract API key from headers
    const apiKey =
      request.headers.get('X-API-Key') || request.headers.get('x-api-key');

    if (!apiKey) {
      return {
        success: false,
        error: {
          code: 'MISSING_API_KEY',
          message: 'API key is required. Provide it in the X-API-Key header.',
          status: 401
        }
      };
    }

    // Create Supabase client with service role
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Query applications table for API key
    const { data: application, error: appError } = await supabase
      .from('applications')
      .select(
        `
        id,
        name,
        slug,
        organization_id,
        api_key,
        created_at,
        settings,
        organizations (
          id,
          name,
          slug
        )
      `
      )
      .eq('api_key', apiKey)
      .single();

    if (appError || !application) {
      console.error('[ApiKeyAuth] API key validation failed:', appError);
      return {
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key provided.',
          status: 401
        }
      };
    }

    // Extract organization (Supabase returns array for foreign key)
    const organization = Array.isArray(application.organizations)
      ? application.organizations[0]
      : application.organizations;

    if (!organization) {
      return {
        success: false,
        error: {
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organization associated with this API key not found.',
          status: 404
        }
      };
    }

    // Build context
    const context: ApiRequestContext = {
      api_key: {
        id: application.id,
        application_id: application.id,
        organization_id: application.organization_id,
        key_prefix: apiKey.substring(0, 8) + '...',
        is_active: true,
        created_at: application.created_at
      },
      application: {
        id: application.id,
        name: application.name,
        slug: application.slug,
        organization_id: application.organization_id,
        settings: application.settings ?? undefined
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug
      },
      request_ip: request.headers.get('x-forwarded-for') || undefined,
      user_agent: request.headers.get('user-agent') || undefined
    };

    console.log('[ApiKeyAuth] API key validated:', {
      application: application.name,
      organization: organization.name
    });

    // Update last_used_at (optional, fire and forget)
    void supabase
      .from('applications')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', application.id)
      .then(() => console.log('[ApiKeyAuth] Updated last used timestamp'));

    return {
      success: true,
      context
    };
  } catch (error) {
    console.error('[ApiKeyAuth] Unexpected error:', error);
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error during API key validation.',
        status: 500
      }
    };
  }
}

/**
 * Create error response for API
 */
export function createApiErrorResponse<T = unknown>(
  code: string,
  message: string,
  status: number = 400,
  details?: Record<string, unknown>
): NextResponse<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    success: false,
    error: {
      code,
      message,
      details
    }
  };

  return NextResponse.json(response, {
    status,
    headers: {
      ...PUBLIC_CORS_HEADERS
    }
  });
}

/**
 * Create success response for API
 */
export function createApiSuccessResponse<T = unknown>(
  data: T,
  status: number = 200
): NextResponse<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    success: true,
    data
  };

  return NextResponse.json(response, {
    status,
    headers: {
      ...PUBLIC_CORS_HEADERS
    }
  });
}

/**
 * Middleware wrapper for API routes
 * Validates API key and passes context to handler
 */
export function withApiKeyAuth<T = unknown>(
  handler: (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => Promise<NextResponse<ApiResponse<T>>>
) {
  return async (
    request: NextRequest,
    routeContext?: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse<ApiResponse<T>>> => {
    const authResult = await validateApiKey(request);

    if (!authResult.success || !authResult.context) {
      return createApiErrorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      );
    }

    return handler(request, authResult.context, routeContext);
  };
}
