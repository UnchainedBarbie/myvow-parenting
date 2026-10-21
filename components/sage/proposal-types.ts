export type SageProposal = {
  type: string;
  draft: string;
  revised_text?: string | null;
  depends_on: string | null;
  /**
   * Set only when the chat-fold path clears depends_on.
   * The parent already supplied the missing detail, so the card does not ask for a date.
   */
  date_supplied?: boolean;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
  chosen_date?: string;
  status?: string;
  /** Stable id so a revision can point at this exact version. */
  id?: string;
  /** Proposal id of the version that replaced this one. */
  superseded_by?: string | null;
  /** Proposal id of the version this one replaced. */
  supersedes?: string | null;
  /** sage_items id when the replacement was stored on another item. */
  replacement_item_id?: string | null;
  waived_at?: string;
  unblocked?: boolean;
  executed?: boolean;
  executed_at?: string;
  result_event_id?: string;
  result_expense_id?: string;
  result_document_id?: string;
  result_message_id?: string;
  /** sent until the mail service confirms; delivered only after that confirmation. */
  delivery_status?: string | null;
  send_claim_at?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  /**
   * Set when a destination save or the follow-up "mark done" write failed.
   * Stored on the same proposal so a retry can reuse result_* ids and not insert again.
   */
  save_error?: string | null;
  /** Documents-vault id stored at chat attach — form links this, does not re-upload. */
  attached_document_id?: string | null;
  attached_file_name?: string | null;
  attached_file_url?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  date?: string | null;
  /** parent = Sage is asking the user. coparent = the text is for the other parent. */
  audience?: "parent" | "coparent";
  /** offer creates an event; update edits calendar_event_id. Absent when this card is only a question. */
  calendar_intent?: "offer" | "update";
  calendar_event_id?: string | null;
  /** When the event begins, HH:mm. Never an arrival or a pickup. */
  event_start?: string | null;
  /** Arrival or "needs to be there by", HH:mm. Description only, not start_time. */
  arrival_time?: string | null;
  /** Pickup or drop-off, HH:mm. Description only, not end_time. */
  pickup_time?: string | null;
};

export type SagePlan = {
  status?: string;
  proposals?: SageProposal[];
  reasoning?: string;
};

export type SageItem = {
  id: string;
  item_type: string | null;
  domain: string | null;
  summary: string | null;
  evidence_excerpt: string | null;
  urgency: string | null;
  action_required: boolean | null;
  child_ids: string[] | null;
  tool_input: unknown;
  plan: SagePlan | null;
  status: string | null;
  flagged?: boolean | null;
  created_at: string;
};
