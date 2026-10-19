// Enhanced message with metadata
export interface EnhancedBugReportMessage {
  id: string;
  bug_report_id: string;
  sender_user_id: string;
  message_text: string;
  message_type?: string;
  /** 'reporter' | 'dashboard_user' | 'api_key' | 'system'. Decides attribution. */
  author_kind?: string | null;
  /** Set when the author has no dashboard account — a reporter, via the portal. */
  author_email?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  is_internal?: boolean;
  reply_to_message_id?: string | null;
  created_at: string;
  updated_at?: string;
  edited_at?: string | null;
  is_deleted?: boolean;

  // Enhanced fields
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  read_by?: string[]; // User IDs who read the message
  is_read?: boolean; // For current user

  // Optional relations (populated via joins)
  sender?: {
    id: string;
    email: string;
    full_name?: string | null;
    avatar_url?: string | null;
  };
}

// Message attachment
export interface MessageAttachment {
  id: string;
  message_id: string;
  file_url: string;
  file_name: string;
  file_type?: string;
  file_size?: number;
  created_at: string;
}

// Message reaction
export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  type: string;
  value?: string; // Emoji for reactions
  created_at: string;
}

// Typing indicator
export interface TypingIndicator {
  user_id: string;
  user_email: string;
  user_name?: string;
}

// Message with thread (future enhancement)
export interface ThreadedMessage extends EnhancedBugReportMessage {
  parent_message_id?: string;
  replies?: ThreadedMessage[];
}

// Real-time message event
export interface RealtimeMessageEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  message: EnhancedBugReportMessage;
}

// Message metadata type
export type MessageMetadataType = 'reaction' | 'read';

// Message send payload
export interface SendMessagePayload {
  bug_report_id: string;
  message: string;
  attachments?: File[];
}
