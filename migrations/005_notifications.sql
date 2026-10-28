ALTER TABLE messages ADD COLUMN mentions UUID[] NOT NULL DEFAULT '{}';

CREATE TABLE notifications (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(10) NOT NULL CHECK (type IN ('message', 'mention')),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  CONSTRAINT uq_notifications_dedupe UNIQUE (user_id, message_id, type)
);
CREATE INDEX idx_notifications_user_id_desc ON notifications (user_id, id DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages_mode    VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (messages_mode IN ('all', 'mentions', 'none')),
  mentions_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);