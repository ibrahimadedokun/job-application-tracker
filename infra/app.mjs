#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as deploy from "aws-cdk-lib/aws-s3-deployment";
import * as logs from "aws-cdk-lib/aws-logs";
import * as budgets from "aws-cdk-lib/aws-budgets";
if (process.env.AWS_ACCOUNT_ID && !/^\d{12}$/.test(process.env.AWS_ACCOUNT_ID))
  throw new Error("AWS_ACCOUNT_ID must be your 12-digit AWS account ID.");
const app = new cdk.App();
const region = process.env.AWS_REGION || "eu-west-2";
const stack = new cdk.Stack(app, process.env.STACK_NAME || "Folio", {
  env: {
    account: process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  description:
    "Folio private application tracker; serverless, no idle compute.",
});
const table = new dynamodb.Table(stack, "Applications", {
  partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
const bucket = new s3.Bucket(stack, "Web", {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
const headers = new cloudfront.ResponseHeadersPolicy(stack, "SecurityHeaders", {
  securityHeadersBehavior: {
    contentSecurityPolicy: {
      contentSecurityPolicy:
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://*.amazoncognito.com",
      override: true,
    },
    strictTransportSecurity: {
      accessControlMaxAge: cdk.Duration.days(365),
      includeSubdomains: true,
      override: true,
    },
    contentTypeOptions: { override: true },
    referrerPolicy: {
      referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
      override: true,
    },
    frameOptions: {
      frameOption: cloudfront.HeadersFrameOption.DENY,
      override: true,
    },
  },
});
const distribution = new cloudfront.Distribution(stack, "CDN", {
  defaultRootObject: "index.html",
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    responseHeadersPolicy: headers,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
  },
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 200,
      responsePagePath: "/index.html",
      ttl: cdk.Duration.seconds(0),
    },
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: "/index.html",
      ttl: cdk.Duration.seconds(0),
    },
  ],
});
const site = `https://${distribution.distributionDomainName}`;
const pool = new cognito.UserPool(stack, "Users", {
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: { email: true },
  passwordPolicy: {
    minLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: true,
  },
  mfa: cognito.Mfa.OPTIONAL,
  mfaSecondFactor: { sms: false, otp: true },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
const domain = pool.addDomain("Login", {
  cognitoDomain: {
    domainPrefix:
      process.env.COGNITO_DOMAIN_PREFIX || `folio-${stack.account}-${region}`,
  },
});
const client = pool.addClient("Browser", {
  generateSecret: false,
  preventUserExistenceErrors: true,
  authFlows: { userSrp: true },
  oAuth: {
    flows: { authorizationCodeGrant: true },
    scopes: [
      cognito.OAuthScope.OPENID,
      cognito.OAuthScope.EMAIL,
      cognito.OAuthScope.PROFILE,
    ],
    callbackUrls: [site + "/"],
    logoutUrls: [site + "/"],
  },
  accessTokenValidity: cdk.Duration.minutes(30),
  idTokenValidity: cdk.Duration.minutes(30),
  refreshTokenValidity: cdk.Duration.days(1),
});
const model =
  process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";
const fn = new nodejs.NodejsFunction(stack, "Api", {
  entry: "server/api.mjs",
  handler: "handler",
  runtime: lambda.Runtime.NODEJS_22_X,
  memorySize: 512,
  timeout: cdk.Duration.seconds(60),
  reservedConcurrentExecutions: 5,
  logGroup: new logs.LogGroup(stack, "ApiLogs", {
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  }),
  environment: { TABLE_NAME: table.tableName, BEDROCK_MODEL_ID: model },
  bundling: {
    format: nodejs.OutputFormat.ESM,
    target: "node22",
    banner:
      "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    externalModules: [],
  },
});
table.grantReadWriteData(fn);
const modelResources = model.startsWith("arn:")
  ? [model]
  : [`arn:aws:bedrock:${region}::foundation-model/${model}`];
// Cross-region inference profiles need explicitly provided destination model ARNs.
const extra = (process.env.BEDROCK_EXTRA_MODEL_ARNS || "")
  .split(",")
  .filter(Boolean);
fn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["bedrock:InvokeModel"],
    resources: [...modelResources, ...extra],
  }),
);
const api = new apigateway.HttpApi(stack, "HttpApi", {
  corsPreflight: {
    allowOrigins: [site],
    allowHeaders: ["authorization", "content-type"],
    allowMethods: [
      apigateway.CorsHttpMethod.GET,
      apigateway.CorsHttpMethod.POST,
      apigateway.CorsHttpMethod.PATCH,
      apigateway.CorsHttpMethod.DELETE,
    ],
    maxAge: cdk.Duration.hours(1),
  },
});
const stage = api.defaultStage.node.defaultChild;
stage.defaultRouteSettings = {
  throttlingBurstLimit: 10,
  throttlingRateLimit: 5,
};
api.addRoutes({
  path: "/api/{proxy+}",
  methods: [apigateway.HttpMethod.ANY],
  integration: new HttpLambdaIntegration("Handler", fn),
  authorizer: new HttpUserPoolAuthorizer("JWT", pool, {
    userPoolClients: [client],
    identitySource: ["$request.header.Authorization"],
  }),
});
new deploy.BucketDeployment(stack, "PublishWeb", {
  destinationBucket: bucket,
  sources: [
    deploy.Source.asset("dist"),
    deploy.Source.jsonData("config.json", {
      apiUrl: api.apiEndpoint,
      authority: `https://cognito-idp.${region}.amazonaws.com/${pool.userPoolId}`,
      clientId: client.userPoolClientId,
      logoutUrl: domain.baseUrl() + "/logout",
      local: false,
    }),
  ],
  distribution,
  distributionPaths: ["/*"],
  memoryLimit: 256,
});
if (process.env.BUDGET_EMAIL)
  new budgets.CfnBudget(stack, "MonthlyBudget", {
    budget: {
      budgetName: `${stack.stackName}-monthly`,
      budgetType: "COST",
      timeUnit: "MONTHLY",
      budgetLimit: {
        amount: Number(process.env.MONTHLY_BUDGET_USD || 10),
        unit: "USD",
      },
    },
    notificationsWithSubscribers: [
      {
        notification: {
          comparisonOperator: "GREATER_THAN",
          notificationType: "ACTUAL",
          threshold: 80,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [
          { address: process.env.BUDGET_EMAIL, subscriptionType: "EMAIL" },
        ],
      },
    ],
  });
new cdk.CfnOutput(stack, "AppUrl", { value: site });
new cdk.CfnOutput(stack, "ApiUrl", { value: api.apiEndpoint });
new cdk.CfnOutput(stack, "LoginUrl", { value: domain.baseUrl() });
new cdk.CfnOutput(stack, "UserPoolId", { value: pool.userPoolId });
new cdk.CfnOutput(stack, "TableName", { value: table.tableName });
