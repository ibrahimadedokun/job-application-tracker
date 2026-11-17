# Deployment and operations

The deployment runner selects a Terraform root using `cloud: "combo"`, `"aws"` or `"azure"`. The [current design](../docs/architecture.md) explains the architecture; provider guides cover [combo](combo/README.md), [AWS](aws/README.md) and [Azure](azure/README.md). Check [validation status](../docs/validation.md) before treating any target as production-ready.

## Prerequisites

| Requirement                                                                     | Applies to                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Node.js 22+, npm, Terraform >=1.11 and <2                                       | All targets; CI pins Terraform 1.17.2                                             |
| AWS SDK credentials, typically an SSO/profile session                           | `aws` and `combo`                                                                 |
| PowerShell 7, Azure CLI >=2.80, Azure/Entra authentication                      | `azure` and `combo`                                                               |
| Resource creation, role assignment and provider-registration permissions        | Azure deployment identity                                                         |
| Entra app-management permissions; app-role assignment permission for federation | Azure/combo directory identity; subscription ownership alone is insufficient      |
| IAM and applicable service administration permissions                           | AWS deployment identity                                                           |
| Enabled model, eligible account, valid agreement and sufficient quota           | Each model provider; infrastructure provisioning does not grant model eligibility |

Use `TERRAFORM_BIN` if the intended Terraform executable is not on PATH. Credentials belong in the cloud credential chain, not JSON configuration, source files or frontend assets. For unattended deployments, use workload identity and an auditable deployment role.

## Configure and deploy

For a new installation only:

```powershell
npm ci
Copy-Item infra/environments/combo.dev.example.json deployment.json
# Alternatives: aws.dev.example.json or azure.dev.example.json
# Edit installation identity, account/subscription, tenant, regions and model.
az login --tenant YOUR-TENANT-ID
$env:AWS_PROFILE = 'YOUR-AWS-PROFILE'
aws sso login --profile $env:AWS_PROFILE
npm run check
npm run infra:plan -- --config deployment.json
npm run deploy -- --config deployment.json
```

Only authenticate to the clouds used by the selected target. Keep existing configuration and state when updating an installation. `deployment.json` is ignored by Git.

| Command                                              | Behavior                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run check`                                      | Application tests, frontend build, mocked Terraform and package verification; no cloud deployment         |
| `npm run infra:init -- --config deployment.json`     | Initialize selected root/backend and validate it                                                          |
| `npm run infra:plan -- --config deployment.json`     | Live infrastructure plan; combo also checks service regions and validates resources when its group exists |
| `npm run deploy -- --config deployment.json`         | Tests/build, interactive Terraform apply, then publish code/assets                                        |
| `npm run deploy:publish -- --config deployment.json` | Build and retry publication against existing infrastructure; no apply                                     |
| `npm run infra:output -- --config deployment.json`   | Public endpoints and deployment identifiers from state                                                    |

Configuration selection order is explicit `--config`, then `DEPLOYMENT_CONFIG`, then `deployment.json`. The runner does not automatically approve applies. Model inference is not part of apply or publication. Azure-only publication creates a Foundry agent version; combo publication does not.

## Configuration reference

| Key                                            | Purpose                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cloud`, `name`, `environment`                 | Target and stable installation identity; each combination has separate state                                      |
| `region`                                       | Hosting region; combo defaults to Azure `eastus2`                                                                 |
| `aws.account_id`                               | Expected 12-digit account; provider rejects other accounts                                                        |
| `aws.region`                                   | Combo Bedrock/STS source region; AWS-only uses top-level `region`                                                 |
| `aws.model_id`, `aws.extra_model_arns`         | Explicit model ID or full inference-profile ARN and its exact model resources; no wildcards                       |
| `aws.existing_oidc_provider_arn`               | Combo only: reuse a provider managed elsewhere; normally empty on a first installation                            |
| `aws.cognito_domain_prefix`                    | Optional AWS-only hosted-login domain prefix                                                                      |
| `azure.subscription_id`, `azure.tenant_id`     | Azure resource and directory targets                                                                              |
| `azure.static_web_region`                      | Combo static-app resource region; default `eastus2`                                                               |
| `azure.resource_group_region`                  | Combo only: preserve a retained group's metadata location during deliberate recovery; omit for a new installation |
| `azure.extra_origins`                          | Additional HTTPS origins for CORS and SPA callbacks; custom domain/DNS binding remains separate                   |
| `azure.budget_start_date`                      | First day of the initial deployment month; keep stable on updates                                                 |
| Azure Foundry model/region/SKU/capacity fields | Azure-only; ignored by combo                                                                                      |
| `budget.amount`, `budget.email`                | Optional monthly alerts; empty email disables them. Azure billing currency and AWS USD; alerts are not caps       |
| `backend`                                      | Local, S3 or AzureRM state backend; independent of hosting cloud                                                  |

