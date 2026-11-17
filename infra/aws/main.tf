locals {
  prefix          = "${var.name}-${var.environment}"
  site            = "https://${aws_cloudfront_distribution.web.domain_name}"
  model_resources = concat([startswith(var.model_id, "arn:") ? var.model_id : "arn:aws:bedrock:${var.region}::foundation-model/${var.model_id}"], var.extra_model_arns)
  csp             = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://*.amazoncognito.com"
}
resource "aws_dynamodb_table" "applications" {
  name         = "${local.prefix}-applications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  server_side_encryption { enabled = true }
  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "web" {
  bucket_prefix = "${local.prefix}-web-"
}
resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${local.prefix}-security"
  security_headers_config {
    content_security_policy {
      content_security_policy = local.csp
      override                = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }
}
resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }
  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = "413f1606-6f3b-4c2f-b7d5-85e090237d6d"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.web.arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } } },
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.web.arn, "${aws_s3_bucket.web.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_cognito_user_pool" "users" {
  name                     = local.prefix
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"
  software_token_mfa_configuration { enabled = true }
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  deletion_protection = "ACTIVE"
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_user_pool_domain" "login" {
  user_pool_id = aws_cognito_user_pool.users.id
  domain       = var.cognito_domain_prefix != "" ? var.cognito_domain_prefix : "${local.prefix}-${var.account_id}-${var.region}"
}
resource "aws_cognito_user_pool_client" "browser" {
  name                                 = "${local.prefix}-browser"
  user_pool_id                         = aws_cognito_user_pool.users.id
  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${local.site}/"]
  logout_urls                          = ["${local.site}/"]
  access_token_validity                = 30
  id_token_validity                    = 30
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
data "archive_file" "api" {
  type        = "zip"
  source_file = var.lambda_bundle_path
  output_path = "${dirname(var.lambda_bundle_path)}/api.zip"
}
resource "aws_iam_role" "api" {
  name               = "${local.prefix}-api"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.prefix}-api"
  retention_in_days = 7
}
resource "aws_cloudwatch_log_group" "http" {
  name              = "/folio/${local.prefix}/http"
  retention_in_days = 7
}
resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api.arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"], Resource = aws_dynamodb_table.applications.arn },
    { Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = local.model_resources }
  ] })
  lifecycle {
    precondition {
      condition     = !strcontains(var.model_id, "inference-profile/") || length(var.extra_model_arns) > 0
      error_message = "Inference profiles require explicit destination foundation-model ARNs."
    }
  }
}
resource "aws_lambda_function" "api" {
  function_name                  = "${local.prefix}-api"
  role                           = aws_iam_role.api.arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = data.archive_file.api.output_path
  source_code_hash               = data.archive_file.api.output_base64sha256
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 5
  environment { variables = { TABLE_NAME = aws_dynamodb_table.applications.name, BEDROCK_MODEL_ID = var.model_id } }
  depends_on = [aws_iam_role_policy.api]
}
resource "aws_apigatewayv2_api" "api" {
  name          = local.prefix
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = [local.site]
    allow_headers = ["authorization", "content-type"]
    allow_methods = ["GET", "POST", "PATCH", "DELETE"]
    max_age       = 3600
  }
}
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.browser.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "api" {
  api_id               = aws_apigatewayv2_api.api.id
  route_key            = "ANY /api/{proxy+}"
  target               = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.jwt.id
  authorization_scopes = ["openid"]
}
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.http.arn
    format          = jsonencode({ requestId = "$context.requestId", routeKey = "$context.routeKey", status = "$context.status", integrationLatency = "$context.integrationLatency", responseLength = "$context.responseLength" })
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
resource "aws_budgets_budget" "monthly" {
  count        = var.budget_email == "" ? 0 : 1
  name         = "${local.prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
