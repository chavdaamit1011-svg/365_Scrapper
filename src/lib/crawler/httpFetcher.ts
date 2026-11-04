/**
 * Resilient HTTP & HTTPS Client for Next.js / TypeScript Crawler
 * Handles:
 * - Both HTTPS and HTTP protocols with automatic protocol fallback
 * - Expired, self-signed, or untrusted SSL/TLS certificates (NIC CCA / Government certs)
 * - Automatic redirect following (up to 5 hops)
 * - Structured network error diagnosis (ERR_CONNECTION_TIMED_OUT, ERR_NAME_NOT_RESOLVED, etc.)
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { FetchResult } from './types';

// Custom agents to bypass certificate verification failures (e.g. CERT_HAS_EXPIRED on gov/state portals)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  timeout: 10000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  timeout: 10000,
});

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

/**
 * Performs a single HTTP/HTTPS request with SSL fallback and redirect following
 */
export function requestOnce(
  rawUrl: string,
  timeoutMs: number = 10000
): Promise<{
  statusCode: number;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (e: any) {
      return reject(new Error(`Invalid URL: ${rawUrl}`));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const req = client.request(
      parsedUrl,
      {
        method: 'GET',
        agent,
        headers: {
          ...DEFAULT_HEADERS,
          Host: parsedUrl.host,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          // Simple string conversion (Node automatically handles raw UTF-8)
          const body = bodyBuffer.toString('utf-8');
          resolve({
            statusCode: res.statusCode || 200,
            finalUrl: rawUrl,
            headers: res.headers,
            body,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Fetches a URL with automatic redirect handling (up to 5 redirects)
 */
export async function fetchWithRedirects(
  startUrl: string,
  timeoutMs: number = 10000,
  maxRedirects: number = 5
): Promise<{
  statusCode: number;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  html: string;
}> {
  let currentUrl = startUrl;
  let redirects = 0;

  while (redirects < maxRedirects) {
    const res = await requestOnce(currentUrl, timeoutMs);

    // Check for redirect status codes: 301, 302, 303, 307, 308
    if (
      res.statusCode >= 300 &&
      res.statusCode < 400 &&
      res.headers.location
    ) {
      redirects++;
      const redirectLocation = res.headers.location;
      // Resolve relative or protocol-relative redirects
      currentUrl = new URL(redirectLocation, currentUrl).toString();
      continue;
    }

    return {
      statusCode: res.statusCode,
      finalUrl: currentUrl,
      headers: res.headers,
      html: res.body,
    };
  }

  throw new Error(`Exceeded maximum redirects (${maxRedirects})`);
}

/**
 * High-level fetcher with HTTPS -> HTTP fallback and error diagnosis
 */
export async function fetchHtmlWithProtocolFallback(
  targetUrlOrDomain: string,
  timeoutMs: number = 10000
): Promise<FetchResult> {
  let clean = targetUrlOrDomain.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }

  // Attempt 1: As provided (usually HTTPS)
  try {
    const res = await fetchWithRedirects(clean, timeoutMs);
    const contentType = (res.headers['content-type'] as string) || 'text/html';

    return {
      ok: res.statusCode >= 200 && res.statusCode < 400,
      status: res.statusCode,
      finalUrl: res.finalUrl,
      html: res.html,
      contentType,
    };
  } catch (err1: any) {
    const errStr = String(err1?.message || err1 || '').toLowerCase();

    // If HTTPS failed due to timeout, SSL protocol mismatch, or refusal, try HTTP fallback
    const isHttps = clean.startsWith('https://');
    if (isHttps) {
      const httpFallbackUrl = clean.replace(/^https:\/\//i, 'http://');
      try {
        const res2 = await fetchWithRedirects(httpFallbackUrl, timeoutMs);
        const contentType = (res2.headers['content-type'] as string) || 'text/html';

        return {
          ok: res2.statusCode >= 200 && res2.statusCode < 400,
          status: res2.statusCode,
          finalUrl: res2.finalUrl,
          html: res2.html,
          contentType,
        };
      } catch (err2: any) {
        // Both HTTPS and HTTP failed -> Diagnose error
        return diagnoseNetworkError(err1, clean);
      }
    }

    // Direct HTTP failed -> Diagnose error
    return diagnoseNetworkError(err1, clean);
  }
}

/**
 * Helper to produce standardized technical diagnostic codes without informal slang
 */
function diagnoseNetworkError(err: any, attemptedUrl: string): FetchResult {
  const msg = String(err?.message || err || '').toLowerCase();

  let errorCode = 'ERR_UNREACHABLE';
  let errorTitle = 'Target Host Inaccessible';
  let status = 504;

  if (
    msg.includes('enotfound') ||
    msg.includes('getaddrinfo') ||
    msg.includes('err_name_not_resolved')
  ) {
    errorCode = 'ERR_NAME_NOT_RESOLVED';
    errorTitle = 'DNS Resolution Failed';
    status = 502;
  } else if (
    msg.includes('etimedout') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  ) {
    errorCode = 'ERR_CONNECTION_TIMED_OUT';
    errorTitle = 'Connection Timed Out';
    status = 504;
  } else if (
    msg.includes('econnrefused') ||
    msg.includes('connection refused')
  ) {
    errorCode = 'ERR_CONNECTION_REFUSED';
    errorTitle = 'Connection Refused';
    status = 502;
  } else if (
    msg.includes('cert') ||
    msg.includes('ssl') ||
    msg.includes('tls')
  ) {
    errorCode = 'ERR_SSL_PROTOCOL_ERROR';
    errorTitle = 'SSL/TLS Handshake Error';
    status = 525;
  }

  return {
    ok: false,
    status,
    finalUrl: attemptedUrl,
    html: '',
    contentType: 'text/html',
    error: err?.message || 'Network request failed',
    errorCode,
    errorTitle,
  };
}
