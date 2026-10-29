import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i;

/** Stop browser pages and DNS rebinding hosts from reaching the local file API. */
export function isTrustedLocalRequest(headers: IncomingHttpHeaders): boolean {
  if (typeof headers.host !== 'string' || !LOOPBACK_HOST.test(headers.host)) {
    return false;
  }
  if (headers['sec-fetch-site'] === 'cross-site') {
    return false;
  }
  if (headers.origin !== undefined) {
    try {
      const origin = new URL(String(headers.origin));
      if (origin.protocol !== 'http:' || !LOOPBACK_HOST.test(origin.host)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
