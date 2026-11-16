import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { deploymentConfig } from "../infra/aws/config.mjs";

try {
  const config = deploymentConfig(process.env, { deployment: true });
  const identity = await new STSClient({ region: config.region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (identity.Account !== config.account)
    throw new Error(
      "AWS credentials belong to a different account than AWS_ACCOUNT_ID.",
    );
  console.log(
    `Deployment identity: ${identity.Arn}\nTarget: ${config.account}/${config.region}\nModel: ${config.model}`,
  );
} catch (error) {
  console.error(`Deployment preflight failed: ${error.message}`);
  process.exitCode = 1;
}
