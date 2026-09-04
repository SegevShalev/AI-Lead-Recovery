# Local Development

## Required tools

- Node.js LTS
- pnpm
- Docker
- AWS CLI only for AWS milestones
- CDK CLI for infrastructure milestones

## Local services

Docker Compose should provide:

- MongoDB
- Redis

The application should support a local queue implementation for day-to-day development. AWS SQS is the production adapter.

Optional: LocalStack may be introduced if it genuinely improves AWS integration testing; do not make the whole project depend on it initially.

## Environment

Commit `.env.example`, never `.env`.

Expected values will eventually include:

- `MONGODB_URI`
- `REDIS_URL`
- `QUEUE_PROVIDER=local|sqs`
- `SQS_QUEUE_URL`
- `WORKER_PORT` (recovery-worker's health check endpoint, default 3002)
- `AI_PROVIDER`
- `AI_API_KEY`

Never put real credentials in source control.
