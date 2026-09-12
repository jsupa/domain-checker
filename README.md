# Multi-Threaded Domain Checker & Scraper

A high-performance Node.js & TypeScript tool that:
- Streams domains from **CertStream** (real-time Certificate Transparency logs) or scrapes **Newly Registered Domains from yesterday / past dates**.
- Filters by chosen **Top-Level Domains (TLDs)** (e.g. `.com`, `.eu`, `.de`) or accepts **ANY domain** (`--all-tlds`).
- Verifies if domains serve actual HTML using **`got`**.
- Measures HTTP response latency against a configurable threshold (e.g. `< 20ms` or custom threshold).
- Enforces **strict multi-layer deduplication** to ensure only **unique domains** are checked and saved.
- Flushes matching records in real-time to a **CSV** file.
- Powered by a genuine multi-threaded worker pool using Node.js `worker_threads`.

---

## 💡 Can you get old records from CertStream or only new ones?

> **Short Answer**: CertStream itself only provides **new records in real-time**. It acts as a live pub/sub stream and does not maintain a historical search API or archive of past certificates.

### How CertStream Works
CertStream connects to Certificate Transparency (CT) logs operated by Let's Encrypt, Google, Cloudflare, DigiCert, etc. When a Certificate Authority issues a new certificate, it is broadcast to CT logs, and CertStream pushes it out immediately over a WebSocket. Once an event passes, CertStream does not store it.

### How This Tool Solves Getting Past / Yesterday's Records:
1. **Newly Registered Domains from Yesterday (`--yesterday` / `-y`)**:
   We built direct support for daily Newly Registered Domain feeds. It automatically fetches ~10,000 domains registered yesterday and streams them through the multi-threaded checker.
2. **Specific Past Dates (`--date YYYY-MM-DD`)**:
   Download and verify domains registered on any specific date in history.
3. **Local Files (`--file <path>`)**:
   Pass any `.txt` or `.csv` list of domains to run through the HTML & latency pipeline.
