export function deploymentConfig(
  env = process.env,
  { deployment = false } = {},
) {
  const account = env.AWS_ACCOUNT_ID;
  const region = env.AWS_REGION || "eu-west-2";
  const model = env.BEDROCK_MODEL_ID?.trim();
  const extraModelArns = (env.BEDROCK_EXTRA_MODEL_ARNS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (account && !/^\d{12}$/.test(account))
    throw new Error("AWS_ACCOUNT_ID must be your 12-digit AWS account ID.");
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region))
    throw new Error("AWS_REGION must be an AWS region name.");
  if (deployment && !account)
    throw new Error("Set AWS_ACCOUNT_ID before deployment.");
  if (deployment && !model)
    throw new Error(
      "Set BEDROCK_MODEL_ID to an enabled Converse model before deployment.",
    );
  const modelArn =
    /^arn:aws(?:-us-gov|-cn)?:bedrock:[a-z0-9-]+:(?:\d{12})?:(?:foundation-model|inference-profile|application-inference-profile)\/[A-Za-z0-9._:/-]+$/;
  // Global cross-region profiles can return a region-agnostic foundation model.
  const globalModelArn =
    /^arn:aws:bedrock:::foundation-model\/[A-Za-z0-9._:-]+$/;
  if (
    model &&
    !(model.startsWith("arn:")
      ? modelArn.test(model)
      : /^[A-Za-z0-9._:-]+$/.test(model))
  )
    throw new Error(
      "BEDROCK_MODEL_ID must be a model ID or a Bedrock model/profile ARN without wildcards.",
    );
  if (
    extraModelArns.some(
      (arn) =>
        (!modelArn.test(arn) && !globalModelArn.test(arn)) ||
        !arn.includes(":foundation-model/"),
    )
  )
    throw new Error(
      "BEDROCK_EXTRA_MODEL_ARNS must contain explicit foundation-model ARNs without wildcards.",
    );
  if (model?.includes("inference-profile/") && extraModelArns.length === 0)
    throw new Error(
      "Inference profiles require BEDROCK_EXTRA_MODEL_ARNS for their destination foundation models.",
    );
  if (
    model &&
    !model.startsWith("arn:") &&
    /^(?:us|eu|apac|global)\./.test(model)
  )
    throw new Error(
      "Use the full inference profile ARN for BEDROCK_MODEL_ID, with destination BEDROCK_EXTRA_MODEL_ARNS.",
    );
  if (
    env.COGNITO_DOMAIN_PREFIX &&
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.COGNITO_DOMAIN_PREFIX)
  )
    throw new Error(
      "COGNITO_DOMAIN_PREFIX must be 1–63 lowercase letters, digits or interior hyphens.",
    );
  const budget = Number(env.MONTHLY_BUDGET_USD || 10);
  if (
    env.BUDGET_EMAIL &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BUDGET_EMAIL) ||
      !Number.isFinite(budget) ||
      budget <= 0)
  )
    throw new Error(
      "Budget alerts require a valid BUDGET_EMAIL and positive MONTHLY_BUDGET_USD.",
    );
  return {
    account,
    region,
    model: model || "anthropic.claude-3-haiku-20240307-v1:0",
    extraModelArns,
    budget,
  };
}
