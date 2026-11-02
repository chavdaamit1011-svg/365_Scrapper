import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { connectMongo } from './mongodb';

const KNOWN_PYTHON_PATHS = [
  'C:\\Users\\chavda amit\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
  'python.exe',
  'python',
  'py',
];

export function getPythonExecutable(): string {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  for (const p of KNOWN_PYTHON_PATHS) {
    if (p.includes('\\') && fs.existsSync(p)) {
      return p;
    }
  }
  return 'python';
}

export interface CrawlRunResult {
  success: boolean;
  domain: string;
  records: any[];
  logs: string[];
  error?: string;
}

/**
 * Executes the Python web crawler on a target domain/URL.
 * Results are saved to MongoDB and local JSON, and returned.
 */
export async function executeCrawlerOnDomain(
  rawTarget: string,
  maxPages: number = 5,
  maxDepth: number = 2
): Promise<CrawlRunResult> {
  const pythonBin = getPythonExecutable();
  const scriptPath = path.join(process.cwd(), 'crawler_engine', 'run_crawler.py');

  let targetUrl = rawTarget.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `https://${targetUrl}`;
  }

  // Extract clean hostname
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    hostname = rawTarget.replace(/^https?:\/\//, '').split('/')[0];
  }

  const logs: string[] = [];

  return new Promise((resolve) => {
    const args = [
      scriptPath,
      targetUrl,
      '--max-pages',
      String(maxPages),
      '--max-depth',
      String(maxDepth),
      '--delay',
      '0.3',
      '--timeout',
      '10',
      '--playwright',
    ];

    console.log(`[CrawlerRunner] Spawning: ${pythonBin} ${args.join(' ')}`);

    const child = spawn(pythonBin, args, {
      cwd: path.join(process.cwd(), 'crawler_engine'),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    child.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        logs.push(line);
        console.log(`[Crawler stdout] ${line}`);
      }
    });

    child.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        logs.push(line);
        console.warn(`[Crawler stderr] ${line}`);
      }
    });

    // Timeout protection: kill after 25 seconds if hanging
    const timeoutHandle = setTimeout(() => {
      console.warn(`[CrawlerRunner] Timeout reached for ${targetUrl}. Terminating.`);
      try {
        child.kill();
      } catch (e) {}
    }, 25000);

    child.on('close', async (code) => {
      clearTimeout(timeoutHandle);
      console.log(`[CrawlerRunner] Crawler exited with code ${code} for ${targetUrl}`);

      // Collect scraped records directly from MongoDB
      let records: any[] = [];
      try {
        const mongoose = await connectMongo();
        if (mongoose && mongoose.connection.readyState === 1) {
          const collection = mongoose.connection.collection('scraped_results');
          const docs = await collection
            .find({ $or: [{ domain: hostname }, { subdomain: hostname }] })
            .sort({ _id: -1 })
            .limit(100)
            .toArray();

          if (docs && docs.length > 0) {
            records = docs.map((d: any) => ({
              id: d.id || String(d._id),
              domain: d.domain || hostname,
              rootDomain: d.rootDomain || d.domain || hostname,
              subdomain: d.subdomain || hostname,
              subdomains: Array.isArray(d.subdomains) ? d.subdomains : [],
              subdomainCount: typeof d.subdomainCount === 'number' ? d.subdomainCount : (d.subdomains ? d.subdomains.length : 0),
              email: d.email || (Array.isArray(d.emails) && d.emails[0]) || '',
              emails: Array.isArray(d.emails) ? d.emails : [],
              emailCount: typeof d.emailCount === 'number' ? d.emailCount : (d.emails ? d.emails.length : 0),
              country: d.country || 'Detected',
              countryCode: d.countryCode || 'INT',
              countryFlag: d.countryFlag || '🌐',
              status: d.status || 'RESOLVED',
              pagesCrawled: d.pagesCrawled || 0,
              discoveredAt: d.discoveredAt || new Date().toISOString(),
            }));
          }
        }
      } catch (err) {
        console.warn('[CrawlerRunner] Could not query MongoDB after crawl:', err);
      }

      // If still empty (e.g. target site had 0 emails/subdomains), ensure base record with actual scraped status
      if (records.length === 0 && code === 0) {
        records.push({
          id: `crawl_${Date.now()}`,
          domain: hostname,
          subdomain: hostname,
          email: '',
          country: 'Detected',
          countryCode: 'INT',
          countryFlag: '🌐',
          status: 'RESOLVED',
          discoveredAt: new Date().toISOString(),
        });
      }

      resolve({
        success: code === 0 || records.length > 0,
        domain: hostname,
        records,
        logs,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      console.error('[CrawlerRunner] Failed to start Python process:', err);
      resolve({
        success: false,
        domain: hostname,
        records: [],
        logs,
        error: err.message,
      });
    });
  });
}

