import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'csv-stringify';
import type { DomainCheckResult } from './types.js';

export class CsvWriter {
  private filePath: string;
  private writeStream: fs.WriteStream;
  private stringifier: ReturnType<typeof stringify>;
  private savedDomains = new Set<string>();

  constructor(outputFilePath: string) {
    this.filePath = path.resolve(outputFilePath);

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileExists = fs.existsSync(this.filePath);

    // If CSV already exists, load existing domains into memory to ensure cross-run uniqueness
    if (fileExists) {
      this.loadExistingDomains();
    }

    this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' });
    this.stringifier = stringify({
      header: !fileExists,
      columns: [
        { key: 'domain', header: 'Domain' },
        { key: 'tld', header: 'TLD' },
        { key: 'url', header: 'URL' },
        { key: 'statusCode', header: 'Status Code' },
        { key: 'responseTimeMs', header: 'Response Time (ms)' },
        { key: 'hasHtml', header: 'Has HTML' },
        { key: 'contentType', header: 'Content Type' },
        { key: 'checkedAt', header: 'Checked At' }
      ]
    });

    this.stringifier.pipe(this.writeStream);
  }

  private loadExistingDomains(): void {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // The first column is Domain
        const commaIdx = line.indexOf(',');
        const rawDomain = commaIdx !== -1 ? line.slice(0, commaIdx) : line;
        const cleanDomain = rawDomain.replace(/^["']|["']$/g, '').trim().toLowerCase();

        if (cleanDomain) {
          this.savedDomains.add(cleanDomain);
        }
      }
    } catch (err) {
      console.warn(`[CsvWriter] Notice: could not parse existing records in ${this.filePath}:`, err);
    }
  }

  /**
   * Check if a domain has already been saved to the CSV.
   */
  public hasDomain(domain: string): boolean {
    const clean = domain.trim().toLowerCase();
    return this.savedDomains.has(clean);
  }

  /**
   * Write a result to the CSV if it hasn't been written already.
   * Returns true if newly written, false if duplicate and ignored.
   */
  public writeResult(result: DomainCheckResult): boolean {
    const clean = result.domain.trim().toLowerCase();

    if (this.savedDomains.has(clean)) {
      return false;
    }

    this.savedDomains.add(clean);

    this.stringifier.write({
      domain: clean,
      tld: result.tld,
      url: result.url,
      statusCode: result.statusCode ?? '',
      responseTimeMs: result.responseTimeMs,
      hasHtml: result.hasHtml ? 'yes' : 'no',
      contentType: result.contentType,
      checkedAt: result.checkedAt
    });

    return true;
  }

  public getSavedCount(): number {
    return this.savedDomains.size;
  }

  public async close(): Promise<void> {
    return new Promise((resolve) => {
      this.stringifier.end(() => {
        this.writeStream.end(() => {
          resolve();
        });
      });
    });
  }

  public getFilePath(): string {
    return this.filePath;
  }
}
