import { createHash } from "node:crypto";

// Validate the actual names and tiers without creating temporary cloud resources.
export function regionValidationTemplate(config) {
  const prefix = `${config.name}-${config.environment}-combo`;
  const suffix = createHash("sha256")
    .update(`${config.azure.subscription_id}/${prefix}/combo`)
    .digest("hex")
    .slice(0, 12);
  const resource = (type, apiVersion, name, location, properties = {}) => ({
    type,
    apiVersion,
    name,
    location,
    ...properties,
  });
  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    resources: [
      resource(
        "Microsoft.ManagedIdentity/userAssignedIdentities",
        "2023-01-31",
        `${prefix}-api-identity`,
        config.region,
      ),
      resource(
        "Microsoft.Storage/storageAccounts",
        "2023-05-01",
        `folio${suffix}`,
        config.region,
        {
          kind: "StorageV2",
          sku: { name: "Standard_LRS" },
          properties: {
            allowBlobPublicAccess: false,
            allowSharedKeyAccess: false,
            supportsHttpsTrafficOnly: true,
            minimumTlsVersion: "TLS1_2",
          },
        },
      ),
      resource(
        "Microsoft.Web/serverfarms",
        "2024-04-01",
        `${prefix}-plan`,
        config.region,
        {
          kind: "functionapp",
          sku: { name: "FC1", tier: "FlexConsumption" },
          properties: { reserved: true },
        },
      ),
      resource(
        "Microsoft.Web/staticSites",
        "2023-12-01",
        `${prefix}-web-${suffix}`,
        config.azure.static_web_region || "eastus2",
        {
          sku: { name: "Free", tier: "Free" },
          properties: { allowConfigFileUpdates: true },
        },
      ),
    ],
  };
}
