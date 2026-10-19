import {
  withApiKeyAuth,
  createApiSuccessResponse,
} from '@/lib/middleware/api-key-auth';
import { getAnnotationConfig } from '@/lib/services/annotation/config';
import type { AnnotationTool, ApiRequestContext } from '@boobalan_jkkn/shared';

interface PublicAppConfig {
  annotation: {
    enabled: boolean;
    tools: AnnotationTool[];
  };
}

/**
 * GET /api/v1/public/config
 *
 * What the capture widget is allowed to do for this application.
 *
 * This exists so that one switch governs both surfaces. Screenshot annotation is
 * turned on per-application in the dashboard, but half of it happens inside the
 * SDK running on the customer's own site — without somewhere to ask, the widget
 * would need a second flag passed in by the integrator, and the two would
 * disagree the first time anyone changed one and not the other.
 *
 * Read-only and cheap on purpose: the widget calls it at mount, before the
 * reporter has done anything, and a slow or failing config call must never be
 * what stops a bug from being filed. Clients should treat any error as "feature
 * off" rather than retrying.
 */
export const GET = withApiKeyAuth<PublicAppConfig>(
  async (_request, context: ApiRequestContext) => {
    const annotation = getAnnotationConfig(context.application.settings);

    return createApiSuccessResponse<PublicAppConfig>({
      annotation: {
        enabled: annotation.enabled,
        tools: annotation.tools,
      },
    });
  }
);

/**
 * CORS preflight. The widget calls this from the customer's own origin, so the
 * headers have to match the ones the submit endpoint already sends.
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-api-key',
      'Access-Control-Max-Age': '86400',
    },
  });
}
