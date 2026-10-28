const uuid = { type: 'string', format: 'uuid' };
const bigintId = { type: 'string', pattern: '^\\d{1,18}$', example: '1042' };
const dateTime = { type: 'string', format: 'date-time' };

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties, required = [], strict = true) => ({
  type: 'object',
  properties,
  ...(required.length && { required }),
  ...(strict && { additionalProperties: false }),
});
const arr = (items) => ({ type: 'array', items });
const json = (schema) => ({ 'application/json': { schema } });
const envelope = (data) => obj({ success: { type: 'boolean', example: true }, data }, ['success', 'data'], false);
const okRes = (data, description = 'OK') => ({ description, content: json(envelope(data)) });
const noContent = { description: 'No content' };
const errRes = (description) => ({ description, content: json(ref('ErrorResponse')) });

const pathParam = (name, schema = uuid) => ({ name, in: 'path', required: true, schema });
const queryParam = (name, schema, description, required = false) => ({
  name,
  in: 'query',
  required,
  schema,
  ...(description && { description }),
});

const limitParam = (max, def) =>
  queryParam('limit', { type: 'integer', minimum: 1, maximum: max, default: def });

const convId = pathParam('conversationId');
const userIdParam = pathParam('userId');
const messageId = pathParam('messageId', bigintId);
const attachmentId = pathParam('attachmentId');

const bearer = [{ bearerAuth: [] }];

function operation({ tag, summary, secure = true, params = [], body, responses }) {
  const hasPathParam = params.some((param) => param.in === 'path');
  return {
    tags: [tag],
    summary,
    ...(secure && { security: bearer }),
    ...(params.length && { parameters: params }),
    ...(body && { requestBody: { required: true, content: json(body) } }),
    responses: {
      ...responses,
      400: errRes('VALIDATION_ERROR, INVALID_INPUT'),
      ...(secure && { 401: errRes('MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED') }),
      ...(hasPathParam && { 404: errRes('Resource not found (non-members also get 404)') }),
      429: errRes('RATE_LIMITED'),
    },
  };
}

