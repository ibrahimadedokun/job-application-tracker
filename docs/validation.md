# Validation evidence

Deployment preparation validated on 15 November 2026 on Windows using Node.js 24.14.0.

- 16 backend/document/deployment tests pass, covering authentication, user isolation, validation, status history, version retention, consent, model errors, request/version limits, DOCX extraction/export, deployment configuration, DynamoDB pagination, record-size enforcement and model timeout cancellation without persistence.
- Both Chromium tests pass against the built production UI with the same CSP as CloudFront: session expiry returns to sign-in; the application workflow covers creation/search/status changes, DOCX CV upload, PDF cover-letter upload, demo tailoring, original text, DOCX download, JSON export, deletion and mobile overflow checks. Browser page errors and console errors fail the workflow test. Test servers use isolated local storage and demo generation, regardless of inherited cloud configuration.
- Vite production build passes. PDF parsing remains a large lazy-loaded chunk and produces a bundle-size advisory; it does not block deployment.
- CDK synthesis and Lambda bundling pass with CDK library 2.277.0. Infrastructure assertions cover encryption, point-in-time recovery, access-token scopes, integration/Lambda timeouts, access logs, private S3 origin access, HTTPS, static asset caching, data retention, concurrency and explicitly scoped Bedrock permissions.
- Repository formatting is checked in CI, alongside the application/build/infrastructure checks and browser workflow.
- Dependency audit after updating CDK: zero production vulnerabilities, zero high/critical findings overall. Two moderate development-only findings remain in CDK's bundled minimatch dependency. The registry's proposed fix downgrades CDK to 2.239.0; no downgrade or unsupported modification of bundled dependencies was applied.

No AWS resources were deployed and no live model requests were made during this preparation. Deployment preflight validates explicit configuration and checks the STS caller account when you run `npm run deploy`. Local tests do not establish live Cognito redirects, email delivery, account quotas, deployment IAM permissions, or Bedrock model availability/latency. Follow the README's live verification checklist after deploying.
