# Deploy Folio to Azure

This directory contains the Azure infrastructure, API adapters, Foundry prompt-agent provisioning, packaging, deployment and smoke checks. Run commands from the repository root. The existing AWS commands continue to target AWS.

## Resources and costs

| Component                      | Default                                                  | Cost behavior                                                                                 |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Frontend                       | Azure Static Web Apps **Free**                           | HTTPS and static hosting within Free quotas; no SLA.                                          |
| API                            | Azure Functions **Flex Consumption**, Node.js 22, 512 MB | Scales to zero; no always-ready instances. Eligible subscriptions share a monthly free grant. |
| Records and Functions packages | One **Standard LRS Hot Blob Storage** account            | Small usage-based storage and transaction charges; no provisioned database.                   |
| Login                          | Microsoft Entra ID, single-tenant SPA + API              | Authorization code + PKCE, public client, no client secret.                                   |
| Tailoring                      | Microsoft Foundry **prompt agent**, GPT-4.1 nano         | Usage-billed input/output tokens. No paid tools or hosted-agent containers.                   |
| Cost alert                     | Optional resource-group budget                           | Notification at 80% of the monthly amount in your billing currency; not a spending cap.       |

The [Static Web Apps pricing page](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) lists Free as a personal/hobby tier, with 100 GB bandwidth per subscription and no SLA. When quotas are exhausted the site can stop serving. Upgrade deliberately if you need an SLA.

[Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/) currently lists a Flex on-demand grant of 250,000 executions and 100,000 GB-seconds per month per eligible paid consumption subscription. Storage is charged separately. Cold starts are expected with no always-ready instances. Flex currently requires a scale ceiling of at least 40 instances; this template uses that minimum and four concurrent HTTP requests per instance. Neither this ceiling nor model token quota is a spending cap.

