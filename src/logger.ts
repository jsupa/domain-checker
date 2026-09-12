import type { CheckerConfig, DomainCheckResult } from './types.js';

export class Logger {
  private config: CheckerConfig;
  private totalStreamed = 0;
  private totalChecked = 0;
  private totalWithHtml = 0;
  private totalPassedSpeed = 0;
  private totalSaved = 0;
  private totalDuplicatesSkipped = 0;
  private startTime = Date.now();
  private lastDashboardUpdate = 0;

  constructor(config: CheckerConfig) {
    this.config = config;
  }

  public printBanner(existingDomainsCount = 0): void {
    console.log('\n=============================================================');
    console.log('            🚀 MULTI-THREADED DOMAIN CHECKER                 ');
    console.log('=============================================================');
    const tldDisplay = this.config.allowAllTlds ? 'ANY (*)' : this.config.tlds.join(', ');
    console.log(` • Target TLDs:        ${tldDisplay}`);
    console.log(` • Max Response Time:  < ${this.config.maxResponseTimeMs} ms`);
    console.log(` • Worker Threads:     ${this.config.threads} threads`);
    console.log(` • HTTP Timeout:       ${this.config.httpTimeoutMs} ms`);
    console.log(` • Output CSV:         ${this.config.outputFile}`);
    console.log(` • Deduplication:      Unique domains only${existingDomainsCount > 0 ? ` (${existingDomainsCount} already in CSV)` : ''}`);
    console.log(` • Domain Source:      ${this.config.source.toUpperCase()}`);
    if (this.config.limit) {
      console.log(` • Target Limit:       ${this.config.limit} unique matches`);
    }
    console.log('=============================================================\n');
  }

  public incrementStreamed(): void {
    this.totalStreamed++;
  }

  public recordResult(
    result: DomainCheckResult,
    busyWorkers: number,
    queueLength: number,
    wasSaved: boolean
  ): void {
    this.totalChecked++;
    if (result.hasHtml) this.totalWithHtml++;
    if (result.passedSpeed) this.totalPassedSpeed++;

    if (result.matched) {
      if (wasSaved) {
        this.totalSaved++;
        console.log(
          `[MATCH] ✅ \x1b[32m${result.domain}\x1b[0m (${result.tld}) | HTTP ${result.statusCode} | \x1b[33m${result.responseTimeMs}ms\x1b[0m | HTML: yes | \x1b[36mSaved unique to CSV\x1b[0m`
        );
      } else {
        this.totalDuplicatesSkipped++;
        if (this.config.verbose) {
          console.log(
            `[SKIP]  🔁 ${result.domain} (${result.tld}) | Matched criteria but duplicate domain already in CSV`
          );
        }
      }
    } else if (this.config.verbose) {
      if (!result.hasHtml) {
        console.log(
          `[SKIP]  ❌ ${result.domain} (${result.tld}) | HTTP ${result.statusCode ?? 'ERR'} | ${result.responseTimeMs}ms | No HTML (${result.error || result.contentType})`
        );
      } else if (!result.passedSpeed) {
        console.log(
          `[SKIP]  ⏱️  ${result.domain} (${result.tld}) | HTTP ${result.statusCode} | ${result.responseTimeMs}ms (exceeds ${this.config.maxResponseTimeMs}ms)`
        );
      }
    }

    this.renderDashboard(busyWorkers, queueLength);
  }

  public info(msg: string): void {
    console.log(`[\x1b[34mINFO\x1b[0m] ${msg}`);
  }

  public warn(msg: string): void {
    console.warn(`[\x1b[33mWARN\x1b[0m] ${msg}`);
  }

  public error(msg: string): void {
    console.error(`[\x1b[31mERROR\x1b[0m] ${msg}`);
  }

  public renderDashboard(busyWorkers: number, queueLength: number, force = false): void {
    const now = Date.now();
    // Throttle live dashboard to at most once per 800ms unless forced
    if (!force && now - this.lastDashboardUpdate < 800) return;
    this.lastDashboardUpdate = now;

    const elapsedSeconds = Math.max(1, Math.floor((now - this.startTime) / 1000));
    const rate = (this.totalChecked / elapsedSeconds).toFixed(1);

    process.stdout.write(
      `\r[STATS] Streamed: ${this.totalStreamed} | Checked: ${this.totalChecked} (${rate}/s) | HTML: ${this.totalWithHtml} | Speed < ${this.config.maxResponseTimeMs}ms: ${this.totalPassedSpeed} | \x1b[32mUnique Saved: ${this.totalSaved}\x1b[0m | Workers: ${busyWorkers}/${this.config.threads} | Queue: ${queueLength}   `
    );
  }

  public printSummary(): void {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - this.startTime) / 1000));
    console.log('\n\n=============================================================');
    console.log('                     EXECUTION SUMMARY                       ');
    console.log('=============================================================');
    console.log(` • Elapsed Time:          ${elapsedSeconds}s`);
    console.log(` • Total Streamed:        ${this.totalStreamed}`);
    console.log(` • Total Checked:         ${this.totalChecked}`);
    console.log(` • Valid HTML Pages:      ${this.totalWithHtml}`);
    console.log(` • Met Speed Filter:      ${this.totalPassedSpeed}`);
    console.log(` • New Unique Saved:      ${this.totalSaved}`);
    if (this.totalDuplicatesSkipped > 0) {
      console.log(` • Duplicates Filtered:   ${this.totalDuplicatesSkipped}`);
    }
    console.log(` • CSV File Location:     ${this.config.outputFile}`);
    console.log('=============================================================\n');
  }

  public getTotalSaved(): number {
    return this.totalSaved;
  }
}
