mock_provider "aws" {}
mock_provider "archive" {}

variables {
  account_id         = "123456789012"
  model_id           = "test.model-v1"
  lambda_bundle_path = "unused-test-bundle.mjs"
}
run "secure_serverless_defaults" {
  command = plan
  assert {
    condition     = aws_dynamodb_table.applications.billing_mode == "PAY_PER_REQUEST" && aws_dynamodb_table.applications.server_side_encryption[0].enabled && aws_dynamodb_table.applications.point_in_time_recovery[0].enabled && aws_dynamodb_table.applications.deletion_protection_enabled
    error_message = "Records require on-demand billing, encryption, recovery and deletion protection."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.web.block_public_acls && aws_s3_bucket_public_access_block.web.block_public_policy && aws_s3_bucket_public_access_block.web.restrict_public_buckets && aws_s3_bucket_public_access_block.web.ignore_public_acls
    error_message = "The web bucket must remain private."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.web.signing_behavior == "always" && aws_cloudfront_distribution.web.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "CloudFront must sign origin requests and enforce HTTPS."
  }
  assert {
    condition     = aws_apigatewayv2_route.api.authorization_type == "JWT" && contains(aws_apigatewayv2_route.api.authorization_scopes, "openid") && aws_apigatewayv2_integration.api.timeout_milliseconds == 29000
    error_message = "API requests require access-token scope validation and a bounded integration deadline."
  }
  assert {
    condition     = aws_lambda_function.api.timeout == 30 && aws_lambda_function.api.reserved_concurrent_executions == 5 && aws_cognito_user_pool_client.browser.generate_secret == false && aws_cognito_user_pool.users.deletion_protection == "ACTIVE"
    error_message = "Keep runtime cost bounds, a public browser client and identity protection."
  }
  assert {
    condition     = alltrue([for arn in local.model_resources : !strcontains(arn, "*")])
    error_message = "AI permissions must not contain wildcard model resources."
  }
}
run "reject_wildcard_model" {
  command = plan
  variables { model_id = "*" }
  expect_failures = [var.model_id]
}
