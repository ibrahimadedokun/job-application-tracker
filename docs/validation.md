# Validation status

Reviewed 19 November 2026. Local checks validate application behavior and deployment packages; live checks establish only the paths actually exercised.

## Repository checks

The 19 November cleanup passed all 34 application tests, four browser tests, all three Terraform roots and their mock tests, and all deployment package checks. Formatting and local import/link checks passed; the production dependency audit reported no vulnerabilities. Both Azure publisher branches were also exercised with external commands stubbed, without deploying resources.

| Check                       | Command                                   | Coverage                                                                                                              |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Application tests           | `npm test`                                | Validation, consent, user isolation, conditional writes, provider adapters and invalid-output recovery                |
| Frontend build              | `npm run build`                           | Production browser bundle                                                                                             |
| Infrastructure and packages | `npm run infra:check`                     | Three Terraform roots with mock providers; AWS, Azure and combo packages                                              |
| Browser workflow            | `npm run test:e2e`                        | CRUD, file extraction, tailoring preview, downloads, mobile layout, session expiry and Entra login/logout simulations |
| Formatting                  | `npm run format:check`                    | Repository formatting; Terraform formatting is included in infrastructure checks                                      |
| Dependency audit            | `npm audit --omit=dev --audit-level=high` | Known production dependency advisories                                                                                |

CI runs these checks on pull requests and pushes to `main`. Browser tests use fictional data and demo generation. Mocked providers and local authentication simulations do not prove production access or isolation.

## Live observations

The combo installation uses Azure East US 2 and Bedrock source region eu-west-2. Infrastructure, frontend configuration, anonymous API rejection and configured-origin CORS checks passed during the 17–19 November verification. Other deployment targets have not received equivalent live acceptance testing.

Claude Haiku 4.5 returned schema-valid documents using operator AWS credentials, including a multi-page fictional CV with no source cover letter. A separate test verified that the model accepts the corrective prompt after an invalid initial fixture. These tests establish the operator-to-model path, not the deployed Function's federated identity.

The backend update published on 19 November adds at most one corrective request for invalid completed responses, within the original deadline. Azure reported a successful deployment; subsequent public configuration, anonymous API rejection (401) and CORS preflight (204) checks passed. The exact original invalid response could not be diagnosed because the earlier adapter did not record the failed validation rule.

## Remaining acceptance checks

| Check                         | Completion criterion                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sign-in and session lifecycle | Correct tenant/callback, delegated API access, sign-out and expiry clearing the workspace              |
| CRUD and isolation            | Fictional records survive refresh and export; two users cannot access each other's records             |
| Runtime model access          | A fictional CV-only tailoring request succeeds through the deployed Function and saves a valid version |
| Failure handling              | Invalid output, timeouts, access denial and stale revisions leave no generated version                 |
| Recovery                      | Export/restore a fixture and verify ownership, access controls and retention                           |
| Operations                    | Verify budget delivery, actual usage, quota and a documented incident response path                    |

Use the [deployment checklist](../infra/README.md#verify-and-operate) and [combo smoke procedure](../infra/combo/README.md#verification-and-troubleshooting). Keep access tokens local and use fictional documents. Authenticated live acceptance remains outstanding.
