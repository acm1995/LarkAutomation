/**
 * TBH Pipeline — Dashboard Server
 * Express.js server serving pipeline analytics as a web dashboard
 */
const express = require('express');
const path = require('path');
const PipelineAnalytics = require('./analytics');
const LarkClient = require('./lark-client');
require('dotenv').config();

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

const client = new LarkClient();
const analytics = new PipelineAnalytics(client);

// Cache analytics for 5 minutes
let cachedSummary = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getSummary() {
  if (cachedSummary && Date.now() - cacheTime < CACHE_TTL) {
    return cachedSummary;
  }
  await analytics.loadData();
  cachedSummary = await analytics.getFullSummary();
  cacheTime = Date.now();
  return cachedSummary;
}

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.get('/api/summary', async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/refresh', async (req, res) => {
  try {
    cachedSummary = null;
    const summary = await getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/overdue', async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary.overdue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workload', async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary.workload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/approvals', async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary.pendingApprovals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  const chalk = require('chalk');
  console.log(chalk.cyan(`\n🚀 TBH Pipeline Dashboard running at ${chalk.bold(`http://localhost:${PORT}`)}`));
  console.log(chalk.gray('   Press Ctrl+C to stop\n'));

  // Auto-open browser
  const open = require('open');
  open(`http://localhost:${PORT}`);
});
