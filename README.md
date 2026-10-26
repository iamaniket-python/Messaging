# Real-Time Chat and Collaboration Platform

A scalable real-time messaging application inspired by Slack, built using Node.js, Express.js, Socket.IO, PostgreSQL, Prisma, and Redis. The platform supports private messaging, group conversations, online presence, typing indicators, read receipts, and secure file sharing.

## 🚀 Features

- **Authentication:** JWT-based authentication and secure password hashing.
- **Private Messaging:** Real-time one-to-one conversations.
- **Group Chats:** Create groups, manage members, and control permissions.
- **Real-Time Communication:** Instant messaging using Socket.IO.
- **Online Presence:** Online/offline status and last-seen information.
- **Typing Indicators:** Real-time typing status.
- **Read Receipts:** Track message delivery and read status.
- **File Sharing:** Upload and share images and documents.
- **Message Search:** Search messages with filters and pagination.
- **Redis Integration:** Cross-instance Socket.IO broadcasting and temporary presence data.
- **PostgreSQL Database:** Relational data storage with transactions and indexing.
- **API Documentation:** REST API documentation using Swagger/OpenAPI.
- **Testing and Deployment:** Automated tests, Docker, and CI/CD.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | REST API framework |
| Socket.IO | Real-time communication |
| PostgreSQL | Relational database |
| Prisma ORM | Database access and migrations |
| Redis | Caching, rate limiting, and Socket.IO scaling |
| JWT | Authentication |
| bcrypt | Password hashing |
| Zod / Joi | Request validation |
| Cloudinary / S3 | File storage |
| Swagger | API documentation |
| Jest / Vitest | Automated testing |
| Docker | Containerization |

## 🏗️ System Architecture

```mermaid
flowchart TD
    A[Web or Mobile Client] <--> B[Express REST API]
    A <--> C[Socket.IO Server]
    B --> D[Authentication and Authorization]
    C --> D
    B --> E[Prisma ORM]
    C --> E
    E --> F[(PostgreSQL)]
    C <--> G[(Redis)]
    G <--> H[Other Socket.IO Instances]
    B --> I[Object Storage]
```

## 📁 Project Structure

```text
real-time-chat/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── config/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── conversations/
│   │   ├── messages/
│   │   ├── attachments/
│   │   └── notifications/
│   ├── sockets/
│   │   ├── handlers/
│   │   └── middleware/
│   ├── middlewares/
│   ├── services/
│   ├── repositories/
│   ├── validators/
│   ├── utils/
│   ├── app.js
│   └── server.js
├── tests/
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## ⚙️ Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- PostgreSQL
- Redis
- Git

### 1. Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd real-time-chat
```

### 2. Install Dependencies

```bash
npm install
```

Install Prisma if it is not already configured:

```bash
npm install @prisma/client
npm install -D prisma
```

### 3. Configure Environment Variables

Create a `.env` file in the project root.

```env
NODE_ENV=development
PORT=5000

DATABASE_URL="postgresql://postgres:your_password@localhost:5432/realtime_chat?schema=public"

REDIS_URL="redis://localhost:6379"

JWT_ACCESS_SECRET="replace_with_a_secure_random_secret"
JWT_REFRESH_SECRET="replace_with_another_secure_random_secret"

CLIENT_URL="http://localhost:3000"
```

Replace the database username, password, and connection details with your local PostgreSQL configuration.

Never commit `.env` or production credentials to GitHub.

### 4. Set Up the Database

Create a PostgreSQL database named `realtime_chat`, then run:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

The migration command creates the database tables from your `prisma/schema.prisma` file. Ensure the schema is configured before running migrations.

### 5. Start Redis

If Redis is installed locally, start its service. Alternatively, configure it through Docker Compose.

```bash
docker compose up -d redis
```

This command assumes your `docker-compose.yml` contains a service named `redis`.

### 6. Start the Application

Run the development command configured in your `package.json`:

```bash
npm run dev
```

Example local API address:

```text
http://localhost:5000
```

## 🗄️ Database Design

PostgreSQL stores the application's persistent relational data.