The agent uses the current [Foundry prompt-agent API](https://learn.microsoft.com/en-us/azure/foundry/agents/overview), with a versioned agent created by the deployment script. Inference is billed. No search, code interpreter, file uploads, vector database, SQL server, API Management, NAT gateway, private endpoint, or Application Insights resource is provisioned. Application Insights can be added later if you need traces, with its own retention/ingestion costs. Check the [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your region and offer; this deployment is not guaranteed to be entirely free.

## Prerequisites

1. Node.js 22 or later, npm and PowerShell **7** (`pwsh`).
2. Azure CLI **2.80.0 or later**, authenticated with `az login`, plus Bicep (`az bicep install`). `az upgrade` updates an older CLI. The CLI present during implementation was 2.55.0, so it must be upgraded before a live deployment; local validation works with its separately installed Bicep binary.
3. A selected Azure subscription that allows Functions Flex Consumption, Static Web Apps and Microsoft Foundry, and has quota for the selected model/deployment SKU. These vary by subscription and region.
4. Permission to create app registrations in the subscription's Entra tenant (or an administrator who can run the identity script). This is separate from Azure subscription RBAC. Tenant consent policies can require admin approval.
5. Permission to create resources and assign roles: Owner on the target group, or Contributor plus Role Based Access Control Administrator/User Access Administrator. First-time resource-provider registration also needs subscription-level registration permission.

Defaults are `westeurope` for hosting/storage and `swedencentral` for Foundry. These are independent parameters because service/model availability differs. The `GlobalStandard` model deployment can process prompts outside the resource region; use an available `Standard` regional deployment or `DataZoneStandard` if you require a tighter processing boundary. Check [model region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability) and your subscription's quota before deploying personal documents. Model name, version, SKU and capacity are configurable; nano is a low-cost starting point and output must be reviewed. Choose `gpt-4.1-mini` if quality tests justify its extra cost.

## Deploy

Install dependencies and select the subscription before setting up identity:

```powershell
npm ci
az login
$env:AZURE_SUBSCRIPTION_ID = 'YOUR-SUBSCRIPTION-GUID'
az account set --subscription $env:AZURE_SUBSCRIPTION_ID
az bicep install
npm run azure:identity
```

The identity script creates one dedicated single-tenant registration and service principal, exposes the `access_as_user` API scope, requires v2 access tokens, and saves only non-secret IDs to `.local/azure/identity.json`. Rerunning reuses the saved registration. To configure an existing **dedicated Folio** registration:

```powershell
pwsh -NoProfile -File infra/azure/setup-identity.ps1 -ClientId 'YOUR-APPLICATION-CLIENT-GUID'
```

This configures that registration's API identifier and delegated permissions for Folio. Use a dedicated registration, since these API settings are owned by this deployment. No secret is created. The deployment adds the generated frontend hostname as a SPA callback and preserves existing SPA callbacks, including any custom domains.

Run a local validation, then deploy:

```powershell
npm run azure:check
npm run azure:deploy
```

`azure:check` compiles Bicep, runs tests, builds/packages the UI and API, and asserts the cost/security defaults. It creates no Azure resources and does not require an Azure login. It requires Bicep and network access for npm if the package cache is empty. Outputs go under ignored `.local/azure/`.

`azure:deploy` explicitly requires `AZURE_SUBSCRIPTION_ID`. It checks identity configuration, registers providers, creates the resource group, deploys Bicep incrementally, adds the SPA callback, creates a new version of the Foundry agent, pins that version on the API, builds the application and deploys both API and frontend. This creates billable resources. It uses the supported Flex package-deployment command, and downloads pinned SWA CLI `2.1.0` into npm's tool cache for the frontend upload. The SWA deployment token exists only in the script's process environment during that upload; it is not written into the frontend or saved output files. Builds use locked dependencies, and the API package includes its production Node dependencies for Linux deployment without remote build.

To customize deployment:

```powershell
pwsh -NoProfile -File infra/azure/deploy.ps1 `
  -SubscriptionId $env:AZURE_SUBSCRIPTION_ID `
  -ResourceGroup 'folio-azure' `
  -NamePrefix 'folio' `
  -Location 'westeurope' `
  -FoundryLocation 'swedencentral' `
  -ModelName 'gpt-4.1-nano' `
  -ModelVersion '2025-04-14' `
  -ModelSku 'GlobalStandard' `
  -ModelCapacity 10 `
  -MonthlyBudget 10 `
  -BudgetEmail 'you@example.com'
```

The budget is in the subscription's **billing currency**, not necessarily USD. Keep the resource group/name prefix stable to update an existing deployment. Names include a deterministic suffix to avoid global naming collisions. Changing the group/prefix creates a separate installation and does not migrate records or identities. `ENTRA_CLIENT_ID` can select a configured registration when `.local/azure/identity.json` is unavailable. In service-principal deployments, the script detects the caller object ID; pass `-DeployerPrincipalId` and `-DeployerPrincipalType ServicePrincipal` if directory lookup is restricted. That identity still needs permission to update the registration's SPA callback.

Safe outputs, including the frontend URL, are saved to `.local/azure/outputs.json`. The runtime frontend configuration contains only public identifiers and endpoints. You can rebuild a deployable Azure package using:

```powershell
npm run azure:build -- --config .local/azure/runtime-config.json
```

Without `--config`, `azure:build` prepares a validation package with intentionally incomplete runtime configuration. Use `azure:deploy` for a complete deployment.

## Authentication and data

Entra login supports tenant members and invited B2B guests. This is not a public self-sign-up service. For a personal workspace, use your tenant account. Invite additional users through Entra; if tenant policy disables user consent, an administrator must approve the registration's delegated permission. Each verified tenant/object identity has a separate hashed blob prefix. The API verifies JWT signature, issuer, audience, expiry, tenant, calling client and `access_as_user` scope. It rejects ID tokens, tokens for Microsoft Graph, application-only tokens and spoofed `x-ms-client-principal` headers. Cross-origin access is limited to the generated frontend hostname, but authentication is enforced independently of CORS.

The Functions user-assigned managed identity accesses Storage and Foundry. Shared storage keys and Foundry local-key authentication are disabled. Its Storage Blob Data Owner permission is scoped to the single account because the Functions host and deployment container need blob access; its Foundry User role is scoped to this project. The deployment caller also receives Foundry User on the project so it can provision agent versions. No CVs, authorization headers or generated documents are logged by application code.

Records are JSON blobs with conditional creation and ETag-based optimistic concurrency. A stale session receives HTTP 409. No local filesystem fallback is used by Azure. The common request/document limits and version retention apply to both cloud implementations. Azure and AWS stores are independent; this change does not migrate AWS records.

Each tailoring request invokes the pinned Foundry prompt agent with no tools and an isolated input, without a shared conversation or response chain. Requests set `store: false`, disable SDK retries, cap output at 7,000 tokens and have a 55-second client deadline. This is within the Function's two-minute timeout. An interrupted HTTP call does not guarantee server-side inference cancellation or zero billing. The application validates all AI output before writing a version. Provider abuse-monitoring/data-retention policies still apply; `store: false` is not a zero-retention guarantee.

Storage uses provider-managed encryption and seven-day blob/container soft deletion. Versioning is disabled to avoid retaining every update, so soft deletion does not supply full point-in-time protection for overwrites. Export records for backups. A `CanNotDelete` storage lock prevents accidental storage/resource-group deletion. This is not geo-redundant backup: LRS is selected for cost. Deleting an application removes its active blob; soft-deleted data may remain for seven days.

## Verify the live deployment

1. Open the saved `webUrl`, sign in with your tenant account and consent. Confirm the browser returns to the application and records load.
2. Create an application, update its status, refresh, export, and confirm persistence. Sign in as another tenant user in a separate browser and confirm the first user's records are inaccessible.
3. Tailor fictional documents with consent. Confirm actual agent output, version history, download/export and normal failures if quota is exhausted. Review the text for factual accuracy; the nano model is selected for cost.
4. Run the unauthenticated smoke check:

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
```

For authenticated CRUD checks, set `AZURE_SMOKE_ACCESS_TOKEN` in your local shell to the **API access token** from your signed-in browser's `/api/jobs` authorization header. Treat it as a credential; do not paste it into repository files, chat or logs. The smoke script prints no token or private records and deletes its fictional record in `finally`. Optionally add `--tailor` to make **one billable agent call**:

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net --tailor
Remove-Item Env:AZURE_SMOKE_ACCESS_TOKEN -ErrorAction SilentlyContinue
```

5. Check resource-group costs/budget notifications, model quota, storage protection, sign-out and expired-session behavior. Local validation cannot prove regional capacity, tenant consent, deployed CORS, RBAC propagation or live model output. No resources or live AI calls were created during implementation.

## Troubleshooting and removal

- **CLI error / config-zip not supported:** upgrade Azure CLI to at least 2.80.0. The script refuses older versions for live deployment.
- **Provider/region/quota rejection:** select a region supported by both Flex and Static Web Apps for `-Location`; select Foundry model capacity/SKU/region available to your subscription separately. The template does not substitute a more expensive model silently. Review partially created resources if provisioning fails; rerunning with the same settings is supported.
- **Graph denied / admin consent:** an Entra administrator must grant registration/consent permission or run `setup-identity.ps1`. Subscription Owner alone does not grant directory permissions.
- **Foundry 403 just after provisioning:** role propagation can take minutes. Agent provisioning retries for up to five minutes; rerun deployment if propagation takes longer. The Function may also need time to acquire its new permissions.
- **401 from API:** check the callback URL, tenant/client IDs, v2 token audience and delegated `access_as_user` scope. A Graph or ID token is intentionally rejected.
- **AI timeout/429:** shorten input, wait for model quota to recover, or deliberately change model/capacity. Failed generation does not save a version. Automatic generation retries are disabled to limit duplicate billing.
- **Custom domain:** add its root URL as a SPA redirect in Entra, include its origin in API CORS, and redeploy/retain that configuration deliberately. The script's CORS default is the generated SWA hostname.

To remove the installation, export data first. Delete the Static Web App, Function App, Flex plan and Foundry resource to stop new app/AI use. Storage remains billable until deleted. To delete storage or the whole resource group, explicitly remove the `retain-application-data` storage lock first, then delete the resources in Azure. Permanent deletion removes records and agent versions. The Entra application registration is outside the resource group; remove it separately only when it is no longer used. No automatic destructive teardown command is included.
