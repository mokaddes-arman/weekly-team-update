const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');

process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
process.env.PUPPETEER_SKIP_DOWNLOAD = process.env.PUPPETEER_SKIP_DOWNLOAD || 'false';

fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR, { recursive: true });

dotenv.config({ path: path.join(__dirname, '.env') });
const puppeteer = require('puppeteer');

// Gemini configuration (model and API key loaded from environment)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash-lite';
const GEMINI_FALLBACK_MODELS = process.env.GEMINI_FALLBACK_MODELS
  ? process.env.GEMINI_FALLBACK_MODELS.split(',').map(s => s.trim()).filter(Boolean)
  : ['models/gemini-2.5-flash-lite', 'models/gemini-3.5-flash-lite'];

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || null;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || null;
const useTurso = Boolean(TURSO_DATABASE_URL && TURSO_AUTH_TOKEN);

const app = express();
const port = process.env.PORT || 3000;
const projectRoot = __dirname;
const publicDir = path.join(projectRoot, 'public');
const templatesDir = path.join(projectRoot, 'templates');
const tempDir = path.join(projectRoot, 'temp');
const dbPath = path.join(projectRoot, 'data.db');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const db = useTurso
  ? createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN })
  : new Database(dbPath);

const initDatabase = async () => {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS weekly_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date TEXT NOT NULL,
      prepared_by TEXT,
      project_module TEXT,
      total_issues INTEGER,
      critical_high INTEGER,
      in_progress INTEGER,
      resolved INTEGER,
      pending INTEGER,
      avg_res_critical_hrs REAL,
      avg_res_high_hrs REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `;

  if (useTurso) {
    await db.execute({ sql: createTableSql });
  } else {
    db.exec(createTableSql);
  }
};

initDatabase().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

function parseNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return `${String(date.getDate()).padStart(2, '0')} ${String(date.getMonth() + 1).padStart(2, '0')} ${date.getFullYear()}`;
}

function getPuppeteerExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const customPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return fs.existsSync(customPath) ? customPath : null;
  }

  const defaultPath = puppeteer.executablePath();
  if (defaultPath && fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/headless-chromium',
    '/opt/render/.cache/puppeteer',
    '/opt/render/.local-chromium',
    '/opt/render/.local-chromium/linux-*/chrome-linux/chrome',
    '/opt/render/.cache/puppeteer/chrome',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  const searchDirs = [
    '/opt/render/.cache/puppeteer',
    '/opt/render/.local-chromium',
    '/usr/bin',
    '/usr/local/bin',
  ];

  for (const dir of searchDirs) {
    const found = findExecutableRecursive(dir, ['chrome', 'chromium', 'headless-chromium']);
    if (found) {
      return found;
    }
  }

  return null;
}

function findExecutableRecursive(dir, names) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findExecutableRecursive(fullPath, names);
        if (found) {
          return found;
        }
      } else if (entry.isFile()) {
        const base = path.basename(fullPath).toLowerCase();
        if (names.includes(base) || names.some((name) => base.includes(name))) {
          return fullPath;
        }
      }
    }
  } catch (err) {
    return null;
  }

  return null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validatePayload(payload) {
  const errors = [];

  if (!payload.report_date) {
    errors.push('Report date is required.');
  }
  if (!payload.prepared_by) {
    errors.push('Prepared by is required.');
  }
  if (!payload.project_module) {
    errors.push('Project / module is required.');
  }
  if (!payload.tested_this_week) {
    errors.push('Tested this week is required.');
  }
  if (!payload.for_dev) {
    errors.push('For Dev (must-follow points) is required.');
  }
  if (!payload.next_week_focus) {
    errors.push('Next week focus is required.');
  }
  if (!payload.comm_clarity_rating) {
    errors.push('Communication Clarity rating is required.');
  }
  if (!payload.comm_clarity_sla) {
    errors.push('Communication Clarity SLA is required.');
  }
  if (!payload.responsiveness_rating) {
    errors.push('Responsiveness rating is required.');
  }
  if (!payload.responsiveness_sla) {
    errors.push('Responsiveness SLA is required.');
  }
  if (!payload.support_testing_rating) {
    errors.push('Support During Testing rating is required.');
  }
  if (!payload.support_testing_sla) {
    errors.push('Support During Testing SLA is required.');
  }
  if (!payload.fix_turnaround_rating) {
    errors.push('Fix Turnaround Time rating is required.');
  }
  if (!payload.fix_turnaround_sla) {
    errors.push('Fix Turnaround Time SLA is required.');
  }

  const numericFields = [
    'total_issues',
    'critical_high',
    'in_progress',
    'resolved',
    'pending',
    'avg_res_critical_hrs',
    'avg_res_high_hrs',
  ];

  numericFields.forEach((field) => {
    const value = parseNumber(payload[field]);
    if (value === null && payload[field] !== '' && payload[field] !== undefined && payload[field] !== null) {
      errors.push(`${field.replace(/_/g, ' ')} must be a number.`);
    }
  });

  return errors;
}

function renderTemplate(payload) {
  const templatePath = path.join(templatesDir, 'report-template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const values = {
    title_line_1: 'WEEKLY SQA REPORT — EXECUTIVE SUMMARY',
    title_line_2: `Week of ${formatDate(payload.report_date)} — ${formatDate(payload.report_date)}`,
    prepared_by: payload.prepared_by || 'N/A',
    project_module: payload.project_module || 'N/A',
    report_date: formatDate(payload.report_date),
    submitted_to: payload.submitted_to || 'N/A',
    summary_text: payload.tested_this_week || '',
    important_text: payload.for_dev || '',
    notes_text: payload.low_workload_activities || null,
    announcement_text: payload.announcement || null,
    next_week_text: payload.next_week_focus || '',
    notes_section: payload.low_workload_activities ? `<div class="body-section"><span class="label">NOTES</span> ${escapeHtml(payload.low_workload_activities)}</div>` : '',
    announcement_section: payload.announcement ? `<div class="body-section"><span class="label">Announcement</span> ${escapeHtml(payload.announcement)}</div>` : '',
    total_issues: payload.total_issues ?? 0,
    critical_high: payload.critical_high ?? 0,
    in_progress: payload.in_progress ?? 0,
    resolved: payload.resolved ?? 0,
    pending: payload.pending ?? 0,
    avg_res_critical_hrs: payload.avg_res_critical_hrs ?? 0,
    avg_res_high_hrs: payload.avg_res_high_hrs ?? 0,
  };

  Object.entries(values).forEach(([key, value]) => {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    const interpolated = typeof value === 'string' ? value : String(value);
    const replacement = key === 'notes_section' || key === 'announcement_section' ? value : escapeHtml(interpolated);
    html = html.replace(placeholder, replacement);
  });

  const collaborationRows = [
    { area: 'Communication Clarity', rating: payload.comm_clarity_rating || '[N/A]', sla: payload.comm_clarity_sla || '[N/A]' },
    { area: 'Responsiveness to Bug Reports', rating: payload.responsiveness_rating || '[N/A]', sla: payload.responsiveness_sla || '[N/A]' },
    { area: 'Support During Testing', rating: payload.support_testing_rating || '[N/A]', sla: payload.support_testing_sla || '[N/A]' },
    { area: 'Fix Turnaround Time', rating: payload.fix_turnaround_rating || '[N/A]', sla: payload.fix_turnaround_sla || '[N/A]' },
  ];

  const rowsHtml = collaborationRows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.area)}</td>
        <td>${escapeHtml(row.rating)}</td>
        <td>${escapeHtml(row.sla)}</td>
      </tr>
    `)
    .join('');
  html = html.replace('{{collaboration_rows}}', rowsHtml);

  // Insert mailto link if the submitted-to value looks like an email
  const submittedTo = payload.submitted_to || '';
  const submittedToHtml = submittedTo.includes('@')
    ? `<a href="mailto:${escapeHtml(submittedTo)}">${escapeHtml(submittedTo)}</a>`
    : escapeHtml(submittedTo);
  html = html.replace('{{submitted_to_html}}', submittedToHtml);

  return html;
}

