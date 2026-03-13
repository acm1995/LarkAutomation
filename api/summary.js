/**
 * Vercel Serverless Function — /api/summary
 * Returns full pipeline analytics summary
 */
const PipelineAnalytics = require('../src/analytics');
const LarkClient = require('../src/lark-client');

// Vercel-compatible cache (in-memory, reset on cold start)
let cachedSummary = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    if (cachedSummary && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedSummary);
    }

    const client = new LarkClient();
    const analytics = new PipelineAnalytics(client);
    cachedSummary = await analytics.getFullSummary();
    cacheTime = Date.now();
    res.json(cachedSummary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
