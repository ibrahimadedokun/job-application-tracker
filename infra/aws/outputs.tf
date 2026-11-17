output "deployment" {
  value = {
    cloud   = "aws"
    web_url = local.site
    runtime_config = {
      local     = false
      apiUrl    = aws_apigatewayv2_api.api.api_endpoint
      authority = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
      clientId  = aws_cognito_user_pool_client.browser.id
      logoutUrl = "https://${aws_cognito_user_pool_domain.login.domain}.auth.${var.region}.amazoncognito.com/logout"
    }
    release = {
      bucket          = aws_s3_bucket.web.id
      distribution_id = aws_cloudfront_distribution.web.id
      region          = var.region
    }
  }
}
