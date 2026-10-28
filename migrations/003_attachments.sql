CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  storage_key     TEXT NOT NULL UNIQUE,
  original_name   VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
  status          VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_message ON attachments (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_attachments_conversation ON attachments (conversation_id);
CREATE INDEX idx_attachments_uploader_status ON attachments (uploader_id, status);
-- Optional cleanup job (not implemented): delete pending rows + objects older than 24h using this index.
CREATE INDEX idx_attachments_pending_created ON attachments (created_at) WHERE status = 'pending';