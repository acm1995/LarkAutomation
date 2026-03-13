/**
 * TBH Pipeline — Analytics Engine
 * Computes pipeline metrics from Lark Base Content Calendar data
 */
const LarkClient = require('./lark-client');
require('dotenv').config();

const PIPELINE_STAGES = [
  'Idea',
  'In Development',
  'Pending Script Approval',
  'Revising Script',
  'To Shoot',
  'To Edit',
  'Editing',
  'Pending Video Approval',
  'Revising Video',
  'Approved',
  'Scheduled',
];

const APPROVAL_STAGES = ['Pending Script Approval', 'Pending Video Approval'];
const REVISION_STAGES = ['Revising Script', 'Revising Video'];
const BLOCKED_STAGES = [...APPROVAL_STAGES, ...REVISION_STAGES];
const DONE_STAGES = ['Approved', 'Scheduled'];

class PipelineAnalytics {
  constructor(client) {
    this.client = client || new LarkClient();
    this.tableId = process.env.LARK_TABLE_CONTENT_CALENDAR;
    this.records = [];
    this.fields = [];
  }

  async loadData() {
    this.records = await this.client.getAllRecords(this.tableId);
    this.fields = await this.client.listFields(this.tableId);
    return this.records;
  }

  // ─── Stage Analysis ────────────────────────────────────────────────

  getVideosPerStage() {
    const counts = {};
    PIPELINE_STAGES.forEach(s => (counts[s] = 0));
    counts['Uncategorized'] = 0;
    counts['Cancelled'] = 0;

    this.records.forEach(r => {
      const status = (this._getField(r, 'Status') || 'Uncategorized').trim();
      if (counts[status] !== undefined) counts[status]++;
      else counts['Uncategorized']++;
    });

    return counts;
  }

  getBottlenecks() {
    const stageCounts = this.getVideosPerStage();
    return BLOCKED_STAGES
      .map(stage => ({ stage, count: stageCounts[stage] || 0 }))
      .sort((a, b) => b.count - a.count);
  }

  // ─── Deadline Analysis ─────────────────────────────────────────────

