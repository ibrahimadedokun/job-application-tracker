# Azure Terraform target

Use the [shared Terraform workflow](../README.md) with `infra/environments/azure.dev.example.json`. The commands are the same as AWS: `npm run infra:plan`, `npm run deploy`, and `npm run deploy:publish`, with `deployment.json` selecting the cloud and environment. There is no Bicep dependency or manual Entra identity-setup script.

## Resources and cost defaults

| Component             | Default                                            | Cost behavior                                                                                 |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Frontend              | Static Web Apps **Free**                           | HTTPS/static hosting within Free quotas; no SLA.                                              |
| API                   | Functions **Flex Consumption**, Node.js 22, 512 MB | Scales to zero; no always-ready instances. Eligible subscriptions share a free monthly grant. |
| Records/host packages | One **Standard LRS Hot Blob Storage** account      | Usage-based storage/transactions; no provisioned database.                                    |
| Login                 | Entra single-tenant public SPA + API               | Authorization code + PKCE; no client secret.                                                  |
| Tailoring             | Foundry prompt agent, GPT-4.1 nano                 | Usage-billed inference; no paid tools or hosted-agent containers.                             |
| Budget                | Optional group cost notification                   | Alert at 80% of the monthly amount in your billing currency; not a hard cap.                  |

[Static Web Apps pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) lists Free as a personal/hobby tier with 100 GB subscription bandwidth and no SLA. Quota exhaustion can stop serving the site. [Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/) lists a Flex on-demand grant of 250,000 executions and 100,000 GB-seconds per month for eligible subscriptions; storage is separate. No always-ready instances means cold starts are expected. Flex's minimum scale ceiling is 40 instances; the template uses that minimum with four concurrent HTTP requests per instance. Neither concurrency nor model quota is a spending cap.

No SQL/Cosmos database, search index, code interpreter, private endpoint, NAT gateway, API Management or Application Insights resource is provisioned. Add monitoring deliberately if needed, with its associated costs. Review current prices and your subscription offer; the application is not guaranteed to run entirely free.

## Prerequisites and configuration

Install Node.js 22+, Terraform >=1.11,<2, PowerShell **7** and Azure CLI **2.80+**. Authenticate with `az login --tenant YOUR_TENANT_ID`. Set the correct subscription/tenant IDs in configuration; Terraform uses those explicit values. Publishing selects that subscription and checks its tenant. The current machine's pre-existing Azure CLI 2.55 must be upgraded before a live Azure deployment. Local Terraform checks do not require Azure CLI or a cloud login.

The deployment caller needs resource creation and role-assignment permission (Owner, or Contributor plus an appropriate RBAC administration role), resource-provider registration permission on first setup, and Entra application-registration permissions. Subscription Owner alone does not grant directory administration. In unattended deployments, configure the Azure providers' supported service-principal/workload-identity credentials and authenticate Azure CLI to the same tenant/subscription for publishing. Service principals also need the applicable Microsoft Graph app-management permissions. The deployment grants the caller Foundry User on the project for agent provisioning.

Terraform creates and owns the Entra registration, service principal, API identifier, delegated scope, v2 access-token requirement and SPA callback URLs. It does not create a secret. Tenant policy can still require an administrator to approve user consent. Single-tenant login supports tenant members and invited B2B guests; it is not a public self-sign-up system.

The example defaults to `westeurope` for hosting and `swedencentral` for Foundry, with `GlobalStandard` GPT-4.1 nano (`2025-04-14`). Verify regional service/model availability and subscription quota before applying. Model ID, version, capacity and SKU are configuration values. Global deployments may process prompts outside the resource region; choose an available `Standard` regional or `DataZoneStandard` deployment if required. Review [model region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability). Nano is selected for cost; test output quality and choose a larger model deliberately if needed.

Set `azure.budget_start_date` to the first day of the initial deployment month and retain it on updates. Set `azure.extra_origins` to additional HTTPS frontend origins (without trailing slashes) for custom-domain CORS and SPA callbacks. Domain/DNS binding itself is a separate setup step.

## Deploy and publish

```powershell
npm ci
az login --tenant YOUR-TENANT-ID
Copy-Item infra/environments/azure.dev.example.json deployment.json
# Edit subscription_id, tenant_id, regions and model configuration.
npm run check
npm run infra:plan
npm run deploy
```