const messageSend = obj(
  {
    content: { type: 'string', minLength: 1, maxLength: 4000 },
    clientMessageId: { ...uuid, description: 'Idempotency key. Duplicate send returns the existing message.' },
    mentions: { ...arr(uuid), maxItems: 20, description: 'Non-members and self are ignored by the server.' },
    attachmentIds: { ...arr(uuid), maxItems: 5, description: 'Own, ready, unattached attachments of the same conversation.' },
  },
  ['content']
);

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Chat Platform API',
    version: '1.0.0',
    description:
      'Slack-like real-time chat backend. REST under /api/v1, realtime over Socket.IO (see docs/SOCKET_EVENTS.md). ' +
      'Success envelope: { success: true, data }. Error envelope: { success: false, error: { code, message, details?, requestId } }. ' +
      'Message ids are strings (BIGINT). Delivery is at-least-once; use clientMessageId for idempotency. ' +
      'Non-members get 404 (never 403) for conversations and messages.',
  },
  servers: [{ url: '/api/v1' }],
  tags: ['Auth', 'Users', 'Conversations', 'Messages', 'Attachments', 'Search', 'Notifications'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      ErrorResponse: obj(
        {
          success: { type: 'boolean', example: false },
          error: obj(
            {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: arr(obj({ in: { type: 'string', enum: ['body', 'params', 'query'] }, path: { type: 'string' }, message: { type: 'string' } })),
              requestId: { type: 'string' },
            },
            ['code', 'message']
          ),
        },
        ['success', 'error']
      ),
      PageInfo: obj({ hasMore: { type: 'boolean' }, nextCursor: { ...bigintId, nullable: true } }),
      User: obj(
        {
          id: uuid,
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          avatarUrl: { type: 'string', nullable: true },
          bio: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['user', 'admin'] },
        },
        [],
        false
      ),
      Conversation: obj(
        {
          id: uuid,
          type: { type: 'string', enum: ['dm', 'group', 'channel'] },
          visibility: { type: 'string', enum: ['public', 'private'] },
          name: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
        },
        [],
        false
      ),
      Member: obj({ userId: uuid, role: { type: 'string', enum: ['owner', 'admin', 'member'] } }, [], false),
      Attachment: obj({ id: uuid, name: { type: 'string' }, mimeType: { type: 'string' }, sizeBytes: { type: 'integer' } }),
      Message: obj({
        id: bigintId,
        conversationId: uuid,
        senderId: { ...uuid, nullable: true },
        clientMessageId: { ...uuid, nullable: true },
        type: { type: 'string', enum: ['text', 'file', 'system'] },
        content: { type: 'string', nullable: true, description: 'null when deleted' },
        deleted: { type: 'boolean' },
        editedAt: { ...dateTime, nullable: true },
        createdAt: dateTime,
        attachments: arr(ref('Attachment')),
      }),
      SearchResult: {
        allOf: [ref('Message'), obj({ snippet: { type: 'string', description: 'Match wrapped as [[word]] (not HTML).' } }, [], false)],
      },
      Notification: obj({
        id: bigintId,
        type: { type: 'string', enum: ['message', 'mention'] },
        conversationId: uuid,
        messageId: bigintId,
        createdAt: dateTime,
        readAt: { ...dateTime, nullable: true },
      }),
      NotificationPreferences: obj({
        messagesMode: { type: 'string', enum: ['all', 'mentions', 'none'] },
        mentionsEnabled: { type: 'boolean' },
      }),
    },
  },
  paths: {
    '/auth/register': {
      post: operation({
        tag: 'Auth',
        summary: 'Register a new user',
        secure: false,
        body: obj({ name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string' } }, ['name', 'email', 'password']),
        responses: { 201: okRes(obj({ user: ref('User'), accessToken: { type: 'string' } }, [], false), 'Created'), 409: errRes('Email already used') },
      }),
    },
    '/auth/login': {
      post: operation({
        tag: 'Auth',
        summary: 'Login (access token + rotating refresh token)',
        secure: false,
        body: obj({ email: { type: 'string', format: 'email' }, password: { type: 'string' } }, ['email', 'password']),
        responses: { 200: okRes(obj({ user: ref('User'), accessToken: { type: 'string' } }, [], false)) },
      }),
    },
    '/auth/refresh': {
      post: operation({
        tag: 'Auth',
        summary: 'Rotate refresh token, get a new access token',
        secure: false,
        body: obj({}, [], false),
        responses: { 200: okRes(obj({ accessToken: { type: 'string' } }, [], false)) },
      }),
    },
    '/auth/logout': {
      post: operation({ tag: 'Auth', summary: 'Revoke current session', secure: false, body: obj({}, [], false), responses: { 204: noContent } }),
    },
    '/auth/logout-all': {
      post: operation({ tag: 'Auth', summary: 'Revoke all sessions', responses: { 204: noContent } }),
    },

    '/users/me': {
      get: operation({ tag: 'Users', summary: 'Current user', responses: { 200: okRes(obj({ user: ref('User') })) } }),
      patch: operation({
        tag: 'Users',
        summary: 'Update profile',
        body: obj({ name: { type: 'string' }, avatarUrl: { type: 'string', nullable: true }, bio: { type: 'string', nullable: true } }),
        responses: { 200: okRes(obj({ user: ref('User') })) },
      }),
    },
    '/users/me/change-password': {
      post: operation({
        tag: 'Users',
        summary: 'Change password',
        body: obj({ currentPassword: { type: 'string' }, newPassword: { type: 'string' } }, ['currentPassword', 'newPassword']),
        responses: { 204: noContent },
      }),
    },
    '/users/me/notification-preferences': {
      get: operation({ tag: 'Notifications', summary: 'Get notification preferences', responses: { 200: okRes(obj({ preferences: ref('NotificationPreferences') })) } }),
      patch: operation({
        tag: 'Notifications',
        summary: 'Update notification preferences',
        body: obj({ messagesMode: { type: 'string', enum: ['all', 'mentions', 'none'] }, mentionsEnabled: { type: 'boolean' } }),
        responses: { 200: okRes(obj({ preferences: ref('NotificationPreferences') })) },
      }),
    },
    '/users/{userId}': {
      get: operation({ tag: 'Users', summary: 'Public profile', params: [userIdParam], responses: { 200: okRes(obj({ user: ref('User') })) } }),
    },
    '/users/{userId}/role': {
      patch: operation({
        tag: 'Users',
        summary: 'Change global role (admin only)',
        params: [userIdParam],
        body: obj({ role: { type: 'string', enum: ['user', 'admin'] } }, ['role']),
        responses: { 200: okRes(obj({ user: ref('User') })), 403: errRes('INSUFFICIENT_ROLE') },
      }),
    },

    '/conversations': {
      post: operation({
        tag: 'Conversations',
        summary: 'Create dm / group / channel',
        body: obj(
          {
            type: { type: 'string', enum: ['dm', 'group', 'channel'] },
            name: { type: 'string' },
            description: { type: 'string' },
            visibility: { type: 'string', enum: ['public', 'private'] },
            memberIds: arr(uuid),
            userId: { ...uuid, description: 'dm target user' },
          },
          ['type']
        ),
        responses: { 201: okRes(obj({ conversation: ref('Conversation') }, [], false), 'Created') },
      }),
      get: operation({ tag: 'Conversations', summary: 'Inbox (unreadCount, lastMessage, otherUser)', responses: { 200: okRes(obj({ conversations: arr(ref('Conversation')) }, [], false)) } }),
    },
    '/conversations/public-channels': {
      get: operation({ tag: 'Conversations', summary: 'Browse public channels', responses: { 200: okRes(obj({ channels: arr(ref('Conversation')) }, [], false)) } }),
    },
    '/conversations/{conversationId}': {
      get: operation({ tag: 'Conversations', summary: 'Get conversation', params: [convId], responses: { 200: okRes(obj({ conversation: ref('Conversation') }, [], false)) } }),
      patch: operation({
        tag: 'Conversations',
        summary: 'Update name / description',
        params: [convId],
        body: obj({ name: { type: 'string' }, description: { type: 'string', nullable: true } }),
        responses: { 200: okRes(obj({ conversation: ref('Conversation') }, [], false)), 403: errRes('INSUFFICIENT_PERMISSIONS') },
      }),
    },
    '/conversations/{conversationId}/join': {
      post: operation({ tag: 'Conversations', summary: 'Join a public channel', params: [convId], responses: { 200: okRes(obj({}, [], false)) } }),
    },
    '/conversations/{conversationId}/leave': {
      post: operation({ tag: 'Conversations', summary: 'Leave conversation', params: [convId], responses: { 204: noContent } }),
    },
    '/conversations/{conversationId}/read': {
      post: operation({
        tag: 'Conversations',
        summary: 'Advance read watermark',
        params: [convId],
        body: obj({ messageId: bigintId }, [], false),
        responses: { 200: okRes(obj({}, [], false)) },
      }),
    },
    '/conversations/{conversationId}/receipts': {
      get: operation({ tag: 'Conversations', summary: 'Read / delivery watermarks of members', params: [convId], responses: { 200: okRes(obj({}, [], false)) } }),
    },
    '/conversations/{conversationId}/members': {
      post: operation({
        tag: 'Conversations',
        summary: 'Add members (owner/admin)',
        params: [convId],
        body: obj({ memberIds: { ...arr(uuid), minItems: 1 } }, ['memberIds']),
        responses: { 200: okRes(obj({}, [], false)), 403: errRes('INSUFFICIENT_PERMISSIONS') },
      }),
    },
    '/conversations/{conversationId}/members/{userId}': {
      delete: operation({ tag: 'Conversations', summary: 'Remove member', params: [convId, userIdParam], responses: { 204: noContent, 403: errRes('INSUFFICIENT_PERMISSIONS') } }),
      patch: operation({
        tag: 'Conversations',
        summary: 'Change member role',
        params: [convId, userIdParam],
        body: obj({ role: { type: 'string', enum: ['admin', 'member'] } }, ['role']),
        responses: { 200: okRes(obj({}, [], false)), 403: errRes('INSUFFICIENT_PERMISSIONS') },
      }),
    },

    '/conversations/{conversationId}/messages': {
      get: operation({
        tag: 'Messages',
        summary: 'History. before = older (newest-first), after = newer (oldest-first, reconnect sync)',
        params: [convId, limitParam(100, 30), queryParam('before', bigintId), queryParam('after', bigintId)],
        responses: { 200: okRes(obj({ messages: arr(ref('Message')), pageInfo: ref('PageInfo') })) },
      }),
      post: operation({
        tag: 'Messages',
        summary: 'Send message (201 new, 200 duplicate clientMessageId)',
        params: [convId],
        body: messageSend,
        responses: { 201: okRes(obj({ message: ref('Message') }), 'Created'), 200: okRes(obj({ message: ref('Message') }), 'Duplicate') },
      }),
    },
    '/messages/{messageId}': {
      patch: operation({
        tag: 'Messages',
        summary: 'Edit (author only, text messages)',
        params: [messageId],
        body: obj({ content: { type: 'string', minLength: 1, maxLength: 4000 } }, ['content']),
        responses: { 200: okRes(obj({ message: ref('Message') })), 403: errRes('NOT_MESSAGE_AUTHOR') },
      }),
      delete: operation({
        tag: 'Messages',
        summary: 'Soft delete (author or owner/admin)',
        params: [messageId],
        responses: { 204: noContent, 403: errRes('NOT_ALLOWED_TO_DELETE') },
      }),
    },

    '/attachments/upload-url': {
      post: operation({
        tag: 'Attachments',
        summary: 'Get presigned upload URL (PUT directly to storage)',
        body: obj(
          {
            conversationId: uuid,
            fileName: { type: 'string' },
            mimeType: { type: 'string', example: 'image/png' },
            sizeBytes: { type: 'integer', minimum: 1 },
          },
          ['conversationId', 'fileName', 'mimeType', 'sizeBytes']
        ),
        responses: {
          201: okRes(obj({ attachmentId: uuid, uploadUrl: { type: 'string' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, expiresIn: { type: 'integer' } }, [], false), 'Created'),
          503: errRes('STORAGE_NOT_CONFIGURED'),
        },
      }),
    },
    '/attachments/{attachmentId}/complete': {
      post: operation({ tag: 'Attachments', summary: 'Verify uploaded object, mark ready', params: [attachmentId], responses: { 200: okRes(obj({ attachment: ref('Attachment') }, [], false)), 503: errRes('STORAGE_NOT_CONFIGURED') } }),
    },
    '/attachments/{attachmentId}': {
      get: operation({
        tag: 'Attachments',
        summary: 'Metadata + short-lived presigned download URL',
        params: [attachmentId],
        responses: { 200: okRes(obj({ attachment: ref('Attachment'), downloadUrl: { type: 'string' } }, [], false)), 503: errRes('STORAGE_NOT_CONFIGURED') },
      }),
    },

    '/search/messages': {
      get: operation({
        tag: 'Search',
        summary: 'Full-text search over messages of conversations you are a member of',
        params: [
          queryParam('q', { type: 'string', minLength: 1, maxLength: 200 }, 'websearch syntax: "phrase", -exclude, or', true),
          queryParam('conversationId', uuid, 'Non-member id => 404'),
          queryParam('senderId', uuid),
          queryParam('from', dateTime),
          queryParam('to', dateTime),
          limitParam(50, 20),
          queryParam('cursor', bigintId),
        ],
        responses: { 200: okRes(obj({ results: arr(ref('SearchResult')), pageInfo: ref('PageInfo') })), 404: errRes('CONVERSATION_NOT_FOUND') },
      }),
    },

    '/notifications': {
      get: operation({
        tag: 'Notifications',
        summary: 'List notifications (cursor, newest first)',
        params: [limitParam(100, 30), queryParam('cursor', bigintId), queryParam('unread', { type: 'string', enum: ['true', 'false'] })],
        responses: { 200: okRes(obj({ notifications: arr(ref('Notification')), pageInfo: ref('PageInfo') })) },
      }),
    },
    '/notifications/unread-count': {
      get: operation({ tag: 'Notifications', summary: 'Unread count', responses: { 200: okRes(obj({ unreadCount: { type: 'integer' } })) } }),
    },
    '/notifications/read': {
      post: operation({
        tag: 'Notifications',
        summary: 'Mark read: ids[] or all=true',
        body: obj({ ids: { ...arr(bigintId), minItems: 1, maxItems: 100 }, all: { type: 'boolean', enum: [true] } }),
        responses: { 200: okRes(obj({ updated: { type: 'integer' } })) },
      }),
    },
  },
};