  getOverdueVideos() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    return this.records
      .filter(r => {
        const status = this._getField(r, 'Status');
        if (DONE_STAGES.includes(status) || status === 'Cancelled') return false;

        const deadline = this._getDateField(r, 'Deadline');
        if (!deadline) return false;

        return deadline < now;
      })
      .map(r => {
        const deadline = this._getDateField(r, 'Deadline');
        const daysOverdue = Math.floor((Date.now() - deadline.getTime()) / (1000 * 60 * 60 * 24));
        return {
          recordId: r.record_id,
          title: this._getField(r, 'Title') || '(untitled)',
          status: this._getField(r, 'Status') || '(none)',
          deadline: deadline.toISOString().split('T')[0],
          daysOverdue,
          creator: this._getPersonField(r, 'Creator'),
          editor: this._getPersonField(r, 'Video Editor'),
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  getUpcomingDeadlines(daysAhead = 3) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return this.records
      .filter(r => {
        const status = this._getField(r, 'Status');
        if (DONE_STAGES.includes(status) || status === 'Cancelled') return false;

        const deadline = this._getDateField(r, 'Deadline');
        if (!deadline) return false;

        return deadline >= now && deadline <= cutoff;
      })
      .map(r => {
        const deadline = this._getDateField(r, 'Deadline');
        const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return {
          recordId: r.record_id,
          title: this._getField(r, 'Title') || '(untitled)',
          status: this._getField(r, 'Status') || '(none)',
          deadline: deadline.toISOString().split('T')[0],
          daysLeft,
          creator: this._getPersonField(r, 'Creator'),
          editor: this._getPersonField(r, 'Video Editor'),
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  // ─── Workload Analysis ─────────────────────────────────────────────

  getWorkloadByPerson() {
    const workload = {};

    this.records.forEach(r => {
      const status = this._getField(r, 'Status');
      if (DONE_STAGES.includes(status) || status === 'Cancelled' || status === 'Idea') return;

      const creators = this._getPersonField(r, 'Creator');
      const editors = this._getPersonField(r, 'Video Editor');

      const addWork = (name, role) => {
        if (!workload[name]) workload[name] = { total: 0, byStage: {}, role };
        workload[name].total++;
        workload[name].byStage[status] = (workload[name].byStage[status] || 0) + 1;
      };

      if (Array.isArray(creators)) creators.forEach(c => addWork(c, 'Creator'));
      else if (creators) addWork(creators, 'Creator');

      if (Array.isArray(editors)) editors.forEach(e => addWork(e, 'Editor'));
      else if (editors) addWork(editors, 'Editor');
    });

    return Object.entries(workload)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }

  // ─── Output Rate ───────────────────────────────────────────────────

  getOutputRate(weeks = 4) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    const weeklyBuckets = {};

    this.records.forEach(r => {
      const status = this._getField(r, 'Status');
      if (!DONE_STAGES.includes(status) && status !== 'Scheduled') return;

      const uploadDate = this._getDateField(r, 'Actual Upload Date') || this._getDateField(r, 'Deadline');
      if (!uploadDate || uploadDate < cutoff) return;

      const weekStart = new Date(uploadDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      weeklyBuckets[weekKey] = (weeklyBuckets[weekKey] || 0) + 1;
    });

    const weeklyOutputs = Object.entries(weeklyBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({ week, count }));

    const avgPerWeek = weeklyOutputs.length > 0
      ? weeklyOutputs.reduce((sum, w) => sum + w.count, 0) / weeklyOutputs.length
      : 0;

    return { weeklyOutputs, avgPerWeek, target: 5 };
  }

  // ─── Pending Approvals ─────────────────────────────────────────────

  getPendingApprovals() {
    return this.records
      .filter(r => APPROVAL_STAGES.includes(this._getField(r, 'Status')))
      .map(r => ({
        recordId: r.record_id,
        title: this._getField(r, 'Title') || '(untitled)',
        status: this._getField(r, 'Status'),
        creator: this._getPersonField(r, 'Creator'),
        editor: this._getPersonField(r, 'Video Editor'),
        deadline: this._getDateField(r, 'Deadline')?.toISOString().split('T')[0] || 'No deadline',
        scriptLink: this._getField(r, 'Script Link'),
      }))
      .sort((a, b) => (a.deadline || 'z').localeCompare(b.deadline || 'z'));
  }

  // ─── Revision Analysis ─────────────────────────────────────────────

  getRevisionStats() {
    const inRevision = this.records.filter(r =>
      REVISION_STAGES.includes(this._getField(r, 'Status'))
    );

    return {
      currentlyInRevision: inRevision.length,
      scriptRevisions: inRevision.filter(r => this._getField(r, 'Status') === 'Revising Script').length,
      videoRevisions: inRevision.filter(r => this._getField(r, 'Status') === 'Revising Video').length,
      items: inRevision.map(r => ({
        recordId: r.record_id,
        title: this._getField(r, 'Title') || '(untitled)',
        status: this._getField(r, 'Status'),
        creator: this._getPersonField(r, 'Creator'),
        editor: this._getPersonField(r, 'Video Editor'),
        revisionCount: this._getField(r, 'Script Revision Count') || this._getField(r, 'Video Revision Count') || 'N/A',
      })),
    };
  }

  // ─── Full Summary ──────────────────────────────────────────────────

  async getFullSummary() {
    if (this.records.length === 0) await this.loadData();

    return {
      totalRecords: this.records.length,
      videosPerStage: this.getVideosPerStage(),
      bottlenecks: this.getBottlenecks(),
      overdue: this.getOverdueVideos(),
      upcoming: this.getUpcomingDeadlines(3),
      workload: this.getWorkloadByPerson(),
      outputRate: this.getOutputRate(),
      pendingApprovals: this.getPendingApprovals(),
      revisions: this.getRevisionStats(),
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────

  _getField(record, fieldName) {
    const val = record.fields?.[fieldName];
    if (val === undefined || val === null) return null;
    if (typeof val === 'object' && !Array.isArray(val) && val.text !== undefined) return val.text;
    if (typeof val === 'object' && val.link) return val.link;
    return val;
  }

  _getDateField(record, fieldName) {
    const val = record.fields?.[fieldName];
    if (!val) return null;
    // Lark returns dates as timestamps in ms
    if (typeof val === 'number') return new Date(val);
    if (typeof val === 'string') return new Date(val);
    return null;
  }

  _getPersonField(record, fieldName) {
    const val = record.fields?.[fieldName];
    if (!val) return null;
    if (Array.isArray(val)) return val.map(v => v.name || v.en_name || v.id).filter(Boolean);
    if (typeof val === 'object' && val.name) return [val.name];
    return null;
  }
}

// ─── CLI Mode ────────────────────────────────────────────────────────

async function runCLI() {
  const chalk = require('chalk');
  const Table = require('cli-table3');

  console.log(chalk.cyan('\n📊 TBH Pipeline Analytics\n'));

  const analytics = new PipelineAnalytics();
  const summary = await analytics.getFullSummary();

  // Stage counts
  console.log(chalk.bold.white('📋 Videos Per Stage:'));
  const stageTable = new Table({ head: ['Stage', 'Count'] });
  Object.entries(summary.videosPerStage).forEach(([stage, count]) => {
    if (count > 0) stageTable.push([stage, count]);
  });
  console.log(stageTable.toString());

  // Bottlenecks
  console.log(chalk.bold.yellow('\n⚠️  Bottlenecks (blocked stages):'));
  summary.bottlenecks.forEach(b => {
    const bar = '█'.repeat(b.count);
    console.log(chalk.yellow(`   ${b.stage.padEnd(25)} ${bar} ${b.count}`));
  });

  // Overdue
  if (summary.overdue.length > 0) {
    console.log(chalk.bold.red(`\n🚨 Overdue Videos (${summary.overdue.length}):`));
    summary.overdue.slice(0, 10).forEach(v => {
      console.log(chalk.red(`   ❌ "${v.title}" — ${v.daysOverdue}d overdue (${v.status})`));
    });
  }

  // Upcoming
  if (summary.upcoming.length > 0) {
    console.log(chalk.bold.yellow(`\n⏰ Upcoming Deadlines (${summary.upcoming.length}):`));
    summary.upcoming.slice(0, 10).forEach(v => {
      console.log(chalk.yellow(`   ⚡ "${v.title}" — ${v.daysLeft}d left (${v.status})`));
    });
  }

  // Workload
  console.log(chalk.bold.white('\n👥 Workload By Person:'));
  const loadTable = new Table({ head: ['Person', 'Active Videos', 'Stages'] });
  summary.workload.forEach(w => {
    const stages = Object.entries(w.byStage).map(([s, c]) => `${s}: ${c}`).join(', ');
    loadTable.push([w.name, w.total, stages]);
  });
  console.log(loadTable.toString());

  // Pending approvals
  if (summary.pendingApprovals.length > 0) {
    console.log(chalk.bold.magenta(`\n🔔 Pending Approvals (${summary.pendingApprovals.length}):`));
    summary.pendingApprovals.forEach(v => {
      console.log(chalk.magenta(`   📝 "${v.title}" — ${v.status} (deadline: ${v.deadline})`));
    });
  }

  // Output rate
  console.log(chalk.bold.green(`\n📈 Output Rate (avg: ${summary.outputRate.avgPerWeek.toFixed(1)}/week, target: ${summary.outputRate.target}/week)`));

  console.log(chalk.cyan('\n✨ Analysis complete.\n'));
}

if (require.main === module) {
  runCLI().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = PipelineAnalytics;
