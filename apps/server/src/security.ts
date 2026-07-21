import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AdminCredentials = { username: string; password: string };
export type ResolvedAddress = { address: string; family: number };
export type HostnameResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultHostnameResolver: HostnameResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function safeEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

export function hasValidBasicCredentials(header: string | undefined, expected: AdminCredentials) {
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0
      && safeEqual(decoded.slice(0, separator), expected.username)
      && safeEqual(decoded.slice(separator + 1), expected.password);
  } catch {
    return false;
  }
}

function isUnsafeIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

function isUnsafeIpv6(address: string) {
  const normalized = (address.toLowerCase().split("%")[0] ?? "");
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isUnsafeIpv4(mapped) : false;
}

export function isUnsafeNetworkAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? isUnsafeIpv4(address) : family === 6 ? isUnsafeIpv6(address) : true;
}

export async function validateProviderBaseUrl(
  input: string,
  options: { resolveHostname?: HostnameResolver; allowHttp?: boolean } = {},
) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false as const, reason: "invalid_url" as const };
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:"))
    return { ok: false as const, reason: "https_required" as const };
  if (url.username || url.password)
    return { ok: false as const, reason: "credentials_not_allowed" as const };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: ResolvedAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await (options.resolveHostname ?? defaultHostnameResolver)(hostname);
    } catch {
      return { ok: false as const, reason: "dns_resolution_failed" as const };
    }
  }
  if (!addresses.length) return { ok: false as const, reason: "dns_resolution_failed" as const };
  if (addresses.some(({ address }) => isUnsafeNetworkAddress(address)))
    return { ok: false as const, reason: "unsafe_destination" as const };
  return { ok: true as const, url };
}
