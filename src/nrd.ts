import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import got from 'got';
import { extractTld } from './types.js';

export interface NrdFetcherOptions {
  tlds: string[];
  allowAllTlds?: boolean;
  date?: string;          // Format: YYYY-MM-DD
  inputFile?: string;     // Local file path
}

/**
 * Fetches newly registered domains from yesterday (or a specific date),
 * or reads a list from a local file.
 */
export class NrdFetcher extends EventEmitter {
  private tlds: string[];
  private allowAllTlds: boolean;
  private date?: string;
  private inputFile?: string;
  private isStopped = false;

  constructor(options: NrdFetcherOptions) {
    super();
    this.tlds = options.tlds.map((t) => t.toLowerCase());
    this.allowAllTlds = Boolean(options.allowAllTlds);
    this.date = options.date;
    this.inputFile = options.inputFile;
  }

  public async start(): Promise<void> {
    this.isStopped = false;

    if (this.inputFile) {
      await this.readFromFile(this.inputFile);
    } else {
      await this.fetchFromDailyFeed();
    }
  }

  private async readFromFile(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    this.emit('status', `Reading domains from local file: ${resolvedPath}`);

    if (!fs.existsSync(resolvedPath)) {
      this.emit('error', new Error(`Input file not found: ${resolvedPath}`));
      return;
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      this.emit('status', `Loaded ${lines.length} raw lines from ${path.basename(resolvedPath)}`);

      for (const line of lines) {
        if (this.isStopped) break;
        const clean = line.replace(/^["']|["']$/g, '').trim().toLowerCase();
        if (!clean || clean.startsWith('#')) continue;

        // In case of CSV line, grab first column
        const commaIdx = clean.indexOf(',');
        const rawDomain = commaIdx !== -1 ? clean.slice(0, commaIdx) : clean;
        this.emitDomainIfMatch(rawDomain);
      }

      this.emit('finished');
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async fetchFromDailyFeed(): Promise<void> {
    let targetUrl: string;
    let label: string;

    if (this.date) {
      label = this.date;
      targetUrl = `https://raw.githubusercontent.com/WhoisFreaks/daily-newly-registered-domains/main/${this.date}-free-newly-registered-domains.csv`;
    } else {
      // Calculate yesterday's date string YYYY-MM-DD
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      label = `yesterday (${yesterday.toISOString().split('T')[0]})`;
      targetUrl = 'https://raw.githubusercontent.com/WhoisFreaks/daily-newly-registered-domains/main/0-latest-free-newly-registered-domains.csv';
    }

    this.emit('status', `Fetching newly registered domains from ${label}...`);

    try {
      let response;
      try {
        response = await got(targetUrl, {
          timeout: { request: 15000 },
          retry: { limit: 1 }
        });
      } catch (err) {
        // Fallback to archive directory if date was specified
        if (this.date) {
          const archiveUrl = `https://raw.githubusercontent.com/WhoisFreaks/daily-newly-registered-domains/main/archive/${this.date}-free-newly-registered-domains.csv`;
          this.emit('status', `Trying archive directory for ${this.date}...`);
          response = await got(archiveUrl, {
            timeout: { request: 15000 },
            retry: { limit: 1 }
          });
        } else {
          throw err;
        }
      }

      const rawDomains = response.body.split(/\r?\n/).filter(Boolean);
      this.emit('status', `Downloaded ${rawDomains.length} newly registered domains from ${label}`);

      let matchedCount = 0;
      for (const raw of rawDomains) {
        if (this.isStopped) break;

        const clean = raw.replace(/^["']|["']$/g, '').trim().toLowerCase();
        if (!clean || clean.startsWith('#')) continue;

        const commaIdx = clean.indexOf(',');
        const domain = commaIdx !== -1 ? clean.slice(0, commaIdx) : clean;

        if (this.emitDomainIfMatch(domain)) {
          matchedCount++;
          // Slight yield to avoid blocking the event loop on huge lists
          if (matchedCount % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
      }

      this.emit('status', `Dispatched ${matchedCount} domains matching TLDs (${this.tlds.join(', ')})`);
      this.emit('finished');
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emitDomainIfMatch(rawDomain: string): boolean {
    let domain = rawDomain.trim().toLowerCase();
    while (domain.startsWith('*.')) {
      domain = domain.slice(2);
    }

    if (!domain || domain.includes(' ') || domain.length < 3) {
      return false;
    }

    let matchedTld = '';
    if (this.allowAllTlds) {
      matchedTld = extractTld(domain);
      if (!matchedTld) return false;
    } else {
      const found = this.tlds.find((tld) => domain.endsWith(tld));
      if (!found) return false;
      matchedTld = found;
    }

    this.emit('domain', { domain, tld: matchedTld });
    return true;
  }

  public stop(): void {
    this.isStopped = true;
  }
}
