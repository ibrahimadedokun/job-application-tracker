# Validation and operational readiness

Last observed: **17 November 2026**. This record distinguishes local checks, live infrastructure/public checks and the unresolved model-access boundary. It is not an availability or security certification.

## Observed results

| Area                                | Evidence                                                                                                          | Limit                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Application/adapters/configuration  | 29 Node.js tests passed                                                                                           | Mock clients do not prove live provider behavior                       |
| Terraform                           | All three roots validated; AWS two, Azure one and combo seven native mock test runs passed                        | No resources are created by mock tests                                 |
| Build/package                       | Production frontend, AWS bundle, Azure package and combo package checks passed                                    | A valid package can still encounter cloud/runtime access restrictions  |
| Static checks                       | Repository/Terraform formatting passed; combo PowerShell syntax checked                                           | No new vulnerability-audit result is asserted here                     |
| Combo infrastructure                | Clean rebuild completed with all regional Azure resources in East US 2; Bedrock source eu-west-2                  | AWS-only/Azure-only were not live-deployed in this verification        |
| Publication                         | Function ZIP and production static site published                                                                 | Does not prove every authenticated feature                             |
| Storage                             | Seven-day blob/container soft deletion, versioning disabled, lock and managed-identity role verified/restored     | No restore drill or geographic recovery test                           |
| Public HTTP                         | Frontend config passed; anonymous API returned 401; browser CORS preflight returned 204 for the configured origin | Not an authenticated CRUD or isolation test                            |
| Final infrastructure reconciliation | Terraform reported no changes after storage-role/lock reconciliation                                              | Observation at that point, not a perpetual drift guarantee             |
| GPT-6 Sol                           | Agreement activated with approval; availability fields reported available                                         | A bounded synthetic inference request still returned account-level 403 |

The browser suite is configured in CI and its command is in the [root README](../README.md#development-checks). It was not rerun for this documentation update; local browser simulations do not establish deployed Entra consent or production user isolation.

## Current AI blocker

The authorized synthetic request to `global.openai.gpt-6-sol` through eu-west-2 returned:

> openai.gpt-6-sol is not available for this account.

The model agreement, entitlement, authorization and region fields all reported `AVAILABLE`; IAM simulation reported invocation allowed. AWS request ID: `3e260d42-e1e1-4588-9fc0-9d29d6f32c10`. No generated output was returned. AWS documents that some models require [additional account-level access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html). The operator must resolve eligibility with AWS and then test the application runtime path. Do not present infrastructure readiness as successful AI validation.

## Remaining acceptance checks

| Check                     | Completion criterion                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Entra login/consent       | Correct tenant and callback; API receives a delegated access token; sign-out and expiry clear the UI                 |
| Authenticated CRUD/export | Fictional record survives refresh, updates correctly, exports and is removed after testing                           |
| User isolation            | Two distinct users cannot list/read/update/delete each other's records                                               |
| Runtime model access      | A consented fictional tailoring request succeeds through the Function's federated identity and saves a valid version |
| Failure behavior          | Invalid output, timeouts, stale revisions and model denial never save a generated version                            |
| Recovery                  | Export and restore a fixture; verify retention, identity ownership and restored access controls                      |
| Operations                | Verify budget delivery, actual usage, model quota and a documented alert/incident path                               |

Use the [deployment live checklist](../infra/README.md#verify-and-operate) and [combo smoke procedure](../infra/combo/README.md#verification-and-troubleshooting). Tokens must remain local. No customer documents are needed for acceptance testing. A model test is billable and requires authorization; repeating a denied request is not a substitute for resolving account eligibility.
