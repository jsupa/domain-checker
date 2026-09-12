import { EventEmitter } from 'node:events';

export interface MockStreamOptions {
  tlds: string[];
  allowAllTlds?: boolean;
  intervalMs?: number;
}

const SAMPLE_SLUGS = [
  'google', 'cloudflare', 'apple', 'amazon', 'microsoft',
  'github', 'fastly', 'akamai', 'wikipedia', 'meta',
  'test', 'shop', 'portal', 'api', 'app',
  'cloud', 'dev', 'secure', 'login', 'cdn',
  'edge', 'network', 'connect', 'status', 'hub',
  'fresh', 'digital', 'tech', 'online', 'store'
];

const DEFAULT_ANY_TLDS = [
  '.com', '.org', '.net', '.xyz', '.io', '.ai',
  '.de', '.eu', '.uk', '.tech', '.app', '.co.uk'
];

export class MockStreamClient extends EventEmitter {
  private tlds: string[];
  private allowAllTlds: boolean;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isStopped = false;

  constructor(options: MockStreamOptions) {
    super();
    this.allowAllTlds = Boolean(options.allowAllTlds);
    this.tlds = this.allowAllTlds || options.tlds.length === 0 ? DEFAULT_ANY_TLDS : options.tlds;
    this.intervalMs = options.intervalMs ?? 300;
  }

  public start(): void {
    this.isStopped = false;
    const label = this.allowAllTlds ? 'ANY TLD (*)' : this.tlds.join(', ');
    this.emit('status', `Starting Mock/Demo domain stream for ${label}...`);

    let counter = 0;
    this.timer = setInterval(() => {
      if (this.isStopped) return;

      const slug = SAMPLE_SLUGS[counter % SAMPLE_SLUGS.length];
      const tld = this.tlds[Math.floor(Math.random() * this.tlds.length)];
      
      // Mix of real fast root domains and generated subdomains
      const domain = counter % 5 === 0 
        ? `${slug}${tld}` 
        : `${slug}-${Math.floor(Math.random() * 1000)}${tld}`;

      this.emit('domain', { domain, tld });
      counter++;
    }, this.intervalMs);
  }

  public stop(): void {
    this.isStopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