async function fetchWeeklyMetrics() {
  if (useTurso) {
    const result = await db.execute({ sql: 'SELECT * FROM weekly_metrics ORDER BY report_date ASC' });
    return Array.isArray(result.rows) ? result.rows : [];
  }
  return db.prepare('SELECT * FROM weekly_metrics ORDER BY report_date ASC').all();
}

async function insertWeeklyMetric(payload) {
  if (useTurso) {
    const result = await db.execute({
      sql: `INSERT INTO weekly_metrics (
        report_date, prepared_by, project_module, total_issues, critical_high,
        in_progress, resolved, pending, avg_res_critical_hrs, avg_res_high_hrs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      args: [
        payload.report_date,
        payload.prepared_by || null,
        payload.project_module || null,
        parseNumber(payload.total_issues),
        parseNumber(payload.critical_high),
        parseNumber(payload.in_progress),
        parseNumber(payload.resolved),
        parseNumber(payload.pending),
        parseNumber(payload.avg_res_critical_hrs),
        parseNumber(payload.avg_res_high_hrs),
      ],
    });
    return { lastInsertRowid: Number(result.lastInsertRowid || 0n) };
  }

  const insert = db.prepare(`
      INSERT INTO weekly_metrics (
        report_date, prepared_by, project_module, total_issues, critical_high,
        in_progress, resolved, pending, avg_res_critical_hrs, avg_res_high_hrs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  return insert.run(
    payload.report_date,
    payload.prepared_by || null,
    payload.project_module || null,
    parseNumber(payload.total_issues),
    parseNumber(payload.critical_high),
    parseNumber(payload.in_progress),
    parseNumber(payload.resolved),
    parseNumber(payload.pending),
    parseNumber(payload.avg_res_critical_hrs),
    parseNumber(payload.avg_res_high_hrs)
  );
}

async function generateAiNarrative(payload) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured. Set GEMINI_API_KEY in your .env to enable AI rewriting.');
  }

  const promptBase = `You are an expert technical writer. Re-write these raw SQA weekly report sections into concise, professional executive-summary style text. Return a JSON object with these fields exactly: {"summary","important","notes","announcement","next_week_focus"} where each value is a short polished paragraph. Input JSON follows.\n\n`;
  const inputJson = JSON.stringify({
    tested_this_week: payload.tested_this_week || '',
    for_dev: payload.for_dev || '',
    low_workload_activities: payload.low_workload_activities || '',
    announcement: payload.announcement || '',
    next_week_focus: payload.next_week_focus || ''
  });

  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];

  async function attemptModel(modelName) {
    const prompt = promptBase + inputJson;
    const url = `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const body = {
      contents: [ { role: 'user', parts: [{ text: prompt }] } ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      let errText;
      try { errText = JSON.stringify(await resp.json()); } catch (e) { errText = await resp.text(); }
      const err = new Error(`Gemini model ${modelName} request failed with status ${resp.status}: ${errText}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();

    // extract generated text
    let generatedText = '';
    try {
      if (data.candidates && data.candidates[0]) {
        const cand = data.candidates[0];
        if (cand.content) {
          const parts = Array.isArray(cand.content) ? cand.content.flatMap(c => c.parts || []) : (cand.content.parts || []);
          generatedText = parts.map(p => p.text || p).join('\n');
        } else if (cand.output && cand.output[0] && cand.output[0].content) {
          generatedText = cand.output[0].content.map(c => c.text || '').join('\n');
        } else if (cand.output && typeof cand.output === 'string') {
          generatedText = cand.output;
        }
      } else if (data.output && Array.isArray(data.output) && data.output[0] && data.output[0].content) {
        generatedText = data.output[0].content.map(c => c.text || '').join('\n');
      }
    } catch (e) {
      generatedText = '';
    }

    return { model: modelName, text: generatedText };
  }

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const { model: usedModel, text } = await attemptModel(model);
      // Try parse JSON from the returned text
      let parsed = null;
      try { parsed = JSON.parse(text.trim()); } catch (e) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch (e2) { parsed = null; }
        }
      }

      if (parsed && typeof parsed === 'object') {
        return {
          tested_this_week: parsed.summary || parsed.summary_text || parsed.summaryText || payload.tested_this_week,
          for_dev: parsed.important || parsed.important_text || parsed.importantPoints || payload.for_dev,
          low_workload_activities: parsed.notes || parsed.notes_text || payload.low_workload_activities,
          announcement: parsed.announcement || payload.announcement,
          next_week_focus: parsed.next_week_focus || parsed.nextWeek || parsed.next_week || payload.next_week_focus,
        };
      }

      // Not JSON — return the full text into summary field
      return {
        tested_this_week: text || payload.tested_this_week,
        for_dev: payload.for_dev,
        low_workload_activities: payload.low_workload_activities,
        announcement: payload.announcement,
        next_week_focus: payload.next_week_focus,
      };
    } catch (err) {
      lastError = err;
      // If retriable status (503, 429, 502, 504) try next model, else break and rethrow
      const status = err && err.status ? Number(err.status) : null;
      if (status && [429, 503, 502, 504, 404].includes(status)) {
        console.warn(`Model ${model} failed with retriable status ${status}, trying next fallback if any.`);
        continue;
      }
      // non-retriable — rethrow
      throw err;
    }
  }

  // all models failed
  const finalErr = new Error(`All Gemini models failed. Last error: ${lastError ? lastError.message : 'unknown'}`);
  finalErr.cause = lastError;
  throw finalErr;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const rows = await fetchWeeklyMetrics();
    const months = new Map();

    rows.forEach((row) => {
      const monthKey = String(row.report_date).slice(0, 7);
      const bucket = months.get(monthKey) || { month: monthKey, resolved: 0, pending: row.pending ?? 0, weeks: [] };
      bucket.resolved += row.resolved || 0;
      bucket.pending = row.pending ?? bucket.pending;
      bucket.weeks.push({
        report_date: row.report_date,
        total_issues: row.total_issues || 0,
        resolved: row.resolved || 0,
        pending: row.pending || 0,
      });
      months.set(monthKey, bucket);
    });

    res.json({
      rows,
      monthly_rollup: Array.from(months.values()),
    });
  } catch (error) {
    console.error('Dashboard query failed:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard metrics.' });
  }
});

