# LEVEL Platform — Backend API

Express.js backend with PostgreSQL, Redis, and REST API for the LEVEL Platform.

## Quick Start

```bash
# Install dependencies
npm install

# Start database (Docker)
cd docker && docker-compose up -d

# Run migrations
npm run db:migrate

# Seed initial data
npm run db:seed

# Start development server
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/register` — Register user
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Get current user
- `POST /api/auth/api-keys` — Generate API key
- `GET /api/auth/api-keys` — List API keys
- `DELETE /api/auth/api-keys/:id` — Revoke API key

### Cities
- `GET /api/cities` — List all cities
- `GET /api/cities/:key` — Get city details
- `PUT /api/cities/:key` — Update city
- `GET /api/cities/:key/versions` — Version history
- `POST /api/cities/:key/rollback/:version` — Rollback to version

### Projects
- `GET /api/projects` — List projects
- `GET /api/projects/:id` — Get project
- `POST /api/projects` — Create project
- `PUT /api/projects/:id` — Update project
- `DELETE /api/projects/:id` — Delete project
- `POST /api/projects/run` — Run financial model
- `GET /api/projects/:id/history` — Calculation history

### Scoring
- `POST /api/scoring/calculate` — Calculate city score
- `POST /api/scoring/batch` — Batch calculate scores
- `GET /api/scoring/ranking` — Get city ranking

### Macro
- `GET /api/macro/latest` — Latest macro snapshot
- `GET /api/macro/history` — Macro history
- `POST /api/macro/fetch` — Trigger CBR fetch

### Webhooks
- `POST /api/webhooks` — Create webhook
- `GET /api/webhooks` — List webhooks
- `DELETE /api/webhooks/:id` — Delete webhook
- `POST /api/webhooks/:id/test` — Test webhook

### Analytics
- `GET /api/analytics/sensitivity` — Sensitivity heatmap
- `GET /api/analytics/trends` — Time series
- `GET /api/analytics/alerts` — Recent alerts
- `POST /api/analytics/alerts/:id/acknowledge` — Acknowledge alert
- `GET /api/analytics/usage` — API usage stats
- `GET /api/analytics/audit` — Audit log

### Admin
- `GET /api/admin/stats` — Platform statistics
- `POST /api/admin/reset-api-usage` — Reset API usage
- `GET /api/admin/pipeline-runs` — Pipeline history
- `POST /api/admin/trigger-pipeline` — Trigger pipeline
- `GET /api/admin/health` — System health

## Authentication

### API Key
```bash
curl -H "X-API-Key: lvl_your_key" http://localhost:3001/api/cities
```

### JWT Token
```bash
curl -H "Authorization: Bearer your_token" http://localhost:3001/api/cities
```

## Environment Variables

See `.env.example` for all required variables.

## Docker

```bash
# Full stack (Postgres + Redis + API)
cd docker && docker-compose up -d

# With pgAdmin
cd docker && docker-compose --profile tools up -d
```

## Database

```bash
# Run migrations
npm run db:migrate

# Push schema (no migration)
npm run db:push

# Open Prisma Studio
npm run db:studio

# Seed data
npm run db:seed
```
