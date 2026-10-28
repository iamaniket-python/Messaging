# Socket.IO events

Connect: `io(url, { transports: ['websocket'], auth: { token: ACCESS_TOKEN } })`
(ya `Authorization: Bearer` header). Handshake errors: `err.data.code` = `MISSING_TOKEN | INVALID_TOKEN | TOKEN_EXPIRED`.
Connect hone par rooms join hote hain, phir server `session:ready { userId }` emit karta hai.
Token expiry har event par check hoti hai (`TOKEN_EXPIRED` ack); client `auth:refresh { accessToken }` bhejta hai.

Ack format: `{ ok: true, data }` ya `{ ok: false, error: { code, message, details? } }`.
Limits: per-socket token bucket (capacity 20, refill 5/s) => `RATE_LIMITED`; per-user message limit `SOCKET_MESSAGE_LIMIT_PER_MIN` (default 120/min).

## Client -> Server

| Event | Payload | Ack data |
|---|---|---|
| `message:send` | `{ conversationId, clientMessageId, content, mentions?, attachmentIds? }` | `{ message, duplicate }` |
| `message:delivered` | `{ conversationId, messageId }` | `null` |
| `message:read` | `{ conversationId, messageId }` | `null` |
| `typing:start` / `typing:stop` | `{ conversationId }` | `null` |
| `conversation:join` / `conversation:leave` | `{ conversationId }` (sirf room subscribe) | `null` |
| `presence:subscribe` / `presence:unsubscribe` | `{ userIds: uuid[] (1..100) }` | `null` |
| `auth:refresh` | `{ accessToken }` | `null` |

## Server -> Client

| Event | Payload |
|---|---|
| `session:ready` | `{ userId }` |
| `message:new` | `{ message }` |
| `message:updated` | `{ message }` |
| `message:deleted` | `{ conversationId, messageId }` |
| `message:delivered` / `message:read` | `{ conversationId, userId, messageId }` (channel: `message:read` sirf reader ke apne devices ko) |
| `typing:update` | `{ conversationId, userId, isTyping }` |
| `presence:update` | `{ userId, status, lastSeenAt }` |
| `conversation:new` / `updated` / `member_added` / `member_removed` / `member_role_changed` | conversation / member payload |
| `notification:new` | `{ notification }` (room `user:{id}`) |

## Rooms

`user:{userId}`, `conv:{conversationId}`, `presence:{userId}`.

## Delivery

At-least-once. Retry par `clientMessageId` reuse karo; duplicate par ack `duplicate: true`, dobara broadcast nahi hota.
Reconnect par `GET /conversations/:id/messages?after=<lastSeenId>` se gap sync karo.