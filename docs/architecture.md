# Architecture and data protection

## Request and data boundaries

The frontend is static React hosted in an S3 bucket with public access blocked. CloudFront reaches it through Origin Access Control, redirects HTTP to HTTPS, and sets CSP, HSTS, frame protection, no-referrer and MIME-sniffing protection headers. Fonts and scripts are served locally; no analytics or external tracking scripts are included.

Production authentication uses Cognito Hosted UI, a public client without a client secret and authorization-code flow with PKCE. Browser tokens are in session storage, not a persistent localStorage login. API Gateway validates JWTs against the configured pool/client. The backend reads the verified subject from the gateway authorizer, never from user input. All record keys are `USER#<subject>` / `JOB#<uuid>`. A caller cannot choose another owner. API responses use `Cache-Control: no-store`. CORS permits only the deployed frontend; CORS alone is not authentication.

The Lambda role can access its table and explicitly configured Bedrock model resources. Model credentials stay in the AWS runtime role. Inputs are bounded and schema-validated, unknown properties are rejected, external job links only accept HTTP(S), and documents render as text rather than HTML. React escapes untrusted text. DynamoDB conditional writes detect concurrent updates. An item-size guard keeps full document histories below DynamoDB's 400 KB limit. There is no public document bucket or share link.

## Documents and model processing

Every generation requires explicit consent. Lambda sends the job's company, role and description, the CV and optional letter to the configured Bedrock model. Other applications and private notes are not sent. Documents are untrusted prompt data; the system prompt instructs the model to preserve facts, avoid fabricated credentials and return a structured full CV, letter, change summary and evidence gaps. The API validates shape/length before storing a version. This does not guarantee factual accuracy or prevent every prompt-injection attack: human review is required.

No CV content is intentionally written to application logs. Lambda operational logs have seven-day retention. AWS account administrators must review any account-level Bedrock invocation logging, CloudTrail, backup or organization policies separately. Data use, retention and residency depend on the selected AWS model and account configuration; review the provider's current terms before submitting sensitive material. Use a regional foundation model to avoid explicitly enabling cross-region inference.

## Stored record

Each application stores metadata, the current stage, timestamps, chronological stage history, and up to eight immutable document-version entries. Each version contains its creation time, original CV/letter, generated CV/letter, change explanations and missing keywords. Versions cannot be overwritten through the API. An application has a 350 KB total storage guard. Client uploads are bounded text; binary PDF/DOCX parsing is intentionally excluded.

DynamoDB uses AWS-managed KMS encryption at rest and TLS in transit. This is server-side encryption, not end-to-end encryption: authorized AWS administrators and the processing service can access plaintext. Point-in-time recovery protects against accidental loss. The dev filesystem store is only for loopback development: files use restrictive permissions but are not application-encrypted, use a shared dev identity, and do not provide distributed concurrency protection.

## Data lifecycle

- Originals are retained only when a tailored version is successfully generated. Draft input not submitted for generation stays in component memory.
- Export downloads the current user's full records as JSON. Treat downloads as sensitive; they are unencrypted on the user's device.
- Application deletion removes the active item, its originals and all versions. DynamoDB recovery points can retain deleted data for up to 35 days. There is no automatic expiry of active applications.
- To erase an account: export if requested, delete all that subject's application items, remove the Cognito user, and follow the recovery-window policy. The application UI supports per-application deletion; self-service account erasure is not implemented.
- Stack destruction retains user pool and table; an administrator must deliberately remove retained data and review remaining CDK bootstrap resources.

## Operations and costs

CloudFront handles static traffic; HTTP API throttles requests; Lambda has a five-invocation concurrency limit and 60-second timeout. AI generation has no automatic bulk retry. Version limits, input/output limits and explicit generation actions reduce accidental spend. A signed-in user can still consume model/API spend across many applications; a per-user durable quota, production abuse monitoring and email-signup policy should be added if opening registration broadly. Optional AWS Budgets notification is an alert rather than enforcement.

No secrets are built into the frontend or committed. AWS deployment parameters use the shell/SDK chain. Production has no demo-user or mock-generator path: demo logic is imported only by the loopback dev adapter. The Lambda bundle requires a JWT subject even if called without the gateway.

## Deployment readiness

Local functional checks and CloudFormation synthesis verify the code and resource graph. They cannot establish availability of a model, quota, Cognito callback behavior, email deliverability, IAM permissions or a successful AWS deployment. Complete the live checks in the README after connecting an AWS identity. Review budgets and access before inviting users with real personal data.
