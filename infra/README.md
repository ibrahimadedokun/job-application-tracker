# Terraform deployment

AWS, Azure and the Azure/AWS combination use the same commands and JSON configuration format. `cloud` selects the Terraform root under `infra/aws`, `infra/azure` or `infra/combo`; `environment` selects an isolated installation. Cloud-specific runtime adapters stay behind the shared application API. The two providers have different identity, storage and AI services, so their resource definitions remain separate. Switching cloud deploys a separate installation; it does not move user accounts or records.

## Setup and commands

Install Node.js 22+, npm and **Terraform >=1.11, <2.0**. CI uses 1.17.2. Set `TERRAFORM_BIN` if the desired executable is not on PATH. An existing Terraform 1.5 installation must be upgraded. Run commands from the repository root.

```powershell
npm ci
Copy-Item infra/environments/aws.dev.example.json deployment.json
# Or: Copy-Item infra/environments/azure.dev.example.json deployment.json
# Or: Copy-Item infra/environments/combo.dev.example.json deployment.json
```

Edit `deployment.json` with your cloud, region, environment and account/subscription/model values. The file is ignored by Git. Configure cloud credentials outside it: AWS SSO/profile/SDK chain for AWS; `az login --tenant YOUR_TENANT_ID` for Azure. Azure publishing also requires **PowerShell 7** and Azure CLI **2.80+**, plus permission to register resource providers. Terraform creates the Entra app registration and service principal, so no separate identity-setup command is needed.

```powershell
npm run check                         # application + all three Terraform targets, no cloud deployment
npm run infra:plan                    # review selected cloud/environment
npm run infra:init                    # initialize selected backend/root without planning resources
npm run deploy                        # tests, UI build, interactive terraform apply, publish
npm run infra:output                  # selected deployment's public endpoints/identifiers
```

To select another configuration without editing commands:

```powershell
$env:DEPLOYMENT_CONFIG = 'infra/environments/azure.dev.json'
npm run infra:plan
npm run deploy
```

Or pass an explicit configuration path:

```powershell
npm run infra:plan -- --config infra/environments/aws.prod.json
npm run deploy -- --config infra/environments/aws.prod.json
```

Use the same commands for both providers. Terraform prompts for approval during apply. Publishing follows only a successful apply; no auto-approval flag is added. Terraform manages the infrastructure, authentication registration/callbacks and Lambda code. Publishing uses the native static-asset/Functions deployment APIs; it is not an infrastructure provisioner or a second IaC engine. Azure also provisions a versioned Foundry prompt agent and pins its version in the Function package. Model calls are still gated by user consent in the app.

If infrastructure apply succeeded but an upload or agent provisioning failed, resolve the error and retry publishing without another apply:

```powershell
npm run deploy:publish -- --config deployment.json
```

The selected target must already have Terraform state and outputs. `infra:plan` alone does not create infrastructure. `infra:check` runs `terraform fmt`, initializes providers without a backend, validates all three roots, runs native Terraform tests with **mock providers**, and builds/verifies the Azure runtime package. No real resources are created by these checks. Live plan/apply requires credentials, tenant consent, regional service availability and model quota. Provider versions and checksums are committed in each root's `.terraform.lock.hcl`.

## Configuration

