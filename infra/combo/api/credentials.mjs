import { ManagedIdentityCredential } from "@azure/identity";
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from "@aws-sdk/client-sts";

export function createFederatedCredentials({
  identity = new ManagedIdentityCredential({
    clientId: process.env.AZURE_CLIENT_ID,
  }),
  sts = new STSClient({ region: process.env.AWS_REGION, maxAttempts: 1 }),
  roleArn = process.env.AWS_ROLE_ARN,
  scope = process.env.AWS_TOKEN_SCOPE,
  now = Date.now,
} = {}) {
  if (!roleArn || !scope)
    throw new Error("AWS federation role and token scope are required.");
  let cached;
  let pending;
  return async () => {
    if (cached && cached.expiration.getTime() - now() > 300000) return cached;
    if (!pending) {
      pending = (async () => {
        const token = await identity.getToken(scope, {
          abortSignal: AbortSignal.timeout(10000),
        });
        if (!token?.token)
          throw new Error("Managed identity returned no federation token.");
        const { Credentials: credentials } = await sts.send(
          new AssumeRoleWithWebIdentityCommand({
            RoleArn: roleArn,
            RoleSessionName: "folio-combo",
            WebIdentityToken: token.token,
            DurationSeconds: 3600,
          }),
          { abortSignal: AbortSignal.timeout(10000) },
        );
        if (
          !credentials?.AccessKeyId ||
          !credentials.SecretAccessKey ||
          !credentials.SessionToken ||
          !credentials.Expiration
        )
          throw new Error("AWS STS returned incomplete temporary credentials.");
        cached = {
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.SecretAccessKey,
          sessionToken: credentials.SessionToken,
          expiration: new Date(credentials.Expiration),
        };
        return cached;
      })().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  };
}
