import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { CertStreamMessage } from './types.js';
import { extractTld } from './types.js';

export interface CertStreamClientOptions {
  url: string;
  tlds: string[];
  allowAllTlds?: boolean;
  maxCacheSize?: number;
}

export class CertStreamClient extends EventEmitter {
  private url: string;
  private tlds: string[];
  private allowAllTlds: boolean;
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isClosed = false;

  // Deduplication set with fixed capacity
  private seenDomains = new Set<string>();
  private maxCacheSize: number;

  constructor(options: CertStreamClientOptions) {
    super();
    this.url = options.url;
    this.tlds = options.tlds.map((t) => t.toLowerCase());
    this.allowAllTlds = Boolean(options.allowAllTlds);
    this.maxCacheSize = options.maxCacheSize ?? 50000;
  }

  public start(): void {
    this.isClosed = false;
    this.connect();
  }

  private connect(): void {
    if (this.isClosed) return;

    this.emit('status', `Connecting to CertStream: ${this.url}`);

    try {
      this.ws = new WebSocket(this.url, {
        handshakeTimeout: 10000
      });

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.emit('connected', this.url);

        // Ping every 15s to keep connection alive
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.ping();
              this.ws.send('ping');
            } catch {
              // Ignore ping send failures
            }
          }
        }, 15000);
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err: Error) => {
        this.emit('error', err);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.cleanupSocket();
        this.emit('disconnected', { code, reason: reason.toString() });
        this.scheduleReconnect();
      });
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private handleMessage(rawData: WebSocket.RawData): void {
    try {
      const parsed: CertStreamMessage = JSON.parse(rawData.toString());
      this.emit('raw_message', parsed);

      if (parsed.message_type === 'certificate_update' && parsed.data?.leaf_cert) {
        const domains = parsed.data.leaf_cert.all_domains || [];
        for (const rawDomain of domains) {
          this.processDomain(rawDomain);
        }
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  private processDomain(rawDomain: string): void {
    if (!rawDomain || typeof rawDomain !== 'string') return;

    // Strip wildcard prefixes: *.example.com -> example.com
    let clean = rawDomain.trim().toLowerCase();
    while (clean.startsWith('*.')) {
      clean = clean.slice(2);
    }

    if (!clean || clean.includes(' ') || clean.length < 3) return;

    // Check if domain matches any configured TLD or if any TLD is accepted
    let matchedTld = '';
    if (this.allowAllTlds) {
      matchedTld = extractTld(clean);
      if (!matchedTld) return;
    } else {
      const found = this.tlds.find((tld) => clean.endsWith(tld));
      if (!found) return;
      matchedTld = found;
    }

    // Prevent deduplication overflow
    if (this.seenDomains.has(clean)) return;

    if (this.seenDomains.size >= this.maxCacheSize) {
      // Clear half the cache when limit reached
      const toDelete = Math.floor(this.maxCacheSize / 2);
      let i = 0;
      for (const item of this.seenDomains) {
        this.seenDomains.delete(item);
        if (++i >= toDelete) break;
      }
    }

    this.seenDomains.add(clean);
    this.emit('domain', { domain: clean, tld: matchedTld });
  }

  private scheduleReconnect(): void {
    if (this.isClosed) return;

    this.reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)));
    this.emit('status', `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private cleanupSocket(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }

  public stop(): void {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.seenDomains.clear();
  }
}