| Value                           | Meaning                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cloud`                         | `aws`, `azure` or `combo` (Azure hosting + Bedrock).                                                                           |
| `name`, `environment`           | Stable installation identity, for example `folio` / `dev`.                                                                     |
| `region`                        | Hosting region (`eu-west-2` on AWS; `westeurope` on Azure, for example).                                                       |
| `budget.amount`, `budget.email` | Optional monthly alert; empty email disables it. AWS uses USD; Azure uses the billing currency. Alerts are not a spending cap. |
| `aws`                           | Expected AWS account ID, Bedrock model ID/full profile ARN and explicit extra model ARNs.                                      |
| `azure`                         | Subscription/tenant IDs, Foundry region, model/version/SKU/capacity and optional additional frontend origins.                  |
| `backend`                       | Optional Terraform state backend configuration (defaults to isolated local state).                                             |

Both cloud sections may coexist in a configuration. The `combo` target requires both: top-level `region` selects Azure hosting and `aws.region` selects Bedrock. It uses Azure identity/storage and AWS model settings; Foundry settings are ignored. See [combo details](combo/README.md). Changing `cloud` plus the required region/account/model values selects the other implementation. Separate example files provide appropriate defaults. Credentials, API keys and document data do not belong in configuration files. Azure `budget_start_date` is the first day of the initial deployment month; keep it stable when updating a budget.

## State, environments and team use

Generated Terraform roots, artifacts, non-secret deployment outputs and default state are isolated under:

```text
.local/terraform/<name>/<environment>/<cloud>/
  root/                  # copied Terraform files and provider/backend metadata
  artifacts/             # packaged API, runtime config and generated assets
  terraform.tfstate      # default local backend
  target.json            # account/region/backend guard
  outputs.json
```

Never commit `.local`, state, plan files, backend metadata or credentials. Back up local state: losing it does not remove deployed resources and can lead to duplicate resources on a later apply. Do not run two deployments to the same target concurrently. Changing cloud or environment gets separate state. Changing account/subscription, tenant, region or backend on an existing target is rejected by the runner, because that could reuse state against a different installation. Use a new environment or explicitly migrate state. This guard does not replace proper remote-state locking.

For team/production use, provision an encrypted remote-state bucket/container separately and configure a backend. The backend is independent of the target cloud. Use a **unique key per name/environment/cloud**. Store backend credentials in the standard credential chain, not in configuration. Examples:

```json
{
  "type": "s3",
  "config": {
    "bucket": "YOUR-EXISTING-STATE-BUCKET",
    "key": "folio/prod/aws/terraform.tfstate",
    "region": "eu-west-2",
    "encrypt": true,
    "use_lockfile": true
  }
}
```

```json
{
  "type": "azurerm",
  "config": {
    "resource_group_name": "YOUR-STATE-GROUP",
    "storage_account_name": "YOURSTATEACCOUNT",
    "container_name": "tfstate",
    "key": "folio/prod/azure/terraform.tfstate",
    "use_azuread_auth": true
  }
}
```

Place one of these objects at the top-level `backend` key. Configure a remote backend **before the first plan/apply** for that installation. To migrate existing local state, back it up, edit the generated root's `backend.tf.json`, run `terraform init -migrate-state` from that root, and verify `terraform state list` before updating the matching `target.json`/configuration to the new backend. Do not delete state or the target guard to bypass migration.

## Existing CDK/Bicep installations

This replaces the deployment tools; it does not automatically adopt or destroy existing resources. No cloud resources were created in the preparation sessions. If you deployed an earlier version yourself, **do not apply a fresh Terraform installation over it** without an adoption plan. Current names may differ from the old generated names.

Inventory and export data first. Keep the old infrastructure state/template. Adapt Terraform names/settings to the live resources, then use Terraform import blocks or `terraform import` with the actual IDs. Detach AWS resources from CloudFormation using retain semantics before giving Terraform ownership; never manage the same resource actively with both systems. Azure ARM/Bicep does not have a separate Terraform state to migrate: import each resource and the Entra registration. Review plans until no unintended replacements or deletions remain. Treat Cognito pools, Entra registrations and data stores as persistent identities/data, not disposable resources. A new Terraform deployment has a separate empty datastore and users; record/account migration is a separate task.

## Protection and removal

Terraform `prevent_destroy` protects AWS DynamoDB/Cognito and Azure storage/Entra registration. AWS deletion protection and an Azure storage `CanNotDelete` lock add service-side protection. A normal destroy is therefore expected to fail until protection is deliberately removed. Export data, review which resources remain billable and remove protections only as part of an explicit teardown. Deleting state does not delete resources. See [AWS details](aws/README.md) and [Azure details](azure/README.md) and [combo details](combo/README.md) for service costs, security and live checks.
