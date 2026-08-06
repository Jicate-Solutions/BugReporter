export interface Application {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  api_key: string;
  created_by_user_id: string;
  app_url: string;
  created_at: string;
  updated_at: string;
  settings?: {
    allowed_domains?: string[];
    webhook_url?: string;
    github_repo?: string;
    deploy_hook_url?: string;
    test_credentials_note?: string;
    auto_triage_policy?: {
      auto_merge_eligible?: boolean;
    };
    /** AI door (₹0 Max lane): per-app switch + approved task menu. */
    ai?: {
      enabled?: boolean;
      allowed_tasks?: string[];
    };
    /**
     * Screenshot annotation: letting a reporter draw on the capture — box the
     * broken element, label what should change, cover anything private — instead
     * of describing it in prose.
     *
     * Its own namespace rather than a key under `bug_portal`, because the
     * feature has two surfaces and only one of them is the portal. The capture
     * widget reads this same switch through /api/v1/public/config, and it should
     * not have to consult a portal flag to decide whether to draw a toolbar.
     *
     * ⚠️ Any key added here must ALSO be registered in the zod schema in
     * app/(dashboard)/org/[slug]/apps/_components/application-form.tsx, which
     * strips unregistered settings keys on every save.
     */
    annotation?: {
      /** Master switch. OFF until the app's own developer turns it on. */
      enabled?: boolean;
      /**
       * Which of the five tools the reporter gets. Omitted means all of them —
       * an app that opts in should not have to pick a menu as well.
       */
      tools?: string[];
    };
    /**
     * Bug Status Portal: the reporter-facing return path. Opt-in per application
     * and OFF until the app's own developer enables it from the Settings tab.
     *
     * ⚠️ Any key added here must ALSO be registered in the zod schema in
     * app/(dashboard)/org/[slug]/apps/_components/application-form.tsx, which
     * strips unregistered settings keys on every save.
     */
    bug_portal?: {
      /** Master switch. While false the portal 404s and the notes API is closed. */
      enabled?: boolean;
      /** Whether reporters may reply on the thread, or only read it. */
      allow_reporter_notes?: boolean;
      /**
       * Whether a reporter may push a closed bug back open with a reason. The
       * bug returns to `seen` and the app owner is emailed. Defaults on.
       */
      allow_reporter_reopen?: boolean;
      /**
       * Whether a reporter may set their own report to any of the five statuses
       * from the portal, not just push a closed one back open.
       *
       * Defaults OFF, unlike its two neighbours, and is gated on
       * allow_reporter_notes. Reopening can only ever ask for more work; this can
       * claim work is done — writing `resolved` stamps `resolved_at`, drops the
       * bug out of the team's queue, and moves the portal's "typical fix" median.
       * An app that already turned the portal on should not acquire that
       * silently.
       */
      allow_reporter_status?: boolean;
      /**
       * Require a server-minted HMAC on the portal handoff. Off by default so an
       * app can adopt the portal with a plain link and no backend changes; turn
       * it on once the app mints signed links.
       */
      require_signature?: boolean;
      /** Deliver status changes / new notes to settings.webhook_url. */
      webhook_enabled?: boolean;
      /** Shared secret for the portal HMAC and the webhook signature. */
      webhook_secret?: string;
    };
    [key: string]: any;
  };
  _stats?: {
    total_bugs: number;
    resolved_bugs: number;
    pending_bugs: number;
  };
}

export interface CreateApplicationPayload {
  organization_id: string;
  name: string;
  slug: string;
  app_url: string;
  settings?: Application['settings'];
}

export interface UpdateApplicationPayload {
  id: string;
  name?: string;
  slug?: string;
  app_url?: string;
  settings?: Application['settings'];
}

export interface RegenerateApiKeyResponse {
  api_key: string;
}
