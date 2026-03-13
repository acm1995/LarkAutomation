/**
 * TBH Pipeline — Notification Monitor
 * Periodically checks Lark Base and sends alerts via Lark Messenger
 *
 * Usage:
 *   node src/notifier.js          # Start monitoring
 *   node src/notifier.js --test   # Send a test notification
 *   node src/notifier.js --once   # Run notification check once and exit
 */
const LarkClient = require('./lark-client');
const PipelineAnalytics = require('./analytics');
const Messenger = require('./messenger');
require('dotenv').config();

const INTERVAL_MS = (parseInt(process.env.NOTIFY_INTERVAL_MINUTES) || 30) * 60 * 1000;

class Notifier {
  constructor() {
    this.client = new LarkClient();
    this.analytics = new PipelineAnalytics(this.client);
    this.messenger = new Messenger(this.client);
    this.approverIds = (process.env.APPROVER_IDS || '').split(',').filter(Boolean);
    this.teamChatId = process.env.TEAM_CHAT_ID || null;
    this.lastNotified = {};
  }

  /**
   * Run a full notification cycle
   */
  async check() {
    const chalk = require('chalk');
    console.log(chalk.cyan(`\n[${new Date().toLocaleTimeString()}] 🔍 Running notification check...`));

    try {
      await this.analytics.loadData();
      const summary = await this.analytics.getFullSummary();

      let sent = 0;

      // 1. Pending Approvals — notify approvers
      if (summary.pendingApprovals.length > 0) {
        const newApprovals = summary.pendingApprovals.filter(
          v => !this.lastNotified[`approval-${v.recordId}`]
        );

        if (newApprovals.length > 0) {
          const card = this.messenger.buildApprovalCard(newApprovals);
          await this._sendToApprovers(card);
          newApprovals.forEach(v => (this.lastNotified[`approval-${v.recordId}`] = Date.now()));
          console.log(chalk.yellow(`   🔔 Sent approval alert for ${newApprovals.length} video(s)`));
          sent++;
        }
      }

      // 2. Overdue — notify team
      if (summary.overdue.length > 0) {
        const key = `overdue-${summary.overdue.length}`;
        // Re-notify overdue every 4 hours
        if (!this.lastNotified[key] || Date.now() - this.lastNotified[key] > 4 * 60 * 60 * 1000) {
          const card = this.messenger.buildOverdueCard(summary.overdue);
          await this._sendToTeam(card);
          this.lastNotified[key] = Date.now();
          console.log(chalk.red(`   🚨 Sent overdue alert for ${summary.overdue.length} video(s)`));
          sent++;
        }
      }

      // 3. Approaching deadlines (within 2 days)
      const urgentDeadlines = summary.upcoming.filter(v => v.daysLeft <= 2);
      if (urgentDeadlines.length > 0) {
        const newUrgent = urgentDeadlines.filter(
          v => !this.lastNotified[`deadline-${v.recordId}`]
        );

        if (newUrgent.length > 0) {
          const card = this.messenger.buildDeadlineWarningCard(newUrgent);
          await this._sendToTeam(card);
          newUrgent.forEach(v => (this.lastNotified[`deadline-${v.recordId}`] = Date.now()));
          console.log(chalk.yellow(`   ⏰ Sent deadline warning for ${newUrgent.length} video(s)`));
          sent++;
        }
      }

      // 4. Revision loop warning (3+ revisions)
      const revisionItems = summary.revisions.items.filter(
        v => v.revisionCount !== 'N/A' && parseInt(v.revisionCount) >= 3
      );
      if (revisionItems.length > 0) {
        const newRevisions = revisionItems.filter(
          v => !this.lastNotified[`revision-${v.recordId}`]
        );

        if (newRevisions.length > 0) {
          const card = this.messenger.buildRevisionWarningCard(newRevisions);
          await this._sendToTeam(card);
          newRevisions.forEach(v => (this.lastNotified[`revision-${v.recordId}`] = Date.now()));
          console.log(chalk.magenta(`   🔄 Sent revision warning for ${newRevisions.length} video(s)`));
          sent++;
        }
      }

      if (sent === 0) {
        console.log(chalk.gray('   ✅ No new notifications to send'));
      }

      return summary;
    } catch (err) {
      console.error(chalk.red(`   ❌ Error: ${err.message}`));
      throw err;
    }
  }

  /**
   * Send daily summary to team chat
   */
  async sendDailySummary() {
    const chalk = require('chalk');
    console.log(chalk.cyan('\n📋 Sending daily summary...'));

    await this.analytics.loadData();
    const summary = await this.analytics.getFullSummary();
    const card = this.messenger.buildDailySummaryCard(summary);

    await this._sendToTeam(card);
    console.log(chalk.green('   ✅ Daily summary sent!'));
  }

  /**
   * Send a test notification to verify connection
   */
  async sendTestNotification() {
    const chalk = require('chalk');
    console.log(chalk.cyan('\n🧪 Sending test notification...'));

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🧪 TBH Pipeline Bot — Test Notification' },
        template: 'green',
      },
      elements: [{
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '✅ **Connection successful!**\nYour TBH Pipeline Bot is connected and ready to send notifications.\n\nYou will receive:\n• 🔔 Approval alerts\n• 🚨 Overdue warnings\n• ⏰ Deadline reminders\n• 🔄 Revision loop alerts\n• 📋 Daily pipeline summaries',
        },
      }],
    };

    await this._sendToTeam(card);
    console.log(chalk.green('   ✅ Test notification sent! Check your Lark Messenger.'));
  }

  // ─── Internal ──────────────────────────────────────────────────────

  async _sendToApprovers(card) {
    for (const userId of this.approverIds) {
      try {
        await this.messenger.sendCard(userId.trim(), card, 'open_id');
      } catch (err) {
        console.warn(`   ⚠️ Failed to send to approver ${userId}: ${err.message}`);
      }
    }
    // Also send to team chat
    await this._sendToTeam(card);
  }

  async _sendToTeam(card) {
    if (!this.teamChatId) {
      console.warn('   ⚠️ TEAM_CHAT_ID not set — skipping team notification. Set it in .env');
      return;
    }
    try {
      await this.messenger.sendCard(this.teamChatId, card);
    } catch (err) {
      console.warn(`   ⚠️ Failed to send to team chat: ${err.message}`);
    }
  }

  /**
   * Start continuous monitoring
   */
  async startMonitoring() {
    const chalk = require('chalk');
    console.log(chalk.cyan.bold('\n🤖 TBH Pipeline Notification Monitor'));
    console.log(chalk.gray(`   Checking every ${process.env.NOTIFY_INTERVAL_MINUTES || 30} minutes`));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    // Run immediately
    await this.check();

    // Then on interval
    setInterval(() => this.check(), INTERVAL_MS);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const notifier = new Notifier();

  if (process.argv.includes('--test')) {
    await notifier.sendTestNotification();
  } else if (process.argv.includes('--once')) {
    await notifier.check();
  } else if (process.argv.includes('--daily')) {
    await notifier.sendDailySummary();
  } else {
    await notifier.startMonitoring();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = Notifier;
