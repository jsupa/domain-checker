export interface CheckerConfig {
  tlds: string[];               // e.g. ['.com', '.eu', '.de']
  allowAllTlds: boolean;        // If true, accept any domain/TLD
  maxResponseTimeMs: number;    // e.g. 20 ms
  threads: number;              // Number of worker threads
  outputFile: string;           // Output CSV file path
  certstreamUrl: string;        // WebSocket URL for CertStream
  httpTimeoutMs: number;        // HTTP request timeout in ms
  maxQueueSize: number;         // Max domains pending in queue before backpressure
  limit?: number;               // Max matched domains to collect before exiting
  source: 'certstream' | 'crtsh' | 'yesterday' | 'file' | 'demo'; // Source of domains
  date?: string;                // Specific past date: YYYY-MM-DD
  inputFile?: string;           // Path to local text/csv domain file
  verbose: boolean;             // Verbose logging
}

export interface DomainCheckTask {
  domain: string;
  tld: string;
  httpTimeoutMs: number;
  maxResponseTimeMs: number;
}

export interface DomainCheckResult {
  domain: string;
  tld: string;
  url: string;
  statusCode: number | null;
  responseTimeMs: number;
  hasHtml: boolean;
  contentType: string;
  passedSpeed: boolean;
  passedHtml: boolean;
  matched: boolean;
  error?: string;
  checkedAt: string;
}

export interface CertStreamCertificateData {
  leaf_cert?: {
    all_domains?: string[];
    subject?: {
      CN?: string;
    };
  };
}

export interface CertStreamMessage {
  message_type: string;
  data?: CertStreamCertificateData;
}

/**
 * Utility to extract the Top-Level Domain (TLD) from any domain name.
 * Handles common multi-part TLDs like .co.uk, .com.au, etc.
 */
export function extractTld(domain: string): string {
  const clean = domain.trim().toLowerCase();
  const parts = clean.split('.');
  if (parts.length < 2) return '';

  const multiPartPrefixes = ['co', 'com', 'org', 'net', 'gov', 'edu'];
  if (parts.length >= 3 && multiPartPrefixes.includes(parts[parts.length - 2])) {
    return `.${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }

  return `.${parts[parts.length - 1]}`;
}
