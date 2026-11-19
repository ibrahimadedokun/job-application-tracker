import { readFile } from "node:fs/promises";
import { z } from "zod";

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,15}$/);
const guid = z.string().uuid();
const awsRegion = z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/);
const configurationSchema = z
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
        region: awsRegion.optional(),
        existing_oidc_provider_arn: z.string().default(""),
        model_id: z.string().min(1),
        extra_model_arns: z.array(z.string()).default([]),
        cognito_domain_prefix: z
          .string()
          .regex(/^$|^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
          .default(""),
      })
      .optional(),
    azure: z
      .object({
        subscription_id: guid,
        tenant_id: guid,
        resource_group_region: z
          .string()
          .regex(/^[a-z][a-z0-9]+$/)
          .optional(),
        static_web_region: z
          .string()
          .regex(/^[a-z][a-z0-9]+$/)
          .optional(),
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
  if (config.cloud !== "azure") {
    const {
      model_id: model,
      account_id: account,
      extra_model_arns: models,
    } = config.aws;
    const region = awsRegion.parse(
      config.cloud === "combo" ? config.aws.region : config.region,
    );
    const modelArn =
      /^arn:aws(?:-us-gov|-cn)?:bedrock:[a-z0-9-]+:(?:\d{12})?:(?:foundation-model|inference-profile|application-inference-profile)\/[A-Za-z0-9._:-]+$/;
    const foundationModelArn =
      /^arn:aws(?:-us-gov|-cn)?:bedrock:(?:[a-z0-9-]+:(?:\d{12})?|:):foundation-model\/[A-Za-z0-9._:-]+$/;
    if (
      !(model.startsWith("arn:")
        ? modelArn.test(model)
        : /^[A-Za-z0-9._:-]+$/.test(model))
    )
      throw new Error(
        "aws.model_id must be an explicit model ID or Bedrock model/profile ARN without wildcards.",
      );
    if (models.some((arn) => !foundationModelArn.test(arn)))
      throw new Error(
        "aws.extra_model_arns must contain explicit foundation-model ARNs without wildcards.",
      );
    const profile = /:(?:application-)?inference-profile\//.test(model);
    if (profile && !models.length)
      throw new Error(
        "Inference profiles require destination foundation-model ARNs in aws.extra_model_arns.",
      );
    if (
      /^(?:us|eu|apac|global)\./.test(model) ||
      ([model, ...models].some((value) =>
        value.includes("anthropic.claude-haiku-4-5"),
      ) &&
        !profile)
    )
      throw new Error(
        "Use a full inference-profile ARN and destination model ARNs for cross-region models, including Claude Haiku 4.5.",
      );
    if (
      profile &&
      (model.split(":")[3] !== region || model.split(":")[4] !== account)
    )
      throw new Error(
        "The Bedrock inference profile must match the configured AWS account and source region.",
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
      resource_group_region: config.azure.resource_group_region ?? null,
      static_web_region: config.azure.static_web_region || "eastus2",
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
  const { resource_group_region, static_web_region, ...azure } =
    config.azure || {};
  return {
    name: config.name,
    environment: config.environment,
    region: config.region,
    budget_amount: config.budget.amount,
    budget_email: config.budget.email,
    ...(config.cloud === "aws" ? aws : azure),
    ...(config.cloud === "aws"
      ? { lambda_bundle_path: artifacts.replaceAll("\\", "/") + "/index.mjs" }
      : {}),
  };
}
