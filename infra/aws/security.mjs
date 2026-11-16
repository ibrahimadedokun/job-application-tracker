// Shared with the production preview so browser tests exercise the deployed CSP.
export const contentSecurityPolicy =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://*.amazoncognito.com";
