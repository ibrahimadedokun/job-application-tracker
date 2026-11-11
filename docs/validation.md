# Validation evidence

Validated in the cloud development environment on 11 November 2026 using Node.js 24.

- 11 backend tests passed: authentication, user isolation, strict inputs, safe links, state history, non-destructive partial updates, original/version retention, explicit consent, model failures, malformed output, request/version limits and Lambda JSON handling.
- Chromium browser workflow passed from fresh servers: create, search, status update, demo tailoring, original documents, plain-text download, JSON export, application deletion and 390px mobile overflow check. No browser page errors were observed.
- Vite production build passed.
- CDK synthesis and Lambda bundle generation passed. Template assertions passed for encrypted storage, point-in-time recovery, JWT authorization, private S3 public-access blocking, concurrency limits and explicitly scoped Bedrock model permission.
- Production dependency audit: zero vulnerabilities. Full dependency audit retains two moderate findings associated with CDK's bundled minimatch development dependency. The package manager reports it cannot patch that bundled dependency automatically; monitor the upstream CDK release. No high/critical findings remain.

The browser download host was denied by the environment's network policy, so browser tests used the preinstalled `/usr/bin/chromium`, without bypassing TLS or artifact verification.

AWS STS identity lookup returned `CredentialsProviderError`; no identity is connected. No AWS resources were deployed and no billable model calls were made. Live Cognito authentication, IAM access, Bedrock quality/model availability, infrastructure quotas and end-to-end deployed behavior remain unverified. Follow the README's live validation checklist after deploying with real account parameters.
