import { pool, query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { CHANNEL_NAME_REGEX } from './conversations.validation.js';

const MANAGER_ROLES = ['owner', 'admin'];

const normalizeIds = (ids) => [...new Set(ids.map((id) => id.toLowerCase()))];

const notFound = () => AppError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');

const noPermission = (message = 'You do not have permission to do this') =>
  AppError.forbidden(message, 'INSUFFICIENT_PERMISSIONS');

const channelNameTaken = () =>
  AppError.conflict('A channel with this name already exists', 'CHANNEL_NAME_TAKEN');

export async function requireMembership(db, conversationId, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.type, c.visibility, cm.role
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = $1 AND cm.user_id = $2`,
    [conversationId, userId]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function assertUsersExist(db, userIds) {
  if (userIds.length === 0) return;
  const { rows } = await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  if (rows.length !== userIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = userIds.filter((id) => !found.has(id));
    throw AppError.badRequest('Some users do not exist', { missingUserIds: missing }, 'INVALID_MEMBERS');
  }
}

async function createDm(userId, otherUserId) {
  const otherId = otherUserId.toLowerCase();
  if (otherId === userId) {
    throw AppError.badRequest('You cannot start a conversation with yourself', undefined, 'CANNOT_DM_SELF');
  }
  const dmKey = [userId, otherId].sort().join(':');

  return withTransaction(async (client) => {
    await assertUsersExist(client, [otherId]);

    const { rows } = await client.query(
      `INSERT INTO conversations (type, visibility, created_by, dm_key)
       VALUES ('dm', 'private', $1, $2)
       ON CONFLICT (dm_key) WHERE dm_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [userId, dmKey]
    );

    if (rows[0]) {
      await client.query(
        'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
        [rows[0].id, userId, otherId]
      );
      return { conversation: rows[0], created: true };
    }

    const existing = await client.query('SELECT * FROM conversations WHERE dm_key = $1', [dmKey]);
    return { conversation: existing.rows[0], created: false };
  });
}

