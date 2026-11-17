# AWS deployment

Use [shared deployment operations](../README.md) with [aws.dev.example.json](../environments/aws.dev.example.json). This is an alternative installation; the current live validation record is for combo, not AWS-only.

## Resources and behavior

| Component  | Configuration                                                                     |
| ---------- | --------------------------------------------------------------------------------- |
| Frontend   | Private S3 bucket, CloudFront Origin Access Control and security headers          |
| Login      | Cognito public client, authorization code with PKCE                               |
| API        | HTTP API JWT authorizer, required `openid` scope and frontend-only CORS           |
| Compute    | Node.js 22 Lambda, 512 MB, 30-second timeout, five reserved concurrent executions |
| Records    | On-demand DynamoDB, encryption, conditional writes and point-in-time recovery     |
| AI         | Bedrock Converse, one SDK attempt, 24-second request deadline                     |
| Operations | Seven-day API/Lambda logs; gateway rate limit 5 requests/second with burst 10     |

The role permits table operations, operational logging and invocation of configured Bedrock model resources. DynamoDB/Cognito have service deletion protection and Terraform `prevent_destroy`. See the [current design](../../docs/architecture.md) for shared validation, consent, ownership and data limits.

## Configure

Top-level `region` is the AWS hosting/model source region. Set `aws.account_id` and an enabled Converse model in `aws.model_id`. Full inference-profile ARNs require exact foundation-model resources in `aws.extra_model_arns`; global profiles may return region-agnostic ARNs. Profiles affect processing residency. Account activation, authorization, quotas and actual model availability must all be verified.

The default example is a configuration example, not a model-access guarantee. The combo target has additional GPT-specific project permissions and profile validation; do not assume that its live results establish compatibility for every model on AWS-only.

The deployment caller needs the relevant service, IAM/pass-role, static upload and invalidation permissions. Use an AWS profile/SSO session and the expected account. Follow the shared plan/apply commands; no separate infrastructure bootstrap is required.

## Publish and verify

Terraform owns infrastructure and the Lambda package. The publisher uploads assets and `/config.json`, then invalidates CloudFront. It retains older hashed assets so open sessions can continue loading them. Retry failed publication with `deploy:publish`; remove obsolete assets deliberately.

Verify signup/email delivery, PKCE callbacks, authenticated CRUD/export, a second user's isolation, expired sessions and a consented fictional model request. Check recovery and budget delivery separately. Mock provider tests cannot validate those account-specific behaviors.

## Cost and retention

There is no always-on application compute, NAT gateway or container cluster. Storage, CDN transfer, API requests, DynamoDB recovery, logs, identity and inference can still cost money; optional USD budget alerts do not cap spending. Active record deletion can leave recovery copies within the configured service retention window. Export data before reviewed teardown; the static bucket must be emptied deliberately before removal.
