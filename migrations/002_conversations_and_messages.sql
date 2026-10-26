CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(10) NOT NULL CHECK (type IN ('dm', 'group', 'channel')),
  visibility      VARCHAR(10) NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  name            VARCHAR(100),
  description     VARCHAR(500),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  dm_key          VARCHAR(73),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_name_required CHECK (type = 'dm' OR name IS NOT NULL),
  CONSTRAINT conversations_public_only_channels CHECK (type = 'channel' OR visibility = 'private'),
  CONSTRAINT conversations_dm_key_matches_type CHECK ((type = 'dm') = (dm_key IS NOT NULL))
);

CREATE UNIQUE INDEX uq_conversations_dm_key ON conversations (dm_key) WHERE dm_key IS NOT NULL;
CREATE UNIQUE INDEX uq_conversations_channel_name ON conversations (lower(name)) WHERE type = 'channel';

CREATE TABLE conversation_members (
  conversation_id           UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                      VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  last_read_message_id      BIGINT NOT NULL DEFAULT 0,
  last_delivered_message_id BIGINT NOT NULL DEFAULT 0,
  muted_until               TIMESTAMPTZ,
  joined_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conversation_members_user ON conversation_members (user_id, conversation_id);
CREATE UNIQUE INDEX uq_conversation_single_owner ON conversation_members (conversation_id) WHERE role = 'owner';

CREATE TABLE messages (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  client_message_id UUID,
  type              VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'file', 'system')),
  content           TEXT NOT NULL CHECK (char_length(content) <= 4000),
  edited_at         TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_id_desc ON messages (conversation_id, id DESC);
CREATE UNIQUE INDEX uq_messages_idempotency ON messages (conversation_id, sender_id, client_message_id);