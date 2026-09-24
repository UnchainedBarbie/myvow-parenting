export type SageProposal = {
  type: string;
  draft: string;
  revised_text?: string | null;
  depends_on: string | null;
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
