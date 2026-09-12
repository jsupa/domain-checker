import { Command } from 'commander';
import os from 'node:os';
import type { CheckerConfig } from './types.js';

export function parseCliOptions(): CheckerConfig {
  const program = new Command();

  program
    .name('domain-checker')
    .description('Multi-threaded domain scraper & HTML latency checker with CSV output')
    .version('1.0.0')
    .option(
      '-t, --tlds <list>',
      'Comma-separated list of Top-Level Domains to filter (e.g. .com,.eu,.de), or "*" / "all" for any TLD',
      '.com,.eu,.de'
    )
    .option(
      '-a, --all-tlds',
      'Accept ANY domain regardless of TLD (disables TLD filtering)',
      false
    )
    .option(
      '-m, --max-time <ms>',
      'Maximum HTTP response time in milliseconds to qualify as a match',
      '20'
    )
    .option(
      '-w, --threads <number>',
      'Number of worker threads for parallel checking',
      String(Math.min(16, Math.max(2, os.cpus().length)))
    )
    .option(
      '-o, --output <file>',
      'Path to output CSV file',
      'domains.csv'
    )
    .option(
      '-u, --url <url>',
      'CertStream WebSocket endpoint',
      'wss://certstream.calidog.io/'
    )
    .option(
      '--timeout <ms>',
      'HTTP timeout per domain request in milliseconds',
      '2500'
    )
    .option(
      '--max-queue <number>',
      'Maximum domains queued in memory waiting for worker threads',
      '1000'
    )
    .option(
      '-l, --limit <number>',
      'Stop execution after finding this many matching domains'
    )
    .option(
      '-s, --source <source>',
      'Domain source: certstream (live CT stream), yesterday (daily newly registered domains), crtsh (historical CT logs), file (local file), demo (mock)',
      'certstream'
    )
    .option(
      '-y, --yesterday',
      'Shortcut for --source yesterday (scrape newly registered domains from yesterday)'
    )
    .option(
      '--date <YYYY-MM-DD>',
      'Scrape newly registered domains from a specific past date (e.g. 2026-09-09)'
    )
    .option(
      '-f, --file <path>',
      'Read and check domains from a local text or CSV file'
    )
    .option(
      '--demo',
      'Shortcut for --source demo (useful for testing when public Certstream is slow)'
    )
    .option(
      '-v, --verbose',
      'Print detailed status for every tested domain',
      false
    );

  program.parse();
  const rawOpts = program.opts();

  // Determine whether to allow all TLDs
  const rawTldOption = typeof rawOpts.tlds === 'string' ? rawOpts.tlds.trim() : '.com,.eu,.de';
  const isWildcard = rawTldOption === '*' || rawTldOption.toLowerCase() === 'all' || rawTldOption.toLowerCase() === 'any';
  const allowAllTlds = Boolean(rawOpts.allTlds || isWildcard);

  let tlds: string[] = [];
  if (!allowAllTlds) {
    const rawTldList = rawTldOption.split(',');
    tlds = rawTldList
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .map((t) => (t.startsWith('.') ? t : `.${t}`));
  }

  const maxResponseTimeMs = Math.max(1, parseInt(rawOpts.maxTime, 10) || 20);
  const threads = Math.max(1, parseInt(rawOpts.threads, 10) || 4);
  const httpTimeoutMs = Math.max(100, parseInt(rawOpts.timeout, 10) || 2500);
  const maxQueueSize = Math.max(50, parseInt(rawOpts.maxQueue, 10) || 1000);
  const limit = rawOpts.limit ? parseInt(rawOpts.limit, 10) : undefined;

  let source: CheckerConfig['source'] = 'certstream';
  if (rawOpts.demo) {
    source = 'demo';
  } else if (rawOpts.yesterday || rawOpts.date) {
    source = 'yesterday';
  } else if (rawOpts.file) {
    source = 'file';
  } else if (['crtsh', 'yesterday', 'file', 'demo'].includes(rawOpts.source)) {
    source = rawOpts.source as CheckerConfig['source'];
  }

  return {
    tlds,
    allowAllTlds,
    maxResponseTimeMs,
    threads,
    outputFile: rawOpts.output,
    certstreamUrl: rawOpts.url,
    httpTimeoutMs,
    maxQueueSize,
    limit,
    source,
    date: rawOpts.date,
    inputFile: rawOpts.file,
    verbose: Boolean(rawOpts.verbose)
  };
}
