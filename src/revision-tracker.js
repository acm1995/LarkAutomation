/**
 * TBH Pipeline — Revision Tracker
 * Monitors status changes and increments revision counts
 *
 * Usage:
 *   node src/revision-tracker.js          # Start monitoring for status changes
 *   node src/revision-tracker.js --scan   # One-time scan to set initial revision counts
 */
const LarkClient = require('./lark-client');
require('dotenv').config();

const client = new LarkClient();
const tableId = process.env.LARK_TABLE_CONTENT_CALENDAR;

const POLL_INTERVAL = 2 * 60 * 1000; // Check every 2 minutes

class RevisionTracker {
  constructor() {
    this.previousStates = new Map(); // recordId -> status
  }

  /**
   * Load current states for comparison
   */
  async loadStates() {
    const records = await client.getAllRecords(tableId);
    const states = new Map();

    records.forEach(r => {
      const status = r.fields?.['Status'];
      const statusStr = typeof status === 'object' && status?.text ? status.text :
                        typeof status === 'string' ? status : null;
      states.set(r.record_id, {
        status: statusStr,
        scriptRevisions: r.fields?.['Script Revision Count'] || 0,
        videoRevisions: r.fields?.['Video Revision Count'] || 0,
        title: r.fields?.['Title'] || '(untitled)',
      });
    });

    return { records, states };
  }

  /**
   * Check for status transitions and increment revision counts
   */
  async checkTransitions() {
    const chalk = require('chalk');
    const { records, states } = await this.loadStates();

    if (this.previousStates.size === 0) {
      this.previousStates = states;
      console.log(chalk.gray(`   📸 Captured initial state of ${states.size} records`));
      return;
    }

    const updates = [];

    for (const [recordId, current] of states) {
      const prev = this.previousStates.get(recordId);
      if (!prev || prev.status === current.status) continue;

      // Detect revision transitions
      // Script revision: "Revising Script" → "Pending Script Approval" means a revision was completed
      if (prev.status === 'Revising Script' && current.status === 'Pending Script Approval') {
        const newCount = (current.scriptRevisions || 0) + 1;
        updates.push({
          record_id: recordId,
          fields: { 'Script Revision Count': newCount },
        });
        console.log(chalk.yellow(`   🔄 "${current.title}" — Script revision #${newCount}`));

        if (newCount >= 3) {
          console.log(chalk.red(`   ⚠️  "${current.title}" hit ${newCount} script revisions — consider a sync call!`));
        }
      }

      // Video revision: "Revising Video" → "Pending Video Approval"
      if (prev.status === 'Revising Video' && current.status === 'Pending Video Approval') {
        const newCount = (current.videoRevisions || 0) + 1;
        updates.push({
          record_id: recordId,
          fields: { 'Video Revision Count': newCount },
        });
        console.log(chalk.yellow(`   🔄 "${current.title}" — Video revision #${newCount}`));

        if (newCount >= 3) {
          console.log(chalk.red(`   ⚠️  "${current.title}" hit ${newCount} video revisions — consider a sync call!`));
        }
      }

      // Log any status change
      if (prev.status !== current.status) {
        console.log(chalk.gray(`   📋 "${current.title}": ${prev.status} → ${current.status}`));
      }
    }

    // Apply updates
    if (updates.length > 0) {
      await client.batchUpdateRecords(tableId, updates);
      console.log(chalk.green(`   ✅ Updated ${updates.length} revision count(s)`));
    }

    this.previousStates = states;
  }

  /**
   * One-time scan to analyze revision patterns from historical data
   */
  async analyzeHistory() {
    const chalk = require('chalk');
    const Table = require('cli-table3');

    console.log(chalk.cyan('\n🔍 Revision Pattern Analysis\n'));

    const { records } = await this.loadStates();

    // Count videos currently in revision stages
    const inRevision = records.filter(r => {
      const status = r.fields?.['Status'];
      const st = typeof status === 'object' ? status?.text : status;
      return st === 'Revising Script' || st === 'Revising Video';
    });

    console.log(chalk.white(`   Videos currently in revision: ${inRevision.length}`));

    if (inRevision.length > 0) {
      const table = new Table({
        head: ['Title', 'Stage', 'Script Rev', 'Video Rev'],
      });

      inRevision.forEach(r => {
        const title = (r.fields?.['Title'] || '(untitled)').substring(0, 40);
        const status = typeof r.fields?.['Status'] === 'object' ? r.fields['Status'].text : r.fields?.['Status'];
        const scriptRev = r.fields?.['Script Revision Count'] || 0;
        const videoRev = r.fields?.['Video Revision Count'] || 0;
        table.push([title, status, scriptRev, videoRev]);
      });

      console.log(table.toString());
    }

    // Summary stats
    let totalScriptRevisions = 0;
    let totalVideoRevisions = 0;
    let maxScriptRevisions = 0;
    let maxVideoRevisions = 0;

    records.forEach(r => {
      const sr = r.fields?.['Script Revision Count'] || 0;
      const vr = r.fields?.['Video Revision Count'] || 0;
      totalScriptRevisions += sr;
      totalVideoRevisions += vr;
      maxScriptRevisions = Math.max(maxScriptRevisions, sr);
      maxVideoRevisions = Math.max(maxVideoRevisions, vr);
    });

    console.log(chalk.white('\n   Revision Statistics:'));
    console.log(chalk.gray(`   Total script revisions: ${totalScriptRevisions} (max per video: ${maxScriptRevisions})`));
    console.log(chalk.gray(`   Total video revisions: ${totalVideoRevisions} (max per video: ${maxVideoRevisions})`));
    console.log('');
  }

  /**
   * Start continuous monitoring
   */
  async start() {
    const chalk = require('chalk');
    console.log(chalk.cyan.bold('\n🔄 TBH Revision Tracker'));
    console.log(chalk.gray(`   Polling every ${POLL_INTERVAL / 1000}s for status changes`));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    await this.checkTransitions();
    setInterval(() => this.checkTransitions(), POLL_INTERVAL);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const tracker = new RevisionTracker();

  if (process.argv.includes('--scan')) {
    await tracker.analyzeHistory();
  } else {
    await tracker.start();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = RevisionTracker;
