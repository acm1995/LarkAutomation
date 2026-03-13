/**
 * TBH Pipeline — Lark Messenger Wrapper
 * Sends notifications and message cards via Lark Bot API
 */
const LarkClient = require('./lark-client');

class Messenger {
  constructor(client) {
    this.client = client || new LarkClient();
  }

  /**
   * Send a simple text message to a chat or user
   */
  async sendText(receiveId, text, idType = 'chat_id') {
    return this.client.sendMessage(idType, receiveId, 'text', JSON.stringify({ text }));
  }

  /**
   * Send a rich message card (interactive)
   */
  async sendCard(receiveId, card, idType = 'chat_id') {
    return this.client.sendMessage(idType, receiveId, 'interactive', JSON.stringify(card));
  }

  // ─── Pre-built Card Templates ──────────────────────────────────────

  /**
   * Build a "Pending Approval" notification card
   */
  buildApprovalCard(videos) {
    const elements = videos.map(v => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📝 ${v.title}**\n${v.status} · Creator: ${this._formatPeople(v.creator)} · Deadline: ${v.deadline}${v.scriptLink ? `\n[Open Script](${v.scriptLink})` : ''}`,
      },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🔔 ${videos.length} Video(s) Awaiting Your Approval` },
        template: 'orange',
      },
      elements,
    };
  }

  /**
   * Build an "Overdue" alert card
   */
  buildOverdueCard(videos) {
    const elements = videos.slice(0, 10).map(v => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🚨 ${v.title}** — ${v.daysOverdue} day(s) overdue\nStatus: ${v.status} · ${this._formatPeople(v.creator)}`,
      },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🚨 ${videos.length} Overdue Video(s)` },
        template: 'red',
      },
      elements,
    };
  }

  /**
   * Build a "Deadline Warning" card
   */
  buildDeadlineWarningCard(videos) {
    const elements = videos.map(v => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**⏰ ${v.title}** — ${v.daysLeft} day(s) left\nStatus: ${v.status} · ${this._formatPeople(v.creator)}`,
      },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `⚠️ ${videos.length} Video(s) With Approaching Deadlines` },
        template: 'yellow',
      },
      elements,
    };
  }

  /**
   * Build a "Revision Loop" warning card
   */
  buildRevisionWarningCard(videos) {
    const elements = videos.map(v => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🔄 ${v.title}** — Revision #${v.revisionCount || '3+'}\nStatus: ${v.status} · ${this._formatPeople(v.creator)}\n💡 *Consider scheduling a quick sync call instead of another async revision*`,
      },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🔄 ${videos.length} Video(s) In Revision Loop` },
        template: 'purple',
      },
      elements,
    };
  }

  /**
   * Build a daily summary card
   */
  buildDailySummaryCard(summary) {
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const sections = [];

    // Approvals needed
    if (summary.pendingApprovals.length > 0) {
      sections.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🔔 Pending Approvals (${summary.pendingApprovals.length})**\n${summary.pendingApprovals.slice(0, 5).map(v => `• ${v.title} (${v.status})`).join('\n')}`,
        },
      });
    }

    // Overdue
    if (summary.overdue.length > 0) {
      sections.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🚨 Overdue (${summary.overdue.length})**\n${summary.overdue.slice(0, 5).map(v => `• ${v.title} — ${v.daysOverdue}d overdue`).join('\n')}`,
        },
      });
    }

    // Upcoming deadlines
    if (summary.upcoming.length > 0) {
      sections.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**⏰ Due Soon (${summary.upcoming.length})**\n${summary.upcoming.slice(0, 5).map(v => `• ${v.title} — ${v.daysLeft}d left`).join('\n')}`,
        },
      });
    }

    // Bottlenecks
    const bottlenecks = summary.bottlenecks.filter(b => b.count > 0);
    if (bottlenecks.length > 0) {
      sections.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📊 Bottlenecks**\n${bottlenecks.map(b => `• ${b.stage}: ${b.count} videos`).join('\n')}`,
        },
      });
    }

    // Output rate
    sections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📈 Output Rate:** ${summary.outputRate.avgPerWeek.toFixed(1)} videos/week (target: 5+)`,
      },
    });

    if (sections.length === 0) {
      sections.push({
        tag: 'div',
        text: { tag: 'lark_md', content: '✅ All clear — no blockers today!' },
      });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `📋 Daily Pipeline Summary — ${dayStr}` },
        template: 'blue',
      },
      elements: sections,
    };
  }

  _formatPeople(people) {
    if (!people) return 'Unassigned';
    if (Array.isArray(people)) return people.join(', ');
    return people;
  }
}

module.exports = Messenger;
