# Azure + AWS Terraform target

This target hosts the application on Azure and runs its document-tailoring AI through Amazon Bedrock Converse. It uses the same consent checks, prompts and output validation as the AWS target. The AI agent runs in the Function; no managed Bedrock Agent, AgentCore runtime or Foundry deployment is provisioned.

| Component                       | Service                                              | Cost behavior                                         |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Frontend                        | Azure Static Web Apps Free                           | Free within hobby-tier quotas, no SLA                 |
| API                             | Azure Functions Flex Consumption, Node.js 22, 512 MB | Scales to zero, no always-ready instances             |
| Records and deployment packages | Azure Standard LRS Blob Storage                      | Storage and transaction charges; no database capacity |
| Login                           | Entra single-tenant SPA and API                      | PKCE, no client secret; members and invited guests    |
| AI                              | AWS Bedrock, default Nova Micro                      | On-demand inference, no provisioned throughput        |
| Cross-cloud credentials         | Azure managed identity → AWS STS → Bedrock           | Short-lived credentials, no stored AWS keys           |

[Static Web Apps pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) lists 100 GB subscription bandwidth on Free; quota exhaustion can stop serving the site. [Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/) lists a subscription-wide Flex on-demand monthly grant of 250,000 executions and 100,000 GB-seconds for eligible offers. Storage, internet egress from Azure to AWS, model inference and usage above grants can incur charges. Cold starts are expected. Functions uses the minimum 40-instance scale ceiling and four concurrent requests per instance. These settings do not cap spending.

No Foundry, SQL/Cosmos, DynamoDB, Lambda, API Gateway, NAT gateway, private endpoints, Application Insights or always-on compute is created. Optional budget email enables separate Azure resource-group and AWS account cost alerts, each at 80% of `budget.amount`; Azure uses the subscription billing currency and AWS uses USD. The AWS alert covers account-wide spending, not just this role. Alerts are not spending caps.

## Configure and deploy

Use the [shared deployment workflow](../README.md). Install Node.js 22+, Terraform >=1.11,<2, PowerShell 7 and Azure CLI 2.80+. Authenticate to both clouds using Azure CLI and the AWS SDK credential chain/SSO profile.

```powershell
npm ci
Copy-Item infra/environments/combo.dev.example.json deployment.json
# Edit Azure tenant/subscription and AWS account/region/model values.
az login --tenant YOUR-TENANT-ID
$env:AWS_PROFILE = 'YOUR-AWS-PROFILE'
aws sso login --profile $env:AWS_PROFILE
npm run check
npm run infra:plan
npm run deploy
```

`cloud: "combo"` selects this root. Top-level `region` is the Azure hosting region; `aws.region` is the Bedrock/STS region. Both `azure` and `aws` sections are required. Azure Foundry model settings are ignored. The default [Nova Micro model](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html) is a low-cost text model; confirm regional availability, access, quotas and document quality in your AWS account before deploying. Other Converse models are configurable. Inference profiles require their full ARN and explicit destination foundation-model ARNs in `aws.extra_model_arns`; wildcards are rejected. Profiles may process documents across regions.

### Use OpenAI GPT-6 Sol

[GPT-6 Sol on Bedrock Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html) requires a cross-region inference profile. London (`eu-west-2`) supports `global.openai.gpt-6-sol`; it does not support regional-only inference for this model. Activate account access through the Bedrock model catalog/playground using a deployment identity with the required Marketplace permissions before relying on the app. The runtime role receives invocation permissions only and cannot subscribe to models.

Retrieve the profile and all current destination model ARNs from your selected source region. With an existing, edited `deployment.json`, this PowerShell example updates only its Bedrock configuration and checks the CLI result before writing:

```powershell
$comboConfig = Get-Content -LiteralPath deployment.json -Raw | ConvertFrom-Json
if ($comboConfig.cloud -ne 'combo') { throw 'Select the combo target first.' }
$profileJson = aws bedrock get-inference-profile --region $comboConfig.aws.region --inference-profile-identifier global.openai.gpt-6-sol --output json
if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve the GPT-6 Sol inference profile.' }
$bedrockProfile = $profileJson | ConvertFrom-Json
if ($bedrockProfile.status -ne 'ACTIVE' -or -not $bedrockProfile.models) { throw 'The profile is not ready.' }
$comboConfig.aws.model_id = $bedrockProfile.inferenceProfileArn
$comboConfig.aws.extra_model_arns = @($bedrockProfile.models | ForEach-Object { $_.modelArn })
$comboConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath deployment.json
npm run infra:plan
npm run deploy
```

The profile must match `aws.account_id` and `aws.region`. The runner rejects a bare GPT model ID or a mismatched profile before Terraform runs; Terraform independently enforces these rules. Refresh the destination list if AWS changes a profile's routing. The account must permit the selected cross-region destinations through its organization policies.

