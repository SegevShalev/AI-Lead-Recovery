# CDK Infrastructure

Target AWS resources:
- VPC
- ECR repositories for API, Recovery Worker and AI Service
- ECS/Fargate cluster and services
- ALB for API
- SQS queue + DLQ
- ElastiCache Redis OSS/Valkey
- IAM roles/policies
- CloudWatch log groups/metrics
- secrets/configuration integration

Deploy application services independently where practical.

Keep local development independent of AWS. Do not provision expensive production-grade infrastructure before the local vertical slice works.
