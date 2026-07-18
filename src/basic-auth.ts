export interface BasicCredentials {
  username: string;
  password: string;
}

export function parseBasicAuth(header: string | undefined): BasicCredentials | null {
  if (header === undefined) {
    return null;
  }
  const [, token] = header.match(/^basic\s+(\S+)\s*$/i) ?? [];
  if (token === undefined) {
    return null;
  }
  const decoded = Buffer.from(token, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) {
    return null;
  }
  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}
