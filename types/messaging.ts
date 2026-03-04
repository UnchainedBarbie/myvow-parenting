export type DeliveryStatus = "pending" | "delivered" | "buffered" | "blocked";

export type StructuredPauseMode = "user_unilateral" | "user_mutual" | "auto";

export interface ConversationRow {
  id: string;
  case_id: string;
  subject: string;
  child_id: string | null;
  category: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRowDb {
  id: string;
  case_id: string;
  conversation_id: string | null;
  direction: "incoming" | "outgoing";
  sender_id: string | null;
  original_content: string;
  ai_rewritten_content: string | null;
  ai_rewritten: boolean;
  category: string | null;
  sub_category: string | null;
  current_status: string;
  external_comm_id: string | null;
  created_at: string;
  emotional_intensity_score?: number | null;
  intensity_score?: number | null;
  intensity_flag?: boolean;
  delivery_status?: DeliveryStatus;
  delivered_at?: string | null;
  deliver_at?: string | null;
  notification_suppressed?: boolean;
  is_emergency?: boolean;
  emergency_type?: string | null;
  emergency_note?: string | null;
}

export interface UserSettingsRow {
  id: string;
  user_id: string;
  proactive_sage_enabled: boolean;
  proactive_sage_incoming_enabled: boolean;
  proactive_sage_drafts_enabled: boolean;
  structured_pause_enabled: boolean;
  cool_off_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationSettingsRow {
  id: string;
  conversation_id: string;
  user_id: string;
  proactive_sage_enabled: boolean | null;
  structured_pause_enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface StructuredPauseRow {
  id: string;
  conversation_id: string;
  created_by: string | null;
  mode: StructuredPauseMode;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export interface EditHistoryRow {
  id: string;
  user_id: string;
  scope: "global" | "conversation";
  conversation_id: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
}

export interface CoolOffRow {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  cancelled_at: string | null;
  is_active: boolean;
}

