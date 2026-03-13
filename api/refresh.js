/**
 * Vercel Serverless Function — /api/refresh
 * Forces a fresh analytics pull (clears cache)
 */
const PipelineAnalytics = require('../src/analytics');
const LarkClient = require('../src/lark-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const client = new LarkClient();
    const analytics = new PipelineAnalytics(client);
    const summary = await analytics.getFullSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
