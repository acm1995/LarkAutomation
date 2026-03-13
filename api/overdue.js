/**
 * Vercel Serverless Function — /api/overdue
 * Returns overdue videos list
 */
const PipelineAnalytics = require('../src/analytics');
const LarkClient = require('../src/lark-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const client = new LarkClient();
    const analytics = new PipelineAnalytics(client);
    await analytics.loadData();
    res.json(analytics.getOverdueVideos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
