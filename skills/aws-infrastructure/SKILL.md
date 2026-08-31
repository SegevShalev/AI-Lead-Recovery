# Skill: AWS Infrastructure

## Use when
Creating or modifying CDK, ECS, SQS, Redis, networking, IAM, or observability.

## Current architecture target
ECS Fargate + ALB + SQS + ElastiCache Redis OSS + ECR + CloudWatch.

AWS documents Fargate as serverless container compute and requires `awsvpc` networking. ECS guidance also recommends separate task definition families for independently scalable business purposes.

For Redis, AWS currently supports ElastiCache Serverless with Redis OSS 7.1+ and TLS-capable clients.

## Workflow
1. Check existing CDK constructs.
2. Make the smallest change.
3. `cdk synth`.
4. Run tests/lint.
5. Document cost/security implications.
