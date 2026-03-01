-- Junction table: document ↔ children (multi-child per document).
-- If no rows for a document, it applies to "All children" (documents.child_id remains null for backwards compat).
CREATE TABLE document_children (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (document_id, child_id)
);

CREATE INDEX idx_document_children_document_id ON document_children(document_id);
CREATE INDEX idx_document_children_child_id ON document_children(child_id);

COMMENT ON TABLE document_children IS 'Documents can be linked to specific children; empty = All children.';
