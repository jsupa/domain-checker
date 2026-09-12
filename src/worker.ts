import { parentPort } from 'node:worker_threads';
import got, { RequestError, Response } from 'got';
import type { DomainCheckTask, DomainCheckResult } from './types.js';

if (!parentPort) {
  throw new Error('worker.ts must be run as a worker thread');
}

/**
 * Determine if an HTTP response contains actual HTML content.
 */
function checkIsHtml(response: Response<string>): boolean {
  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const hasHtmlHeader =
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml');

  const body = typeof response.body === 'string' ? response.body.trim() : '';

  // Heuristic scan for common HTML tags or doctype
  const hasHtmlTags =
    /<(!doctype\s+)?html/i.test(body) ||
    /<head[\s>]/i.test(body) ||
    /<body[\s>]/i.test(body) ||
    /<\/html>/i.test(body) ||
    /<title[\s>]/i.test(body);

  return (hasHtmlHeader || hasHtmlTags) && body.length > 0;
}

/**
 * Perform the HTTP check on a domain using `got`.
 */
async function checkDomain(task: DomainCheckTask): Promise<DomainCheckResult> {
  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  const tryUrl = async (protocol: 'https' | 'http'): Promise<Response<string>> => {
    const url = `${protocol}://${task.domain}`;
    return got(url, {
      timeout: {
        request: task.httpTimeoutMs
      },
      retry: {
        limit: 0
      },
      followRedirect: true,
      maxRedirects: 3,
      throwHttpErrors: false,
      https: {
        rejectUnauthorized: false // Allow self-signed or transient certs while validating HTML presence
      },
      headers: {
        'user-agent': userAgent,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
  };

  const startTime = performance.now();
  let targetUrl = `https://${task.domain}`;

  try {
    let response: Response<string>;
    try {
      response = await tryUrl('https');
    } catch (httpsErr) {
      // Fallback to HTTP if HTTPS fails immediately
      targetUrl = `http://${task.domain}`;
      response = await tryUrl('http');
    }

    const elapsedWallTime = performance.now() - startTime;
    // Prefer got's socket-level total phase timing if available, fallback to wall-clock time
    const responseTimeMs = Math.round(
      response.timings?.phases?.total && response.timings.phases.total > 0
        ? response.timings.phases.total
        : elapsedWallTime
    );

    const hasHtml = checkIsHtml(response);
    const passedSpeed = responseTimeMs <= task.maxResponseTimeMs;
    const passedHtml = hasHtml;
    const contentType = response.headers['content-type'] || 'unknown';

    return {
      domain: task.domain,
      tld: task.tld,
      url: response.url || targetUrl,
      statusCode: response.statusCode,
      responseTimeMs,
      hasHtml,
      contentType,
      passedSpeed,
      passedHtml,
      matched: passedSpeed && passedHtml,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    const elapsedWallTime = performance.now() - startTime;
    const errorMessage = error instanceof RequestError ? error.message : String(error);

    return {
      domain: task.domain,
      tld: task.tld,
      url: targetUrl,
      statusCode: null,
      responseTimeMs: Math.round(elapsedWallTime),
      hasHtml: false,
      contentType: 'none',
      passedSpeed: false,
      passedHtml: false,
      matched: false,
      error: errorMessage,
      checkedAt: new Date().toISOString()
    };
  }
}

// Listen for job messages from the main thread pool
parentPort.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'check' && msg.task) {
    const result = await checkDomain(msg.task);
    parentPort?.postMessage({
      type: 'result',
      result
    });
  } else if (msg.type === 'exit') {
    process.exit(0);
  }
});
