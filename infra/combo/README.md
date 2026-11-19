# Azure hosting with AWS Bedrock

Azure hosts the frontend, API and private records. The Function invokes Bedrock using federated temporary AWS credentials. Follow the [shared deployment workflow](../README.md); see [architecture](../../docs/architecture.md) and [validation status](../../docs/validation.md) for implementation and live-check coverage.

## Defaults

| Setting               | Configuration                                       |
| --------------------- | --------------------------------------------------- |
| Azure backend/storage | East US 2 (`eastus2`)                               |
| Static-app region     | `azure.static_web_region: eastus2`                  |
| Compute               | Flex Consumption, Node.js 22, 512 MB, scale to zero |
| Frontend/storage      | Free Static Web Apps; private Standard LRS blobs    |
| Login                 | Single-tenant Entra, PKCE and delegated API scope   |
| Bedrock source        | `aws.region: eu-west-2`                             |
| Model                 | Claude Haiku 4.5 EU inference profile               |

## Configure

For a new installation, copy [combo.dev.example.json](../environments/combo.dev.example.json). Keep existing configuration and state when updating.

- Top-level `region` selects the Azure backend; `aws.region` selects Bedrock and STS independently.
- Both account sections are required. Foundry settings are unused for combo.
- Keep `azure.budget_start_date` stable; add frontend origins through `azure.extra_origins`.
- Leave `aws.existing_oidc_provider_arn` empty unless reusing an externally managed provider.
- Set `azure.resource_group_region` only when deliberately retaining an existing group's metadata location during recovery. Region changes can replace resources and require a reviewed plan.

Deployment requires Azure resource/RBAC permissions, Entra application and app-role assignment rights, and AWS IAM permissions. Runtime roles receive storage/model access, not model-subscription privileges.

Combo plan/apply checks supported service regions and, for existing resource groups, performs provider-level ARM validation. Final subscription eligibility and capacity are determined by Azure during provisioning.

## Bedrock model access

Model readiness requires account eligibility, activation, regional availability, IAM access and quota. Infrastructure provisioning and availability metadata do not prove successful inference. Complete Anthropic's first-time-use requirements and model activation before testing the runtime path.

Claude Haiku 4.5 uses a cross-region inference profile. Retrieve its actual resources:

```powershell
aws bedrock get-inference-profile --region eu-west-2 --inference-profile-identifier eu.anthropic.claude-haiku-4-5-20251001-v1:0 --query '{profileArn:inferenceProfileArn,modelArns:models[].modelArn,status:status}' --output json
aws bedrock get-foundation-model-availability --region eu-west-2 --model-id anthropic.claude-haiku-4-5-20251001-v1:0 --output json
```

Set `aws.model_id` to the full profile ARN and `aws.extra_model_arns` to every returned destination-model ARN. The profile must match the configured account/source region. Verify the example's destination list for your account and review cross-region processing requirements. IAM grants invocation only on these explicit resources.

## Prompt and response handling

The [career-editor prompt](../../server/core.mjs) is sent in Converse's `system` field, separately from untrusted job/document text. It requires factual drafts and JSON containing `cv`, `coverLetter`, `changes` and `missingKeywords`. Edit the source prompt and republish to change these instructions.

Haiku requests use a JSON Schema through `outputConfig.textFormat`; `BEDROCK_STRUCTURED_OUTPUT` also enables it for opaque application profiles. Application validation enforces document and metadata bounds. CV-only input generates a companion cover letter.

The adapter uses a 7,000-token ceiling, temperature 0.35 and a shared 55-second deadline. It makes at most one corrective call for invalid completed output, with at least five seconds remaining. Refusals, truncation, provider errors and timeouts are not retried. Invalid results are never saved. Validation warnings exclude document text and credentials.

The first use of a schema can exceed this deadline because Bedrock compiles its grammar. The corrective path does not extend the deadline or retry timeouts. See [AWS structured-output guidance](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

## Federation and OIDC reuse

A dedicated Entra registration emits v1 app-only tokens. Its application role is assigned to the Function's managed identity. AWS restricts trust to the tenant issuer, exact audience and managed identity subject. The browser registration separately uses v2 delegated tokens. The credential provider coalesces refreshes and caches temporary STS credentials server-side.

AWS permits one IAM OIDC provider per issuer URL in an account. Find an existing provider with:

```powershell
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output table
```

Inspect the matching provider using `aws iam get-open-id-connect-provider --open-id-connect-provider-arn YOUR-ARN`. Reuse requires its owner to add this installation's federation audience, exposed as `deployment.federation_audience`. A first setup may require staged registration creation before that audience can be added. Keep one Terraform owner for the provider; leave the reuse field empty if this target already owns it.

## Storage and publication

Records and Function packages use separate private containers. Seven-day soft deletion and the account lock are enabled; versioning is disabled. The template updates Azure's existing `blobServices/default` singleton through `azapi_update_resource.blobs`. An older state using `azapi_resource.blobs` needs an explicit state transition.

The shared Azure publisher builds and verifies the combo package, uploads the Function ZIP and publishes the static frontend. It does not provision a Foundry agent or invoke a model. Retry failed publication with `deploy:publish` using the same configuration and state.

Free hosting does not guarantee free operation. Storage, traffic and inference, including corrective calls, can incur charges. Optional Azure-group and AWS-account budget alerts are not spending caps.

## Verification and troubleshooting

```powershell
node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net
```

The public check verifies frontend configuration and anonymous API rejection. With `AZURE_SMOKE_ACCESS_TOKEN` set locally, it also checks fictional CRUD/export and deletes the fixture. `--tailor` requests billable document generation. Clear the token afterwards. Browser sign-in/out and two-user isolation need separate checks.

| Symptom                   | Check                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| API 401                   | Tenant, audience, calling client, delegated scope and expiry                  |
| Federation failure        | Managed identity assignment, app role, issuer, audience/subject and STS trust |
| Bedrock 503/access denied | Activation, account eligibility, model permissions and organization policies  |
| AI 429                    | Model quota and concurrency                                                   |
| AI 502 / invalid document | Safe validation warnings: request ID, JSON category or affected fields        |
| AI 504                    | Model/input latency and the shared deadline                                   |
| Storage 403               | Managed identity role and permission propagation                              |
| Target/region mismatch    | Existing configuration and state; use the shared recovery procedure           |

Use the [shared teardown procedure](../README.md#teardown) for removal. Review retained storage, identities and shared OIDC consumers before deleting resources.
