# Azure hosting with AWS Bedrock

This is the current live deployment target. Azure hosts the UI, API and private records; application code invokes Bedrock through temporary AWS credentials. See the [current system design](../../docs/architecture.md) for decisions and trust boundaries, and [deployment operations](../README.md) for common commands/state management.

## Defaults and current installation

| Setting                     | Source default                                      | Current live configuration         |
| --------------------------- | --------------------------------------------------- | ---------------------------------- |
| Azure hosting/storage/group | `eastus2`                                           | East US 2                          |
| Static-app region           | `azure.static_web_region: eastus2`                  | East US 2                          |
| Compute                     | Flex Consumption, Node.js 22, 512 MB, scale to zero | Same                               |
| Frontend/storage            | Free Static Web Apps; Standard LRS private blobs    | Same                               |
| Bedrock source              | `aws.region: eu-west-2` in example                  | eu-west-2                          |
| Model                       | Nova Micro example                                  | Global GPT-6 Sol inference profile |
| Login                       | Single-tenant Entra PKCE and API scope              | Same                               |

The current GPT-6 Sol agreement is active, but inference remains denied by AWS account eligibility. Infrastructure, deployment and public HTTP checks passed; the AI feature is not yet validated as working. See the dated [validation record](../../docs/validation.md).

There is one selected resource/source region per cloud. Global inference can route elsewhere. Free hosting and consumption pricing do not guarantee free operation: storage, internet transfer, inference and usage beyond grants can incur charges. The optional Azure group and AWS account alerts use the configured amount in their respective currencies; neither is a cap. The AWS alert covers account spending beyond this project too.

## Configure

