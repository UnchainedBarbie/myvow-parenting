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
  waived_at?: string;
  unblocked?: boolean;
  executed?: boolean;
  executed_at?: string;
  result_event_id?: string;
  result_expense_id?: string;
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
