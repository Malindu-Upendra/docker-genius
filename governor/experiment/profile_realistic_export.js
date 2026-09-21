// profile_realistic_export.js — DOCKER-GENIUS realistic-workload profiling
//
// Addresses supervisor review item #28 ("The artificial CPU loop weakens
// ecological validity") — specifically step (i) of the remediation already
// scoped in the paper's Threats to Validity section: "instrument the ERP
// application's genuinely CPU-intensive operations directly ... and profile
// each one's actual CPU/memory time series."
//
// This is a STANDALONE, read-only benchmark. It is NOT wired into the live
// bulkGenerate() research-mode endpoint — that endpoint still uses the
// original fixed-iteration burnCpu() loop, unchanged, because every
// experiment already reported in the paper (three-group comparison,
// ablation, sensitivity, confirmatory, factorial sweep) depended on that
// loop's ~3s calibrated cost to produce observable governor contention.
// Replacing it live would silently invalidate the reproducibility of every
// already-collected result.
//
// What this script does: logs in as the normal seeded tenant admin, calls
// the *existing*, non-research-mode bulk-generate endpoint to fetch the
// same 8 real reports bulkGenerate() already queries, then performs the
// exact export-formatting work a real "download this report" feature would
// do — CSV formatting with round-half-to-even currency rounding and proper
// field escaping, plus a SHA-256 integrity checksum over the export — and
// times ONLY that in-process formatting step (network/DB time excluded).
//
// Usage:
//   node governor/experiment/profile_realistic_export.js [--runs N]
//
// Output:
//   governor/experiment/realistic_export_profile.json

const crypto = require('crypto');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const EMAIL = 'admin@colomboretail.lk';
const PASSWORD = 'test123';

function formatCurrency(n) {
  // Round-half-to-even (banker's rounding) to 2dp — the convention most
  // accounting exports use — not naive toFixed(2).
  const scaled = n * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded;
  if (Math.abs(diff - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return (rounded / 100).toFixed(2);
}

function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? formatCurrency(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportReportsToCsv(results) {
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  for (const [reportName, rows] of Object.entries(results)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const header = Object.keys(rows[0]);
    const headerLine = `# ${reportName}\n${header.map(escapeCsvField).join(',')}\n`;
    hash.update(headerLine);
    totalBytes += headerLine.length;
    for (const row of rows) {
      const line = header.map((k) => escapeCsvField(row[k])).join(',') + '\n';
      hash.update(line);
      totalBytes += line.length;
    }
  }
  return { csvBytes: totalBytes, checksum: hash.digest('hex') };
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.access_token || body.accessToken || body.token;
}

async function fetchReportData(token) {
  // research_mode intentionally omitted/false — this only exercises the
  // real report queries, never the live burnCpu() research-mode path.
  const res = await fetch(`${BASE_URL}/api/reports/bulk-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`bulk-generate failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.reports;
}

async function main() {
  const runsArgIdx = process.argv.indexOf('--runs');
  const runs = runsArgIdx !== -1 ? parseInt(process.argv[runsArgIdx + 1], 10) : 10;

  console.log(`[profile] Logging in as ${EMAIL} ...`);
  const token = await login();

  console.log('[profile] Fetching real report data (non-research-mode bulk-generate) ...');
  const results = await fetchReportData(token);

  const rowCounts = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
  console.log('[profile] Real fetched row counts:', rowCounts);

  console.log(`[profile] Timing exportReportsToCsv() in-process formatting over ${runs} runs ...`);
  const timingsMs = [];
  let lastExport;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    lastExport = exportReportsToCsv(results);
    const t1 = process.hrtime.bigint();
    timingsMs.push(Number(t1 - t0) / 1e6);
  }

  const mean = timingsMs.reduce((a, b) => a + b, 0) / timingsMs.length;
  const sorted = [...timingsMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const sd = Math.sqrt(timingsMs.reduce((a, b) => a + (b - mean) ** 2, 0) / timingsMs.length);

  const report = {
    description:
      'Standalone profiling of real ERP export-formatting work (CSV format + SHA-256 checksum) ' +
      'over the actual fetched report data volume, timing only the in-process formatting step. ' +
      'Not wired into the live research-mode endpoint (see file header).',
    tenant_row_counts: rowCounts,
    csv_bytes: lastExport.csvBytes,
    checksum_sample: lastExport.checksum,
    n_runs: runs,
    timings_ms: timingsMs.map((t) => Math.round(t * 1000) / 1000),
    mean_ms: Math.round(mean * 1000) / 1000,
    median_ms: Math.round(median * 1000) / 1000,
    sd_ms: Math.round(sd * 1000) / 1000,
    min_ms: Math.round(sorted[0] * 1000) / 1000,
    max_ms: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
    burn_cpu_loop_calibrated_ms: 3000,
  };

  console.log(
    `[profile] mean=${report.mean_ms}ms median=${report.median_ms}ms sd=${report.sd_ms}ms ` +
      `min=${report.min_ms}ms max=${report.max_ms}ms  (burnCpu loop calibrated to ~3000ms)`,
  );

  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, 'realistic_export_profile.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[profile] Saved -> ${outPath}`);
}

main().catch((err) => {
  console.error('[profile] FAILED:', err);
  process.exit(1);
});