Terraform manages Azure resources through its AzAPI provider and Entra identities through its AzureAD provider; both are version/checksum locked. AzAPI is a Terraform provider for the ARM resource APIs, not a Bicep deployment. `terraform apply` prompts for approval. The common runner keeps isolated state/artifacts for the selected cloud/environment and saves public Terraform outputs under `.local/terraform/<name>/<environment>/azure/outputs.json`.

After apply, publishing creates a new Foundry prompt-agent version, builds a package pinned to that version and uploads the Function ZIP with the supported Flex deployment command. It then uploads the frontend through pinned SWA CLI `2.1.0`. The deployment token is present only in the publisher process environment during upload. No credentials or private documents are embedded in the frontend. Agent version pinning is compiled into the Function package, so the publisher does not edit Terraform-owned app settings. Failed publishing can be retried using `npm run deploy:publish` without another infrastructure apply.

The native code/asset publication step remains outside Terraform's infrastructure state; no Terraform `local-exec` provisioners manage it. Creating a new agent version does not make a model inference request. Versions are retained for review/rollback and should be pruned deliberately if needed. No live deployment or inference was performed while preparing this migration.

## Authentication, storage and AI boundaries

The API independently verifies JWT signature, issuer, audience, expiry, tenant, calling client and the delegated `access_as_user` scope. ID tokens, Graph access tokens, application-only tokens and spoofed `x-ms-client-principal` headers are rejected. CORS permits only configured frontend origins. Each verified tenant/object identity gets a hashed blob prefix; no local filesystem fallback is used.

A user-assigned managed identity accesses Storage and Foundry. Shared storage keys and Foundry local-key authentication are disabled. Storage Blob Data Owner is scoped to the single account to support the Functions host, deployment container and application data. Foundry User is scoped to this project. Terraform adds no client secret or credential app setting.

Application records are private encrypted JSON blobs. Conditional creates and ETag writes prevent lost updates; stale writes receive HTTP 409. The common application enforces request/document/version bounds. Storage has seven-day blob/container soft deletion, versioning disabled for cost, a `CanNotDelete` lock and Terraform `prevent_destroy`. Soft deletion is not full overwrite recovery; export records for backups. LRS is not geographic redundancy. Active record deletion may leave recoverable data for seven days.

Each tailoring request invokes the pinned [Foundry prompt agent](https://learn.microsoft.com/en-us/azure/foundry/agents/overview) with isolated input and no tools, shared conversation or response chain. Requests use `store: false`, no SDK retries, a 7,000-token output ceiling and a 55-second client deadline within the Function's two-minute timeout. Failed/invalid output is not persisted. A timed-out client call does not guarantee server-side cancellation or zero billing; Azure's provider retention/abuse-monitoring policies still apply. Application code does not log documents or authorization headers. Review generated text for factual accuracy before use.

## Live verification and troubleshooting

Open `web_url` from `npm run infra:output`. Sign in, create/update/export a fictional application, refresh to confirm persistence, and test a second user's isolation. Tailor fictional documents with consent and check the saved version/download. Test sign-out and expired sessions, then review costs/model quota and storage protection.

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
```

For authenticated CRUD checks, set `AZURE_SMOKE_ACCESS_TOKEN` locally to the API access token from a signed-in browser request. Treat it as a credential: do not commit it or paste it into chat/logs. The smoke script logs no token/private records and removes its fictional record in `finally`. Add `--tailor` for **one billable AI call**, then clear the token:

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net --tailor
Remove-Item Env:AZURE_SMOKE_ACCESS_TOKEN -ErrorAction SilentlyContinue
```

Local mocked Terraform/runtime/browser checks cannot prove live regional capacity, Graph consent, IAM/RBAC propagation, CORS or model quality/latency. Foundry roles can take several minutes to propagate; agent provisioning retries transient permission errors for up to five minutes. If it still fails, resolve access/quota and rerun `deploy:publish`. A 401 usually indicates wrong tenant/audience/scope or an ID/Graph token; an AI 429 indicates model quota/throttling. The template does not silently substitute a more expensive model.

For existing Bicep installations, follow the shared guide's import/adoption instructions before applying. For teardown, export records first; remove `prevent_destroy`/the storage lock only as part of an explicit reviewed deletion. The registration is managed by Terraform but also protected against destruction. Retained storage continues to incur charges. Deleting Terraform state does not delete Azure resources.