For a new installation, copy [combo.dev.example.json](../environments/combo.dev.example.json) and edit it using the [shared workflow](../README.md#configure-and-deploy). Retain existing configuration and state for updates.

- Top-level `region` selects the Azure backend; `aws.region` selects Bedrock/STS independently.
- Both `azure` and `aws` account sections are required; Foundry model settings are ignored.
- Keep `azure.budget_start_date` stable. Additional frontend origins belong in `azure.extra_origins`.
- Leave `aws.existing_oidc_provider_arn` empty unless deliberately reusing a provider managed elsewhere.

The caller needs Azure/Entra resource and role-assignment permissions plus AWS IAM and optional budget permissions. Federation requires directory permission to assign an application role to the managed identity. Runtime identities receive storage/model invocation permissions, not model-subscription privileges.

Combo plan/apply checks Flex Consumption and the resource-provider region lists. For an existing resource group it also performs provider-level ARM validation of identity, storage, FC1 plan and Free static-app resources. For a new group, final subscription eligibility is determined when Azure provisions resources. Capacity and policy can change after validation. [Microsoft describes the West Europe restriction](https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-region-access-policy).

`azure.resource_group_region` is only needed when deliberately retaining an existing group's metadata location during recovery. Omit it for a clean installation so the group follows `region`. Moving the metadata location can replace the group; changing workload locations can replace those resources too. Follow the shared recovery procedure and inspect the plan rather than bypassing the target guard.

## Bedrock model access

There are separate readiness gates: IAM permission, model agreement/entitlement, regional availability, account-specific eligibility and usable quota. A successful apply, an active inference profile, an IAM simulation or even all availability fields reporting `AVAILABLE` does not prove actual inference access. AWS may require [additional account-level approval](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

For GPT-6 Sol, Bedrock Runtime uses a cross-region profile; the bare regional foundation-model ID is not valid for this path. Retrieve the actual profile and model resources:

```powershell
aws bedrock get-inference-profile --region eu-west-2 --inference-profile-identifier global.openai.gpt-6-sol --query '{profileArn:inferenceProfileArn,modelArns:models[].modelArn,status:status}' --output json
aws bedrock get-foundation-model-availability --region eu-west-2 --model-id openai.gpt-6-sol --output json
```

Set `aws.model_id` to the returned full profile ARN and `aws.extra_model_arns` to all returned foundation-model ARNs. The profile must match the configured account/source region. Preserve exact region-agnostic values such as `arn:aws:bedrock:::foundation-model/openai.gpt-6-sol`; do not insert a region or wildcard. Review profile routing and organizational region policies when it changes.

The target adds the exact account/source-region `project/default` invocation resource for numbered OpenAI GPT models. Project ARNs do not belong in `extra_model_arns`. Detection also examines destination ARNs for opaque application profiles. GPT requests omit temperature and use low reasoning effort; regional GPT OSS models retain their separate behavior. See [AWS model documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html) for current capabilities and rates.

Model agreements are an operator step that can accept provider terms and enable billing. They are not automatically accepted by Terraform or publishing. Once prerequisites are satisfied, authorize a small fictional test using the same runtime identity/path; an administrator's successful model call alone would not prove federation works. If AWS says the model is unavailable to the account, request access through AWS rather than broadening the runtime role or rebuilding resources.

## Federation and OIDC reuse

The dedicated Entra federation registration emits v1 app-only tokens. Its application role is assigned to the Function's managed identity. AWS trusts the tenant's `sts.windows.net` issuer, exact audience and identity principal as subject. The browser/API registration separately uses v2 delegated tokens. The [AWS federation pattern](https://aws.amazon.com/blogs/security/how-to-access-aws-resources-from-microsoft-entra-id-tenants-using-aws-security-token-service/) explains this exchange.

The credential provider uses Azure managed identity, coalesces concurrent refreshes, caches temporary STS credentials and refreshes five minutes before expiry. Tokens and credentials remain server-side; neither appears in frontend configuration.

AWS allows only one IAM OIDC provider for an issuer URL per account. To find an existing one:

```powershell
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output table
```

Match the tenant issuer, then inspect it using `aws iam get-open-id-connect-provider --open-id-connect-provider-arn YOUR-ARN`. Reuse requires its owner to add this installation's `api://<federation-client-id>` audience. The audience is available as `deployment.federation_audience` after apply. A first setup against an externally owned provider may need staged registration creation before the owner can add that audience. Never give two Terraform states ownership of the same provider. If this target already owns the provider, keep the reuse field empty.

## Storage and publication

Azure creates `blobServices/default` with the storage account. This target updates it using `azapi_update_resource.blobs`; no manual import is required on a fresh deployment. Older installations that tracked that child under `azapi_resource.blobs` need an explicit state transition before adopting the new type.

Private records and Function packages use separate containers in one account. Seven-day soft deletion and the account lock are enabled; versioning is disabled. These are not complete backup/overwrite-recovery controls.

After apply, the publisher builds the Entra/Blob/Bedrock Function package, uploads its ZIP and deploys the static frontend with public runtime configuration. It uses pinned SWA CLI and a process-local deployment token. It does not provision a Foundry agent or invoke a model. Retry failed publication with `deploy:publish` rather than recreating infrastructure.

## Verification and troubleshooting

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
```

The public check verifies runtime configuration and HTTP 401 for anonymous API calls. With a locally set `AZURE_SMOKE_ACCESS_TOKEN`, the script creates/updates/exports/deletes a fictional record. `--tailor` additionally makes one billable model request. Clear the token afterwards. Test a second user's isolation and browser sign-in/sign-out separately.

| Symptom                       | Check                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| API 401                       | Tenant, audience, calling client, delegated scope and token expiry                                |
| Credential/federation failure | Managed identity assignment, federation app role, v1 issuer, exact audience/subject and STS trust |
| Bedrock 503/access denied     | Provider agreement, account eligibility, actual model resources and organizational restrictions   |
| AI 429                        | Model quota, throttling and concurrency; avoid repeated generation clicks                         |
| AI 504                        | Model/input latency and deadline; a timed-out request may still be billed                         |
| Storage 403                   | Identity role at the correct account scope and permission propagation                             |
| Existing blob-service error   | Confirm use of the update resource; reconcile any older state ownership                           |
| Region/target mismatch        | Inspect configuration and existing state; use reviewed migration, not state deletion              |

Use the [shared teardown procedure](../README.md#teardown) for removal. Storage and browser identity protections remain enabled. Check shared OIDC consumers and global Entra/AWS resources as well as the Azure resource group.
