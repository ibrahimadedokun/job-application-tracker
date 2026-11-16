import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const template = JSON.parse(
  readFileSync(
    `cdk.out/${process.env.STACK_NAME || "Folio"}.template.json`,
    "utf8",
  ),
);
const resources = Object.values(template.Resources);
const of = (type) =>
  resources.filter((r) => r.Type === type).map((r) => r.Properties);
const table = of("AWS::DynamoDB::Table")[0];
assert.equal(table.SSESpecification.SSEEnabled, true);
assert.equal(
  table.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled,
  true,
);
const route = of("AWS::ApiGatewayV2::Route")[0];
assert.equal(route.AuthorizationType, "JWT");
assert.ok(route.AuthorizerId);
assert.deepEqual(route.AuthorizationScopes, ["openid"]);
assert.equal(of("AWS::ApiGatewayV2::Integration")[0].TimeoutInMillis, 29000);
assert.ok(of("AWS::ApiGatewayV2::Stage")[0].AccessLogSettings.DestinationArn);
assert.equal(of("AWS::Cognito::UserPoolClient")[0].GenerateSecret, false);
const bucket = of("AWS::S3::Bucket")[0];
assert.ok(Object.values(bucket.PublicAccessBlockConfiguration).every(Boolean));
assert.ok(of("AWS::CloudFront::OriginAccessControl").length > 0);
const distribution = of("AWS::CloudFront::Distribution")[0].DistributionConfig;
assert.equal(
  distribution.DefaultCacheBehavior.ViewerProtocolPolicy,
  "redirect-to-https",
);
assert.ok(
  distribution.CacheBehaviors.some(
    (behavior) => behavior.PathPattern === "/assets/*",
  ),
);
assert.equal(
  of("AWS::Lambda::Function").find((f) => f.Environment?.Variables?.TABLE_NAME)
    .Timeout,
  30,
);
for (const resource of resources.filter((r) =>
  ["AWS::DynamoDB::Table", "AWS::Cognito::UserPool"].includes(r.Type),
)) {
  assert.equal(resource.DeletionPolicy, "Retain");
}
assert.equal(
  of("AWS::Lambda::Function").find((f) => f.Environment?.Variables?.TABLE_NAME)
    .ReservedConcurrentExecutions,
  5,
);
const statements = of("AWS::IAM::Policy").flatMap(
  (p) => p.PolicyDocument.Statement,
);
const model = statements.find((s) =>
  [].concat(s.Action).includes("bedrock:InvokeModel"),
);
assert.ok(model);
assert.ok(!JSON.stringify(model.Resource).includes("*"));
assert.ok(!JSON.stringify(template).includes("local-developer"));
console.log(
  "Infrastructure assertions passed: encryption, recovery, access-token scopes, timeouts, access logs, private origin, asset caching, retention, concurrency, scoped AI permissions.",
);
