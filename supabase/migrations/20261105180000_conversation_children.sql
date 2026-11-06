-- Junction table: conversation ↔ children.
-- Same columns the expenses join uses: the parent record id and the child id.
-- No rows means unassigned, not all children.
-- conversations.child_id stays as the fallback when this table has no rows for that conversation.

CREATE TABLE conversation_children (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, child_id)
);

CREATE INDEX conversation_children_child_id_idx ON conversation_children(child_id);

COMMENT ON TABLE conversation_children IS
  'Children a conversation concerns. Empty means unassigned, not all children. conversations.child_id is the fallback when this table has no rows.';