For OpenAI GPT models, Terraform automatically adds the exact `arn:aws:bedrock:<aws.region>:<aws.account_id>:project/default` invocation resource alongside the profile and destination models. Do not put project ARNs in `extra_model_arns`, which remains restricted to foundation-model ARNs. Detection uses both the selected profile name and destination model ARNs, including for application inference profiles with opaque names. Other model families receive no extra project permission.

The Function receives the detected model family through `BEDROCK_OPENAI_GPT`. GPT requests omit temperature and use low reasoning effort within the existing token/deadline limits. Nova retains its sampling settings. No inference or Marketplace subscription is attempted during Terraform or publication; live model access, regional capacity, quota and output quality must still be verified with a consented fictional tailoring request after deployment.

Set `azure.budget_start_date` to the first day of the initial deployment month and retain it thereafter. `azure.extra_origins` adds HTTPS origins for CORS and SPA callbacks. Custom domain binding remains separate. Single-tenant Entra login requires members or invited B2B guests, with tenant consent where required.

The Azure caller needs resource/provider creation, storage role assignment and Entra app-management permissions. Federation additionally needs directory permission to assign an application role to the managed identity (for unattended Graph callers, the applicable `AppRoleAssignment.ReadWrite.All` and application-read permissions with admin consent). Subscription Owner alone does not provide those directory rights. AWS credentials must match `aws.account_id` and permit IAM OIDC providers/roles/policies and optional Budgets administration. Bedrock model access must already be available to the account.

Terraform prompts before applying. Publishing packages the shared Azure authentication/storage adapters with the Bedrock runtime, uploads the Function ZIP and publishes the frontend with pinned SWA CLI. No model call occurs during deployment. Retry a failed upload using `npm run deploy:publish`. State and artifacts are isolated in `.local/terraform/<name>/<environment>/combo/`; the target guard includes both cloud accounts, tenant, both regions and backend. Resources use a `-combo` name suffix to coexist with Azure-only installations. A new target has separate identities and an empty datastore; it does not migrate existing applications.

## Federation and permissions

The [AWS-documented managed-identity federation pattern](https://aws.amazon.com/blogs/security/how-to-access-aws-resources-from-microsoft-entra-id-tenants-using-aws-security-token-service/) exchanges an Entra token for temporary AWS role credentials. This target creates a dedicated single-tenant registration with **v1** access tokens and an application role assigned exclusively to the Function identity. The browser/API registration continues using v2 delegated access tokens. AWS trusts the exact `sts.windows.net/<tenant>/` issuer, dedicated federation audience and managed identity principal ID as subject. The role can only `bedrock:InvokeModel` on configured model resources and, for OpenAI GPT, the account/region's default project. No credentials enter frontend configuration or runtime logs.

The runtime explicitly uses `ManagedIdentityCredential`, avoiding a developer credential fallback. It requests a token only on the first AI call, caches STS credentials in memory and refreshes five minutes before expiry. Concurrent refreshes share one exchange; failed refreshes can be retried. STS and Bedrock use one SDK attempt, bounded token/exchange deadlines and a 55-second model deadline. Model output is validated before saving. Document storage and CRUD remain in Azure; only consented tailoring prompts go to AWS. Provider retention and processing policies apply. Client timeouts cannot guarantee inference cancellation or zero billing.

AWS permits one IAM OIDC provider per issuer URL per account. For an account that already has this tenant's v1 issuer, set `aws.existing_oidc_provider_arn`. Add this installation's federation audience to that provider through its existing owner first; this target validates the issuer/audience and does not take over that provider. The audience is `api://<federation-application-client-id>`, available as `deployment.federation_audience` after apply. For first setup when the registration does not yet exist, an operator can stage the reviewed creation of `azuread_application_identifier_uri.bedrock` and its dependencies in the generated root using Terraform `-target`, then update the externally owned provider's audience and complete a full plan/apply. Do not import an externally managed provider into two states. Do not remove a shared provider while other roles depend on it.

## Verify and retain data

Local `npm run check` covers all three Terraform roots with mock providers, credential refresh tests and deployable package checks. Live availability, managed identity issuance, Graph consent, IAM/RBAC propagation, model quotas and latency still require account verification.

Open `web_url` from `npm run infra:output`. Sign in, create/update/export a fictional record and refresh to verify persistence. Check a second user's isolation and sign-out. The shared Azure smoke script also works here:

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
# Optional authenticated CRUD: set AZURE_SMOKE_ACCESS_TOKEN locally.
# Add --tailor only to make one billable Bedrock request with fictional data.
```

Treat the smoke token as a credential and clear it afterwards. For STS failures check tenant, v1 token version, audience, subject and application-role assignment; never log full tokens. For AI access errors check model access/region and the role's allowed model ARNs. New directory and IAM settings may need time to propagate.

Storage uses managed identity, HTTPS, private containers, seven-day soft deletion, `prevent_destroy` and a `CanNotDelete` lock. The browser registration is also protected from Terraform destruction. Soft deletion does not provide complete overwrite recovery; export records for backups. Follow the [shared state/adoption/teardown guidance](../README.md) before adopting existing resources or removing protection. Retained storage continues to incur charges.