export async function createConversation(userId, input) {
  if (input.type === 'dm') return createDm(userId, input.userId);

  const memberIds = normalizeIds(input.memberIds).filter((id) => id !== userId);

  return withTransaction(async (client) => {
    await assertUsersExist(client, memberIds);

    let conversation;
    try {
      const { rows } = await client.query(
        `INSERT INTO conversations (type, visibility, name, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.type,
          input.type === 'channel' ? input.visibility : 'private',
          input.name,
          input.description ?? null,
          userId,
        ]
      );
      conversation = rows[0];
    } catch (err) {
      if (err.code === '23505') throw channelNameTaken();
      throw err;
    }

    await client.query(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
      [conversation.id, userId]
    );

    if (memberIds.length > 0) {
      await client.query(
        'INSERT INTO conversation_members (conversation_id, user_id) SELECT $1::uuid, unnest($2::uuid[])',
        [conversation.id, memberIds]
      );
    }

    return { conversation, created: true };
  });
}

export async function getConversation(conversationId, userId) {
  const membership = await requireMembership(pool, conversationId, userId);

  const {
    rows: [conversation],
  } = await query('SELECT * FROM conversations WHERE id = $1', [conversationId]);

  const { rows: members } = await query(
    `SELECT cm.user_id, cm.role, cm.joined_at, u.name, u.avatar_url
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = $1
      ORDER BY cm.joined_at ASC, cm.user_id ASC
      LIMIT 200`,
    [conversationId]
  );

  const {
    rows: [{ count }],
  } = await query('SELECT count(*)::int AS count FROM conversation_members WHERE conversation_id = $1', [
    conversationId,
  ]);

  return { conversation, myRole: membership.role, memberCount: count, members };
}

export async function listMyConversations(userId, limit) {
  const { rows } = await query(
    `SELECT c.id, c.type, c.visibility, c.name, c.description, c.created_by, c.last_message_at, c.created_at,
            cm.role AS my_role, cm.muted_until,
            lm.id AS lm_id, lm.sender_id AS lm_sender_id, lm.content AS lm_content,
            lm.deleted_at AS lm_deleted_at, lm.created_at AS lm_created_at,
            ou.id AS other_user_id, ou.name AS other_user_name, ou.avatar_url AS other_user_avatar_url,
            (SELECT count(*)::int FROM (
               SELECT 1 FROM messages um
                WHERE um.conversation_id = c.id
                  AND um.id > cm.last_read_message_id
                  AND um.sender_id IS DISTINCT FROM $1
                  AND um.deleted_at IS NULL
                LIMIT 100
             ) AS capped) AS unread_count
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN LATERAL (
         SELECT m.id, m.sender_id, m.content, m.deleted_at, m.created_at
           FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.id DESC
          LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT u.id, u.name, u.avatar_url
           FROM conversation_members o
           JOIN users u ON u.id = o.user_id
          WHERE o.conversation_id = c.id AND o.user_id <> $1
          LIMIT 1
       ) ou ON c.type = 'dm'
      WHERE cm.user_id = $1
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function listPublicChannels(userId, { q, limit }) {
  const { rows } = await query(
    `SELECT c.id, c.type, c.visibility, c.name, c.description, c.created_by, c.last_message_at, c.created_at,
            (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id = c.id) AS member_count,
            EXISTS (
              SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = $1
            ) AS is_member
       FROM conversations c
      WHERE c.type = 'channel' AND c.visibility = 'public'
        AND ($2::text IS NULL OR strpos(lower(c.name), lower($2::text)) > 0)
      ORDER BY c.name ASC
      LIMIT $3`,
    [userId, q ?? null, limit]
  );
  return rows;
}

const UPDATE_COLUMNS = { name: 'name', description: 'description' };

export async function updateConversation(conversationId, userId, data) {
  const membership = await requireMembership(pool, conversationId, userId);
  if (membership.type === 'dm') {
    throw AppError.badRequest('Direct messages cannot be edited', undefined, 'DM_NOT_EDITABLE');
  }
  if (!MANAGER_ROLES.includes(membership.role)) throw noPermission();

  const changes = { ...data };
  if (changes.name !== undefined && membership.type === 'channel') {
    changes.name = changes.name.toLowerCase();
    if (!CHANNEL_NAME_REGEX.test(changes.name)) {
      throw AppError.badRequest('Invalid channel name', undefined, 'INVALID_CHANNEL_NAME');
    }
  }

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
    if (key in changes) {
      values.push(changes[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(conversationId);

  try {
    const { rows } = await query(
      `UPDATE conversations SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw channelNameTaken();
    throw err;
  }
}

export async function joinChannel(conversationId, userId) {
  const {
    rows: [conversation],
  } = await query('SELECT id, type, visibility FROM conversations WHERE id = $1', [conversationId]);

  if (!conversation || conversation.type !== 'channel' || conversation.visibility !== 'public') {
    throw notFound();
  }

  const { rows } = await query(
    `INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id)
     VALUES ($1::uuid, $2::uuid, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1::uuid), 0))
     ON CONFLICT (conversation_id, user_id) DO NOTHING
     RETURNING user_id`,
    [conversationId, userId]
  );
  return { joined: rows.length > 0 };
}

export async function leaveConversation(conversationId, userId) {
  await withTransaction(async (client) => {
    await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);

    const membership = await requireMembership(client, conversationId, userId);
    if (membership.type === 'dm') {
      throw AppError.badRequest('You cannot leave a direct message', undefined, 'CANNOT_LEAVE_DM');
    }

    await client.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
      conversationId,
      userId,
    ]);

    if (membership.role !== 'owner') return;

    const {
      rows: [successor],
    } = await client.query(
      `SELECT user_id FROM conversation_members
        WHERE conversation_id = $1
        ORDER BY (role = 'admin') DESC, joined_at ASC, user_id ASC
        LIMIT 1`,
      [conversationId]
    );

    if (successor) {
      await client.query(
        "UPDATE conversation_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, successor.user_id]
      );
    } else {
      await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    }
  });
}

export async function addMembers(conversationId, actorId, userIds) {
  return withTransaction(async (client) => {
    const membership = await requireMembership(client, conversationId, actorId);
    if (membership.type === 'dm') {
      throw AppError.badRequest('Direct messages have fixed members', undefined, 'DM_MEMBERS_FIXED');
    }
    if (!MANAGER_ROLES.includes(membership.role)) throw noPermission();

    const ids = normalizeIds(userIds);
    await assertUsersExist(client, ids);

    const { rows } = await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id)
       SELECT $1::uuid, u.id, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1::uuid), 0)
         FROM users u
        WHERE u.id = ANY($2::uuid[])
       ON CONFLICT (conversation_id, user_id) DO NOTHING
       RETURNING user_id`,
      [conversationId, ids]
    );
    return { addedUserIds: rows.map((row) => row.user_id) };
  });
}

export async function removeMember(conversationId, actorId, targetUserId) {
  const targetId = targetUserId.toLowerCase();

  await withTransaction(async (client) => {
    const membership = await requireMembership(client, conversationId, actorId);
    if (membership.type === 'dm') {
      throw AppError.badRequest('Direct messages have fixed members', undefined, 'DM_MEMBERS_FIXED');
    }
    if (targetId === actorId) {
      throw AppError.badRequest('Use the leave endpoint to leave a conversation', undefined, 'USE_LEAVE_ENDPOINT');
    }
    if (!MANAGER_ROLES.includes(membership.role)) throw noPermission();

    const {
      rows: [target],
    } = await client.query(
      'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, targetId]
    );
    if (!target) throw AppError.notFound('Member not found', 'MEMBER_NOT_FOUND');
    if (target.role === 'owner') throw noPermission('The owner cannot be removed');
    if (target.role === 'admin' && membership.role !== 'owner') {
      throw noPermission('Only the owner can remove an admin');
    }

    await client.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
      conversationId,
      targetId,
    ]);
  });
}

export async function updateMemberRole(conversationId, actorId, targetUserId, role) {
  const targetId = targetUserId.toLowerCase();

  const membership = await requireMembership(pool, conversationId, actorId);
  if (membership.type === 'dm') {
    throw AppError.badRequest('Direct messages have fixed members', undefined, 'DM_MEMBERS_FIXED');
  }
  if (membership.role !== 'owner') throw noPermission('Only the owner can change roles');
  if (targetId === actorId) {
    throw AppError.badRequest('You cannot change your own role', undefined, 'CANNOT_CHANGE_OWN_ROLE');
  }

  const { rows } = await query(
    `UPDATE conversation_members SET role = $3
      WHERE conversation_id = $1 AND user_id = $2 AND role <> 'owner'
      RETURNING user_id, role`,
    [conversationId, targetId, role]
  );
  if (!rows[0]) throw AppError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  return rows[0];
}

export async function markRead(conversationId, userId, messageId) {
  const { rows } = await query(
    `UPDATE conversation_members
        SET last_read_message_id = GREATEST(
              last_read_message_id,
              LEAST($3::bigint, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1), 0))
            )
      WHERE conversation_id = $1 AND user_id = $2
      RETURNING last_read_message_id`,
    [conversationId, userId, messageId]
  );
  if (!rows[0]) throw notFound();
  return rows[0].last_read_message_id;
}