| Table | Purpose |
|---|---|
| `users` | User profiles and authentication details |
| `conversations` | Private and group conversations |
| `conversation_members` | Users belonging to each conversation |
| `messages` | Persistent messages and timestamps |
| `attachments` | File metadata and storage references |
| `refresh_tokens` | Refresh-token or session records |
| `notifications` | User notification records |
| `message_reads` | Message read receipts, if modeled separately |

Use foreign keys, appropriate unique constraints, and indexes to preserve data integrity and improve query performance.

### Important Database Considerations

- Use transactions for operations that require multiple related database changes.
- Add indexes for conversation membership and message history queries.
- Use cursor-based pagination for conversations with large message histories.
- Enforce membership permissions before returning private messages.
- Store uploaded files in object storage rather than directly in PostgreSQL.
- Use Redis for temporary state and cross-instance broadcasting, not as the permanent source of truth for messages.

## 🔌 REST API Endpoints

These are planned endpoint examples.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register a user |
| POST | `/api/v1/auth/login` | Authenticate a user |
| POST | `/api/v1/auth/refresh` | Refresh authentication tokens |
| POST | `/api/v1/auth/logout` | Log out |
| GET | `/api/v1/users/me` | Get current user |
| PATCH | `/api/v1/users/me` | Update profile |
| POST | `/api/v1/conversations` | Create a conversation |
| GET | `/api/v1/conversations` | List conversations |
| GET | `/api/v1/conversations/:id/messages` | Retrieve messages |
| POST | `/api/v1/conversations/:id/messages` | Send a message |
| PATCH | `/api/v1/messages/:id` | Edit a message |
| DELETE | `/api/v1/messages/:id` | Delete a message |
| GET | `/api/v1/search/messages?q=hello` | Search messages |

Actual endpoints depend on your implementation.

## ⚡ Socket.IO Events

### Client-to-Server

- `message:send`
- `message:read`
- `typing:start`
- `typing:stop`
- `conversation:join`
- `conversation:leave`

### Server-to-Client

- `message:new`
- `message:delivered`
- `message:read`
- `typing:update`
- `presence:update`
- `notification:new`

Validate and authorize every event on the server. Persist messages before acknowledging them as successfully stored, and implement reconnection synchronization from PostgreSQL.

## 🧪 Testing

Run the scripts configured in `package.json`. For example:

```bash
npm test
```

Test authentication, authorization, message persistence, Socket.IO delivery, conversation permissions, duplicate-event handling, Redis scaling, and database failure scenarios.

## 🐳 Docker and Deployment

Use Docker Compose for local development with PostgreSQL and Redis. For production, configure managed PostgreSQL and Redis services, secure environment variables, health checks, logging, and WebSocket-compatible hosting.

Before deployment:

1. Configure the production `DATABASE_URL` and `REDIS_URL`.
2. Run Prisma migrations using the deployment process.
3. Configure allowed frontend origins.
4. Verify Socket.IO connectivity.
5. Run automated tests.
6. Configure graceful shutdown and health checks.

## 🗺️ Development Roadmap

- [ ] Project setup and PostgreSQL configuration
- [ ] Prisma schema and database migrations
- [ ] Authentication and user profiles
- [ ] Private conversations and group chats
- [ ] Message persistence and REST APIs
- [ ] Socket.IO real-time messaging
- [ ] Online presence and typing indicators
- [ ] Delivery acknowledgments and read receipts
- [ ] Redis adapter and multi-instance testing
- [ ] File sharing and message search
- [ ] Notifications
- [ ] Automated tests and security hardening
- [ ] Docker, CI/CD, and deployment

## 🎯 Learning Outcomes

This project demonstrates practical knowledge of:

- Backend development with Node.js and Express.
- Real-time communication using Socket.IO.
- PostgreSQL database design and SQL optimization.
- Prisma ORM and database migrations.
- Authentication and authorization.
- Redis and horizontally scaled WebSocket applications.
- Testing, deployment, and system design.

## 📄 License

Add a `LICENSE` file if you intend to distribute this project under an open-source license.

---

**Project Status:** In Development

Built to explore real-time communication, relational database design, scalable backend architecture, and production-oriented engineering practices.