4. **Historical CT Search (`--source crtsh`)**:
   Queries [crt.sh](https://crt.sh) for historical certificates and extracts domains for your target TLDs.

---

## 🛡️ Strict Unique Domain Enforcement

The checker enforces uniqueness at multiple layers so your CSV will **never contain duplicate domains**:

1. **Cross-Run / Session Memory**: On startup, [`CsvWriter`](src/csv.ts) reads your existing CSV file (e.g. `domains.csv`) and caches all previously saved domains. Restarting the script will never re-save an existing domain.
2. **In-Flight Deduplication**: Tracks domains currently assigned to active worker threads so the same domain is not enqueued multiple times simultaneously.
3. **Pre-Check Cache**: Ingested domains that are already in the CSV or in-flight are discarded before even wasting CPU cycles on worker threads.
4. **Atomic Write Guard**: Before appending a row to the CSV file, uniqueness is checked and recorded atomically.

---

## ⚡ Performance Note on `< 20ms` Speeds

Completing DNS lookup, TCP handshake, TLS negotiation, and HTTP response over the public internet in under 20ms is very fast. It typically occurs when:
- The domain is fronted by an edge CDN (such as Cloudflare, CloudFront, Fastly, or Akamai) with an edge node physically located in your ISP / metropolitan area.
- Local DNS cache is warm.

This tool measures HTTP response latency with sub-millisecond precision using `got.timings.phases.total` (measuring total phase socket duration) with fallback to high-resolution `performance.now()`. The speed threshold is fully configurable via `-m, --max-time <ms>`.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js >= 18.x (Tested on Node v24.x)
- npm >= 9.x

### 2. Installation
```bash
git clone https://github.com/jsupa/domain-checker.git
cd domain-checker
npm install
```

### 3. Build
```bash
npm run build
```

---

## 💻 Usage & Examples

### 1. Real-Time CertStream Stream (Target TLDs)
Listen to CertStream, filter for `.com`, `.eu`, `.de`, check for HTML, and record domains responding in under 20ms:
```bash
npm start -- -t .com,.eu,.de -m 20
```

### 2. Accept ANY Domain (All TLDs)
If you want to check **all domains** regardless of extension, pass `--all-tlds` (or `-a`, or `-t "*"`):
```bash
# Live CertStream for ANY domain:
npm start -- --all-tlds -m 100

# Yesterday's newly registered domains for ANY TLD:
npm start -- --yesterday --all-tlds -m 150 -l 25
```

### 3. Scrape Newly Registered Domains from Yesterday
Automatically download domains registered yesterday, filter for `.com`, `.eu`, `.de`, and check them:
```bash
npm start -- --yesterday -t .com,.eu,.de -m 150 -l 25
```

### 4. Scrape from a Specific Past Date
Fetch domains registered on a specific date (e.g. `2026-09-08`):
```bash
npm start -- --date 2026-09-08 -t .com,.de -m 200
```

### 5. Check Domains from a Local File
Supply your own `.txt` or `.csv` domain list:
```bash
npm start -- --file ./my-domains.txt -t .com,.eu -m 150
```

### 6. Historical Search via `crt.sh`
Fetch and verify past/historical certificates for `.de` and `.eu`:
```bash
npm start -- --source crtsh -t .de,.eu -m 150
```

### 7. Instant Demo / Mock Mode
Test the multi-threaded pipeline immediately with synthetic real-time domains:
```bash
npm run demo -- -t .com,.eu -m 150 -l 10
```

### 8. Full Custom Configuration
```bash
npm start -- \
  --tlds .com,.eu,.de \
  --max-time 100 \
  --threads 12 \
  --output ./fast-domains.csv \
  --limit 50 \
  --verbose
```

---

## 🛠️ CLI Options Reference

| Option | Flag | Default | Description |
| :--- | :--- | :--- | :--- |
| `--tlds` | `-t` | `.com,.eu,.de` | Comma-separated list of TLDs to filter (e.g. `.com,.eu,.de`), or `*` / `all` for any TLD |
| `--all-tlds` | `-a` | `false` | Accept **ANY domain** regardless of TLD (disables TLD filtering) |
| `--max-time` | `-m` | `20` | Maximum response time in milliseconds to qualify as a match |
| `--threads` | `-w` | CPU Cores | Number of worker threads for parallel HTTP checks |
| `--output` | `-o` | `domains.csv` | Path for the output CSV file |
| `--yesterday`| `-y` | `false` | Scrape newly registered domains from yesterday |
| `--date` | | `undefined` | Scrape newly registered domains from a specific date (`YYYY-MM-DD`) |
| `--file` | `-f` | `undefined` | Read and check domains from a local text or CSV file |
| `--url` | `-u` | `wss://certstream.calidog.io/` | CertStream WebSocket server URL |
| `--timeout` | | `2500` | HTTP request timeout per domain in ms |
| `--max-queue`| | `1000` | Max backlog queue size to handle backpressure and prevent memory leaks |
| `--limit` | `-l` | `undefined` | Stop automatically after saving `N` unique matching domains |
| `--source` | `-s` | `certstream` | Domain source: `certstream`, `yesterday`, `crtsh`, `file`, `demo` |
| `--demo` | | `false` | Shortcut for `--source demo` |
| `--verbose` | `-v` | `false` | Print detailed status for every checked domain |

---

## 📊 CSV Output Format

Matches are streamed directly to disk as they are confirmed:

```csv
Domain,TLD,URL,Status Code,Response Time (ms),Has HTML,Content Type,Checked At
google.de,.de,https://www.google.com/,200,194,yes,text/html; charset=UTF-8,2026-09-12T10:42:24.542Z
labourunionindia.org,.org,https://labourunionindia.org/,200,127,yes,text/html,2026-09-12T11:01:54.129Z
cloud.com,.com,https://www.cloud.com/,200,117,yes,text/html; charset=utf-8,2026-09-12T10:36:10.302Z
```

---

## 🏗️ Architecture

- **[`src/index.ts`](src/index.ts)**: Main orchestration and CLI lifecycle.
- **[`src/config.ts`](src/config.ts)**: CLI options parsing using `commander`.
- **[`src/types.ts`](src/types.ts)**: TypeScript interfaces and dynamic TLD extraction (`extractTld`).
- **[`src/worker.ts`](src/worker.ts)**: Worker thread utilizing `got` to execute HTTP/HTTPS requests, measure `timings.phases.total`, and detect HTML in headers & response body.
- **[`src/pool.ts`](src/pool.ts)**: Worker pool managing `N` threads with round-robin dispatching and queue backpressure control.
- **[`src/csv.ts`](src/csv.ts)**: Stream-based CSV writer with startup file parsing and atomic deduplication.
- **[`src/certstream.ts`](src/certstream.ts)**: Resilient WebSocket client with automatic exponential backoff reconnects, 15s ping heartbeats, and wildcard stripping.
- **[`src/nrd.ts`](src/nrd.ts)**: Newly Registered Domains fetcher for yesterday/specific dates and local file reader.
- **[`src/crtsh.ts`](src/crtsh.ts)**: Direct integration with crt.sh API for historical certificate transparency lookups.
- **[`src/mockStream.ts`](src/mockStream.ts)**: Synthetic test stream generator for offline testing.
- **[`src/logger.ts`](src/logger.ts)**: Dynamic terminal dashboard displaying real-time throughput and progress.
