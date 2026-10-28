# Performance notes

## Setup (Neon TEST branch par hi)

    npm run perf:seed      # 50 users, 1 big group (200k msgs), 30 small groups
    npm run perf:explain   # EXPLAIN (ANALYZE, BUFFERS) history / search / inbox / notifications

`PERF_BIG_MESSAGES=1000000` se bada dataset. Seed script `DATABASE_URL` par kabhi nahi chalta.

## Kya dekhna hai (expected plans, output se verify karo)

| Query | Expected plan | Red flag |
|---|---|---|
| History (`conversation_id = $1 AND id < $2 ORDER BY id DESC LIMIT 31`) | Index Scan Backward on `idx_messages_conversation_id_desc`, ~31 rows, no Sort | Seq Scan ya Sort node |
| Search | Bitmap Index Scan on `idx_messages_search_vector` + membership join, ya ID-order scan with filter | Seq Scan on `messages`, `ts_headline` bahut rows par |
| Inbox | `idx_conversation_members_user` se members, `last_message_at` sort, unread subquery har conversation par | Big group mein unread `count(*)` lakhon rows scan kare |
| Notifications unread | `idx_notifications_unread` (partial) | Seq Scan on `notifications` |

## Index review

- `messages (conversation_id, id DESC)`: history aur unread-count ke liye sahi.
- `messages USING GIN (search_vector)`: full-text; trigram (`pg_trgm`) nahi hai, to substring search (`%abc%`) supported nahi (known limitation).
- `conversation_members (user_id, conversation_id)`: inbox/membership joins.
- `notifications (user_id, id DESC)` + partial unread index: list/count.
- `conversations (last_message_at)` par index nahi hai. Inbox ko sort karna pade aur user ke conversations bahut hon to `EXPLAIN` mein Sort dikhega; tab index add karna (nayi migration `006_*.sql`).
- Unread count: agar `EXPLAIN` mein big-group count heavy dikhe to count ko cap karo (e.g. `LIMIT 100` subquery => "99+") ya per-member counter rakho.

## Results (apne run ke numbers yahan paste karo)

| Query | Rows in table | Execution time | Plan node | Action |
|---|---|---|---|---|
| History | | | | |
| Search | | | | |
| Inbox | | | | |
| Notifications | | | | |

## Load scripts

    npm run load:rest      # autocannon: POST /conversations/:id/messages
    npm run load:socket    # socket burst: SENDERS x MSGS_PER_SOCKET message:send, fan-out check

Env knobs: `BASE_URL`, `CONNECTIONS`, `DURATION`, `SENDERS`, `RECEIVERS`, `MSGS_PER_SOCKET`.
REST `messageLimiter` 429 de sakta hai, socket path par `SOCKET_MESSAGE_LIMIT_PER_MIN` aur per-socket bucket (20, 5/s) lagta hai. Load run ke liye server env mein limit badha do, aur 429 ko bug mat samjho.
Neon latency (network round trip) numbers par dominate karti hai; local Postgres se compare karna ho to docker-compose use karo.