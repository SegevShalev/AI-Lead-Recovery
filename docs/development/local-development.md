# Local Development

## Required tools

- Node.js LTS
- pnpm
- Docker
- AWS CLI only for AWS milestones
- CDK CLI for infrastructure milestones

## Local services

Docker Compose provides:

- MongoDB
- Redis
- LocalStack (SQS only — `SERVICES=sqs`), for testing the SQS queue adapter
  without a real AWS account

The application should support a local queue implementation for day-to-day development (`QUEUE_PROVIDER=local`, the default). AWS SQS is the production adapter (`QUEUE_PROVIDER=sqs`).

### Testing the SQS adapter against LocalStack

`docker compose up -d localstack` starts it on `localhost:4566`. Create a
queue and point the app at it:

```bash
docker exec ai-lead-recovery-localstack-1 awslocal sqs create-queue --queue-name conversation-events
```

That prints a `QueueUrl` like
`http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/conversation-events`
— set `SQS_QUEUE_URL` to that, `QUEUE_PROVIDER=sqs`, `AWS_REGION=us-east-1`,
and set dummy credentials (LocalStack accepts any value, but the SDK
requires _something_ present):

```bash
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

`AWS_ENDPOINT_URL` is read automatically by the AWS SDK — no code changes
needed to point it at LocalStack instead of real AWS.

## Environment

Commit `.env.example`, never `.env`.

Expected values will eventually include:

- `MONGODB_URI`
- `REDIS_URL`
- `QUEUE_PROVIDER=local|sqs`
- `SQS_QUEUE_URL`
- `AI_PROVIDER`
- `AI_API_KEY`

Never put real credentials in source control.