For inference profiles, keep `aws.account_id` and the source region consistent with the profile ARN. Regional and exact region-agnostic foundation-model ARNs can both be valid. Use the provider's returned values rather than inventing destinations. The combo guide covers GPT-specific validation and account access.

## State and recovery

The runner creates:

```text
.local/terraform/<name>/<environment>/<cloud>/
  root/                   # generated Terraform copy and backend metadata
  artifacts/              # deployable code and public runtime config
  terraform.tfstate       # default local state
  target.json             # account, tenant, region and backend guard
  outputs.json            # public deployment outputs
```

Edit source under `infra/<cloud>`; generated roots are overwritten. Never commit `.local`, state, plans, tokens or private document exports. Treat state and backups as sensitive. Back up local state securely, and never run concurrent operations against the same target.

The guard rejects account, tenant, hosting region or backend changes; combo also guards the AWS account and source region. A new environment creates a separate installation, not a migration. Do not delete state or the guard to bypass an error.

| Situation                                        | Recovery                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Apply partially failed                           | Retain state, fix the cause and review a fresh plan; do not start another empty state over live resources          |
| Infrastructure exists but publishing failed      | Retry `deploy:publish` with the same configuration                                                                 |
| Resource exists outside this state               | Confirm exclusive ownership, then import/adopt it deliberately; do not destroy records to resolve bookkeeping      |
| Region/account/backend must change               | Back up state/configuration; review resource replacements and identity/data migration before changing the guard    |
| Empty deployment intentionally destroyed         | Confirm no managed resources remain, then update the guarded target deliberately and rebuild with protected source |
| Provider returns stale/missing child information | Reconcile cloud existence with state before modifying either; retain backups and review the resulting plan         |

## Remote state

Use encrypted, access-controlled remote state with locking for team or production work. Provision the backend separately and choose a unique key per installation. Configure it before the first apply when possible.

Example top-level `backend` object:

```json
{
  "type": "s3",
  "config": {
    "bucket": "YOUR-EXISTING-STATE-BUCKET",
    "key": "folio/prod/combo/terraform.tfstate",
    "region": "eu-west-2",
    "encrypt": true,
    "use_lockfile": true
  }
}
```

An AzureRM backend instead uses `resource_group_name`, `storage_account_name`, `container_name`, `key` and `use_azuread_auth: true`. Authenticate through the backend's credential chain; do not put access keys in configuration.

For an existing backend migration, back up state, configure the generated root's backend, run `terraform init -migrate-state` there, verify state/resource ownership, then align configuration and target metadata. Do not use ordinary deployment commands as an implicit migration tool.

## Verify and operate

Open `web_url` from the outputs. Public health checks establish only frontend/configuration delivery and anonymous API rejection. Before using real documents, verify signed-in CRUD, export, sign-out, session expiry, two-user isolation and a consented fictional AI request. Record model access, latency and quota separately from infrastructure health.

The current Bedrock blocker is documented in [validation](../docs/validation.md): agreement activation succeeded, but AWS still denies GPT-6 Sol to the account. Recreating infrastructure or widening runtime permissions does not establish provider eligibility.

## Teardown

Export application data and preserve a protected state/configuration backup. Review the exact cloud resources and any shared identity/provider dependencies. Azure storage/browser registration and AWS DynamoDB/Cognito have Terraform destruction guards; Azure storage also has a lock and AWS data/identity resources have service protections.

Remove protections only for an explicitly authorized teardown. Use a reviewed saved destroy plan, keep state until completion, and restore protected source before any rebuild. Inspect cloud resources and a final plan afterwards. Deleting a resource group does not remove its global Entra apps or AWS federation resources. Retained resources and backup copies may still incur charges.
