import { parseCliOptions } from './config.js';
import { Logger } from './logger.js';
import { CsvWriter } from './csv.js';
import { WorkerPool } from './pool.js';
import { CertStreamClient } from './certstream.js';
import { CrtShFetcher } from './crtsh.js';
import { MockStreamClient } from './mockStream.js';
import { NrdFetcher } from './nrd.js';
import type { DomainCheckResult } from './types.js';

async function main() {
  const config = parseCliOptions();
  const logger = new Logger(config);
  const csvWriter = new CsvWriter(config.outputFile);

  logger.printBanner(csvWriter.getSavedCount());

  const pool = new WorkerPool(config.threads, config.maxQueueSize);
  const inFlightDomains = new Set<string>();

  let isShuttingDown = false;

  async function shutdown(reason?: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (reason) {
      console.log(`\n[\x1b[33mSHUTDOWN\x1b[0m] ${reason}`);
    } else {
      console.log('\n[\x1b[33mSHUTDOWN\x1b[0m] Stopping domain checker...');
    }

    // Stop source
    if (sourceClient) {
      sourceClient.stop();
    }

    // Terminate worker pool
    await pool.shutdown();

    // Flush and close CSV file
    await csvWriter.close();

    // Print summary
    logger.printSummary();
    process.exit(0);
  }

  process.on('SIGINT', () => {
    shutdown('Received SIGINT (Ctrl+C)');
  });

  process.on('SIGTERM', () => {
    shutdown('Received SIGTERM');
  });

  // Handle results from worker threads
  pool.on('result', (result: DomainCheckResult) => {
    inFlightDomains.delete(result.domain.toLowerCase());

    let wasSaved = false;
    if (result.matched) {
      wasSaved = csvWriter.writeResult(result);
    }

    logger.recordResult(result, pool.getBusyCount(), pool.getQueueLength(), wasSaved);

    if (config.limit && logger.getTotalSaved() >= config.limit) {
      shutdown(`Target limit of ${config.limit} unique matches reached.`);
    }
  });

  pool.on('error', (err: Error) => {
    logger.error(`Worker error: ${err.message}`);
  });

  // Start selected domain source
  let sourceClient: CertStreamClient | CrtShFetcher | MockStreamClient | NrdFetcher;

  if (config.source === 'demo') {
    sourceClient = new MockStreamClient({
      tlds: config.tlds,
      allowAllTlds: config.allowAllTlds
    });
  } else if (config.source === 'crtsh') {
    sourceClient = new CrtShFetcher({ tlds: config.tlds });
  } else if (config.source === 'yesterday' || config.source === 'file') {
    sourceClient = new NrdFetcher({
      tlds: config.tlds,
      allowAllTlds: config.allowAllTlds,
      date: config.date,
      inputFile: config.inputFile
    });
  } else {
    sourceClient = new CertStreamClient({
      url: config.certstreamUrl,
      tlds: config.tlds,
      allowAllTlds: config.allowAllTlds
    });
  }

  sourceClient.on('domain', ({ domain, tld }: { domain: string; tld: string }) => {
    logger.incrementStreamed();
    const clean = domain.trim().toLowerCase();

    // Skip domain if it is already saved in CSV or currently in-flight
    if (csvWriter.hasDomain(clean) || inFlightDomains.has(clean)) {
      return;
    }

    inFlightDomains.add(clean);

    const enqueued = pool.enqueue({
      domain: clean,
      tld,
      httpTimeoutMs: config.httpTimeoutMs,
      maxResponseTimeMs: config.maxResponseTimeMs
    });

    if (!enqueued) {
      inFlightDomains.delete(clean);
      if (config.verbose) {
        logger.warn(`Queue full (${config.maxQueueSize}). Discarding domain: ${domain}`);
      }
    }
  });

  sourceClient.on('status', (msg: string) => {
    logger.info(msg);
  });

  sourceClient.on('connected', (url: string) => {
    logger.info(`Successfully connected to stream: ${url}`);
  });

  sourceClient.on('disconnected', ({ code, reason }: { code: number; reason: string }) => {
    logger.warn(`Stream disconnected (code: ${code}, reason: ${reason || 'unknown'})`);
  });

  sourceClient.on('error', (err: Error) => {
    logger.warn(`Stream network warning: ${err.message}`);
  });

  if (config.source === 'crtsh' || config.source === 'yesterday' || config.source === 'file') {
    (sourceClient as CrtShFetcher | NrdFetcher).on('finished', () => {
      logger.info('Finished reading all available domain records from source.');
    });
  }

  // Periodic dashboard refresh even when idle
  const dashboardInterval = setInterval(() => {
    if (!isShuttingDown) {
      logger.renderDashboard(pool.getBusyCount(), pool.getQueueLength(), true);
    }
  }, 1000);

  // Start ingestion
  sourceClient.start();
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
