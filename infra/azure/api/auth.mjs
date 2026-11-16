import { createRemoteJWKSet, jwtVerify } from "jose";

export function createAuthenticate({
  tenantId = process.env.ENTRA_TENANT_ID,
  clientId = process.env.ENTRA_CLIENT_ID,
  keySet,
} = {}) {
  if (
    ![tenantId, clientId].every((value) => /^[0-9a-f-]{36}$/i.test(value || ""))
  )
    throw new Error("Set ENTRA_TENANT_ID and ENTRA_CLIENT_ID to valid IDs.");
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const keys =
    keySet ||
    createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      ),
    );
  return async (authorization) => {
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "oid", "tid", "scp", "azp"],
      });
      if (
        payload.tid !== tenantId ||
        payload.azp !== clientId ||
        !payload.scp.split(" ").includes("access_as_user") ||
        typeof payload.oid !== "string"
      )
        return null;
      return `${payload.tid}:${payload.oid}`;
    } catch {
      return null;
    }
  };
}
