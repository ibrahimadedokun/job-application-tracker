# Validation evidence

Terraform migration validated on 16 November 2026 on Windows with Node.js 24.14.0 and Terraform 1.17.2.

- All **23 backend/document/deployment tests** pass, including configuration-based cloud selection, invalid-target rejection, JWT verification, per-user isolation, optimistic concurrency, request/document limits, AI consent, output validation, timeout handling and prevention of failed-version persistence.
- All **four Chromium tests** pass against the production UI: Entra API scope/PKCE sign-in, Entra sign-out and bearer access tokens, expired production sessions, and the full application/document/mobile workflow.
- Both Terraform roots initialize and validate. Three native Terraform test runs pass with mocked providers: AWS secure serverless defaults, rejection of wildcard model access, and Azure low-cost/private/managed-identity defaults. No real provider resources are created by these tests.
- Vite production build, AWS Lambda bundling and Azure Function/frontend packaging pass. Azure package validation checks CSP/no-store configuration, authentication/agent wiring, isolated dependencies and absence of AWS clients. The PDF parser still produces the existing bundle-size advisory.
- Repository formatting, Terraform formatting and PowerShell syntax checks pass. CI installs the pinned Terraform CLI and runs application, infrastructure and browser checks. Provider versions/checksums are locked for repeatable initialization.
- `npm audit --audit-level=moderate` reports **zero vulnerabilities** after removal of CDK dependencies.

No AWS/Azure resources were applied and no live inference was requested. Local tests and mock Terraform plans do not establish live credentials, role/Graph permissions, consent policy, email delivery, quotas, regional capacity, provider propagation, deployed CORS or model quality/latency. Complete the provider-specific live checklist after an actual deployment. Existing deployments require deliberate import/adoption; changing cloud/environment does not migrate stored records or identities. See [the Terraform deployment guide](../infra/README.md).
