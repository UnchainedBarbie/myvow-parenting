-- Document edit history (audit trail for metadata changes)
CREATE TABLE document_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES users(id),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_document_history_document_id ON document_history(document_id);
CREATE INDEX idx_document_history_created_at ON document_history(document_id, created_at);

COMMENT ON TABLE document_history IS 'Append-only audit log of document metadata edits (title, description, category, child_id, visibility).';
