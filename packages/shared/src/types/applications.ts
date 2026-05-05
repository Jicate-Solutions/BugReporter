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
