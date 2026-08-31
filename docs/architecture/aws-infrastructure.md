# AWS Infrastructure

## Target stack

### Compute

Amazon ECS on AWS Fargate:

- `api`
- `recovery-worker`
- `ai-service`

Each has its own ECS service/task definition so it can scale independently.

### Networking

- VPC
- public subnets for ALB
- private subnets for application tasks and managed data services where applicable
- security groups with least-privilege inbound rules

### Messaging

Amazon SQS:

- `conversation-events`
- dead-letter queue

Use Standard SQS initially. Ordering is not a product requirement for the first slice; handlers must be idempotent.

### Redis

Amazon ElastiCache for Redis OSS, preferably Serverless for the learning/demo environment if its pricing is acceptable.

As of 2026 AWS documents ElastiCache Serverless support for Redis OSS 7.1 and later, with TLS-capable clients and automatic scaling. Verify current pricing/engine availability before provisioning.

### Container registry

Amazon ECR for each service image.

### Observability

CloudWatch Logs and basic CloudWatch metrics/alarms.

### Secrets

AWS Secrets Manager or SSM Parameter Store. Never hardcode credentials.

### Database

MongoDB Atlas is the preferred MongoDB path for the MVP because it keeps the team focused on application/cloud architecture rather than operating MongoDB. The exact Atlas/AWS networking arrangement can be hardened later.

## IaC

Use AWS CDK in TypeScript under `infra/cdk`.

The first infrastructure milestone should create:

- VPC
- ECR repositories
- ECS cluster
- ALB
- SQS queue + DLQ
- ElastiCache Redis OSS
- IAM roles
- CloudWatch log groups

Do not provision a production-grade multi-AZ everything architecture before the application can run.

## Cost rule

This is a learning project. Every AWS resource must have an owner, purpose, and expected cost impact documented. Prefer scale-to-zero/local development where practical.

## Sources

AWS ECS/Fargate uses `awsvpc` networking and separate task definitions/services can scale independently: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/application_architecture.html

Amazon SQS is explicitly intended to decouple microservices and distributed systems: https://docs.aws.amazon.com/sqs/

AWS ElastiCache supports Redis OSS and currently offers Serverless and node-based deployments: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html