app.post('/generate-report', async (req, res) => {
  try {
    const payload = req.body;
    const validationErrors = validatePayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, error: validationErrors.join(' ') });
    }
    // If GEMINI_API_KEY is configured, attempt to rewrite the textual sections using Gemini
    if (GEMINI_API_KEY) {
      try {
        const aiRewrite = await generateAiNarrative(payload);
        // Merge AI rewritten fields into the payload used for rendering
        payload.tested_this_week = aiRewrite.tested_this_week || payload.tested_this_week;
        payload.for_dev = aiRewrite.for_dev || payload.for_dev;
        payload.low_workload_activities = aiRewrite.low_workload_activities || payload.low_workload_activities;
        payload.announcement = aiRewrite.announcement || payload.announcement;
        payload.next_week_focus = aiRewrite.next_week_focus || payload.next_week_focus;
      } catch (aiErr) {
        console.error('AI rewrite failed:', aiErr);
        return res.status(aiErr.status || 502).json({ success: false, error: aiErr.message || 'AI rewrite failed.' });
      }
    }

    const result = await insertWeeklyMetric(payload);

    const html = renderTemplate(payload);

    const timestamp = Date.now();
    const fileName = `report-${timestamp}-${result.lastInsertRowid}.pdf`;
    const outputPath = path.join(tempDir, fileName);

    const executablePath = getPuppeteerExecutablePath();
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '18mm',
        right: '18mm',
        bottom: '18mm',
        left: '18mm',
      },
    });
    await browser.close();

    res.json({ success: true, downloadUrl: `/download/${encodeURIComponent(fileName)}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate report.' });
  }
});

app.get('/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(tempDir, fileName);

  if (!fileName || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found.');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.download(filePath, fileName, (err) => {
    if (!err) {
      fs.unlinkSync(filePath);
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.listen(port, () => {
  console.log(`SQA report app running at http://localhost:${port}`);
});
