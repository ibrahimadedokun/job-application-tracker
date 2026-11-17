import { readFile } from "node:fs/promises";
import { z } from "zod";
import { deploymentConfig } from "./aws/config.mjs";

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,15}$/);
const guid = z.string().uuid();
export const configurationSchema = z
  .object({
    cloud: z.enum(["aws", "azure", "combo"]),
    environment: slug,
    name: slug.default("folio"),
    region: z.string().regex(/^[a-z][a-z0-9-]+$/),
    budget: z
      .object({
        amount: z.number().positive().default(10),
        email: z.union([z.email(), z.literal("")]).default(""),
      })
      .default({ amount: 10, email: "" }),
    aws: z
      .object({
        account_id: z.string().regex(/^\d{12}$/),
        region: z
          .string()
          .regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/)
          .optional(),
        existing_oidc_provider_arn: z.string().default(""),
        model_id: z.string().min(1),
        extra_model_arns: z.array(z.string()).default([]),
        cognito_domain_prefix: z.string().default(""),
      })
      .optional(),
    azure: z
      .object({
        subscription_id: guid,
        tenant_id: guid,
        foundry_region: z.string().default("swedencentral"),
        model_id: z.string().default("gpt-4.1-nano"),
        model_version: z.string().default("2025-04-14"),
        model_sku: z
          .enum(["GlobalStandard", "Standard", "DataZoneStandard"])
          .default("GlobalStandard"),
        model_capacity: z.number().int().positive().default(10),
        budget_start_date: z.string().regex(/^\d{4}-\d{2}-01T00:00:00Z$/),
        extra_origins: z
          .array(
            z.url().refine((value) => {
              const url = new URL(value);
              return url.protocol === "https:" && url.origin === value;
            }, "Use an HTTPS origin without a trailing slash."),
          )
          .default([]),
      })
      .optional(),
    backend: z
      .object({
        type: z.enum(["local", "s3", "azurerm"]).default("local"),
        config: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .default({}),
      })
      .default({ type: "local", config: {} }),
  })
  .strict()
  .superRefine((config, context) => {
    for (const cloud of config.cloud === "combo"
      ? ["azure", "aws"]
      : [config.cloud]) {
      if (!config[cloud])
        context.addIssue({
          code: "custom",
          message: `Configure the ${cloud} section.`,
          path: [cloud],
        });
    }
    if (config.cloud === "combo" && !config.aws?.region)
      context.addIssue({
        code: "custom",
        message:
          "Configure the Bedrock AWS region separately from the Azure hosting region.",
        path: ["aws", "region"],
      });
  });

export function parseConfiguration(input) {
  const config = configurationSchema.parse(input);
  if (["aws", "combo"].includes(config.cloud))
    deploymentConfig(
      {
        AWS_ACCOUNT_ID: config.aws.account_id,
        AWS_REGION:
          config.cloud === "combo" ? config.aws.region : config.region,
        BEDROCK_MODEL_ID: config.aws.model_id,
        BEDROCK_EXTRA_MODEL_ARNS: config.aws.extra_model_arns.join(","),
        COGNITO_DOMAIN_PREFIX: config.aws.cognito_domain_prefix,
      },
      { deployment: true },
    );
  if (config.cloud === "combo") {
    const {
      model_id: model,
      extra_model_arns: extra,
      account_id: account,
      region,
    } = config.aws;
    const profile = /:(?:application-)?inference-profile\//.test(model);
    const openaiGpt = [model, ...extra].some((value) =>
      /(?:^|[/.])openai\.gpt-[0-9]/.test(value),
    );
    if (openaiGpt && !profile)
      throw new Error(
        "OpenAI GPT on Bedrock Runtime requires a full cross-region inference-profile ARN and destination model ARNs.",
      );
    if (profile && !model.startsWith(`arn:aws:bedrock:${region}:${account}:`))
      throw new Error(
        "The Bedrock inference profile must match aws.account_id and aws.region.",
      );
  }
  return config;
}
export async function readConfiguration(file) {
  return parseConfiguration(JSON.parse(await readFile(file, "utf8")));
}
export function terraformVariables(config, artifacts) {
  if (config.cloud === "combo")
    return {
      name: config.name,
      environment: config.environment,
      region: config.region,
      budget_amount: config.budget.amount,
      budget_email: config.budget.email,
      subscription_id: config.azure.subscription_id,
      tenant_id: config.azure.tenant_id,
      budget_start_date: config.azure.budget_start_date,
      extra_origins: config.azure.extra_origins,
      account_id: config.aws.account_id,
      aws_region: config.aws.region,
      model_id: config.aws.model_id,
      extra_model_arns: config.aws.extra_model_arns,
      existing_oidc_provider_arn: config.aws.existing_oidc_provider_arn,
    };
  const {
    region: awsRegion,
    existing_oidc_provider_arn,
    ...aws
  } = config.aws || {};
  return {
    name: config.name,
    environment: config.environment,
    region: config.region,
    budget_amount: config.budget.amount,
    budget_email: config.budget.email,
    ...(config.cloud === "aws" ? aws : config.azure),
    ...(config.cloud === "aws"
      ? { lambda_bundle_path: artifacts.replaceAll("\\", "/") + "/index.mjs" }
      : {}),
  };
}
