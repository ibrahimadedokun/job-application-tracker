# Azure-only deployment

Use [shared deployment operations](../README.md) with [azure.dev.example.json](../environments/azure.dev.example.json). This alternative uses Foundry for AI. For Azure hosting with Bedrock, use [combo](../combo/README.md).

## Resources and behavior

| Component        | Configuration                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Frontend         | Free Static Web Apps                                                                               |
| API              | Node.js 22 Flex Consumption Function, 512 MB, no always-ready instances                            |
| Records/packages | Private Standard LRS Blob Storage with identity-based access                                       |
| Login            | Single-tenant Entra SPA/API, PKCE, delegated `access_as_user` scope                                |
| AI               | Version-pinned Foundry prompt agent; default GPT-4.1 nano                                          |
| Permissions      | Managed identity; storage keys and Foundry local-key authentication disabled                       |
| Protection       | Storage lock, seven-day blob/container soft deletion; storage/browser Terraform destruction guards |

Shared JWT checks, ownership, conditional Blob writes and document limits are described in the [current design](../../docs/architecture.md). The Azure-only package uses Foundry rather than AWS runtime clients. No database server, private endpoint, API Management or Application Insights resource is provisioned.

## Configuration and readiness caveats

The source example uses West Europe hosting and Sweden Central Foundry, with GPT-4.1 nano version `2025-04-14` on `GlobalStandard`. These are source defaults, not a subscription eligibility or model-quota guarantee. West Europe restricts some new regional customers, and Static Web Apps supports fewer resource locations than Functions. Select a hosting location supported by both services for this target. Global model deployments may process prompts outside the resource region.

**Known fresh-deployment limitation:** this target still declares `blobServices/default` as `azapi_resource.blobs`. Azure can already have created that singleton with the storage account, producing an import-required error. The combo target fixes this with `azapi_update_resource`. Azure-only needs deliberate child-resource adoption or the corresponding source/state migration before it can be treated as ready for a fresh installation. Local mock validation does not detect this live-provider behavior.

The current live validation record does not establish a successful Azure-only deployment. Check [model/region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability), quota and directory policy before applying.

## Identity and publishing

The deployment identity needs Azure resource creation, RBAC assignment and first-time provider registration permissions, plus Entra app-management rights. Subscription Owner alone does not grant directory rights. Users must be tenant members or invited guests; tenant policy can require administrator consent.

Terraform creates the resource graph and Entra registration/callbacks. After apply, publishing creates a Foundry prompt-agent version, pins its version in the Function package, uploads the Function ZIP and publishes static assets with pinned SWA CLI. Retry with `deploy:publish` after resolving publication, quota or RBAC errors. No inference is required to provision an agent version.

Each generation uses isolated input, no tools/shared conversation, `store: false`, a 7,000-token ceiling and a 55-second deadline. Provider processing/retention rules still apply. Free hosting and scale-to-zero compute reduce idle cost; storage, inference, traffic and quota overages remain billable. Alerts are not caps.

## Verification

After addressing the readiness caveat, use the [shared live checklist](../README.md#verify-and-operate). The public smoke check is:

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
```

Set `AZURE_SMOKE_ACCESS_TOKEN` locally for fictional authenticated CRUD checks. Add `--tailor` only when authorizing a billable fictional AI request; clear the token afterwards. Do not put tokens or documents in logs, source or chat. Use the shared state/recovery and teardown procedures rather than deleting state to resolve a deployment error.
