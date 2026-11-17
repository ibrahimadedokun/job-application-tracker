# Folio — job application tracker

A private workspace for tracking job applications, tailoring CVs and cover letters, and reviewing document versions. React provides the browser UI; Node.js provides the API and cloud adapters.

![Folio dashboard](docs/dashboard.png)

## Features

- Track applications through Saved, Applied, Interview, Offer, Rejected and Withdrawn, with a status history.
- Search applications and keep job descriptions, links and private notes.
- Paste documents or extract text from TXT, Markdown, PDF and DOCX files in the browser.
- Generate CV and cover-letter drafts with explicit consent; retain originals and up to eight versions per application, within the storage limit.
- Download generated DOCX files, export records as JSON and delete applications from active storage.

AI drafts require human review. Uploaded formatting is not retained; scanned PDFs need OCR, which is not implemented. Deletion from active storage does not immediately erase retained recovery copies.

## Run locally

Install Node.js 22+ and npm. Run these in separate terminals:

```sh
npm ci
npm run dev
```

```sh
npm run dev:web
```

Open the Vite URL. Local mode uses a fixed development identity, files in `.local/data`, and deterministic demo generation. Use fictional data and keep the servers on loopback. No cloud credentials are required for the demo.

For live local Bedrock generation, set `DEMO_AI=false`, `AWS_REGION` and `BEDROCK_MODEL_ID`, and use the AWS SDK credential chain. Model access and inference charges apply. See [.env.example](.env.example); environment files are not loaded automatically.

## Deployment options

All targets use Terraform and the same deployment runner. Each target has separate state, identities and records; selecting another target does not migrate data.

| Target  | Hosting and records                                              | Identity | AI                   | Guide                                |
| ------- | ---------------------------------------------------------------- | -------- | -------------------- | ------------------------------------ |
| `combo` | Azure Free Static Web Apps, Flex Functions, private Blob Storage | Entra    | AWS Bedrock          | [Azure + AWS](infra/combo/README.md) |
| `aws`   | CloudFront/S3, Lambda, DynamoDB                                  | Cognito  | AWS Bedrock          | [AWS](infra/aws/README.md)           |
| `azure` | Azure Free Static Web Apps, Flex Functions, private Blob Storage | Entra    | Foundry prompt agent | [Azure](infra/azure/README.md)       |

The current live installation uses `combo`, with Azure resources in **East US 2** and Bedrock requests originating in **eu-west-2**. GPT-6 Sol inference is currently blocked by AWS account eligibility, despite an active model agreement. The infrastructure and public site checks passed; this does not establish working AI generation. See the dated [validation record](docs/validation.md).

Start with the [deployment guide](infra/README.md). Do not overwrite an existing `deployment.json` or apply a new installation over existing resources.

## Documentation

- [Current system design](docs/architecture.md): components, trust boundaries, data lifecycle, decisions, trade-offs and limitations.
- [Future system design](docs/future-system-design.md): proposed security, latency, reliability and efficiency improvements, capacity assumptions, cost envelope and migration plan.
- [Deployment and state management](infra/README.md): prerequisites, commands, configuration, recovery and teardown.
- [Validation and operational readiness](docs/validation.md): observed results and outstanding checks.

## Development checks

```sh
npm test                  # application, adapters and deployment configuration
npm run build             # production frontend
npm run infra:check       # all Terraform targets with mock providers; package checks
npm run check             # tests, frontend build and infrastructure/package checks
npx playwright install chromium
npm run test:e2e          # isolated browser workflow and authentication simulations
npm run format:check
```

Browser tests use fictional data and demo AI. Stop development servers on ports 3001 and 5173 before running them. CI also runs the production dependency audit; local mock tests do not deploy resources or prove account-specific cloud access.

## Repository map

| Directory | Purpose                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `src/`    | UI, browser authentication, document extraction and DOCX output                 |
| `server/` | Shared validation, application routes, Bedrock generator and AWS/local adapters |
| `infra/`  | Deployment runner, configuration, three Terraform targets and publishing        |
| `tests/`  | Application, security, document and browser tests                               |
| `docs/`   | Current/future system designs and validation evidence                           |

Email ingestion, job scraping, employer submission, account-wide self-service erasure and production abuse quotas are not implemented.
