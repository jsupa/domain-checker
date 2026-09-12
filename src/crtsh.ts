import { EventEmitter } from 'node:events';
import got from 'got';

export interface CrtShOptions {
  tlds: string[];
}

interface CrtShEntry {
  common_name?: string;
  name_value?: string;
}

/**
 * Historical CT log reader querying crt.sh API.
 * This demonstrates how to retrieve past/historical certificate records
 * since CertStream itself only streams live/new certificates in real-time.
 */
export class CrtShFetcher extends EventEmitter {
  private tlds: string[];
  private isStopped = false;

  constructor(options: CrtShOptions) {
    super();
    this.tlds = options.tlds;
  }

  public async start(): Promise<void> {
    this.isStopped = false;
    const seen = new Set<string>();

    for (const tld of this.tlds) {
      if (this.isStopped) break;

      const queryTld = tld.startsWith('.') ? tld.slice(1) : tld;
      const url = `https://crt.sh/?q=%25.${queryTld}&output=json`;

      this.emit('status', `Querying historical CT logs for %${tld} from crt.sh...`);

      try {
        const response = await got(url, {
          timeout: { request: 15000 },
          retry: { limit: 1 },
          headers: {
            'user-agent': 'Mozilla/5.0 (DomainChecker/1.0)'
          }
        });

        const entries: CrtShEntry[] = JSON.parse(response.body);
        this.emit('status', `Received ${entries.length} historical records for ${tld}`);

        for (const entry of entries) {
          if (this.isStopped) break;

          const rawDomains = `${entry.common_name || ''}\n${entry.name_value || ''}`
            .split('\n')
            .map((d) => d.trim().toLowerCase());

          for (let domain of rawDomains) {
            while (domain.startsWith('*.')) {
              domain = domain.slice(2);
            }

            if (!domain || !domain.endsWith(tld) || seen.has(domain)) {
              continue;
            }

            seen.add(domain);
            this.emit('domain', { domain, tld });
            // Small pause to simulate steady stream
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('finished');
  }

  public stop(): void {
    this.isStopped = true;
  }
}
