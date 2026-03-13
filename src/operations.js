/**
 * TBH Pipeline — Operations Scripts
 * Bulk pipeline operations for managing the Content Calendar
 *
 * Usage:
 *   node src/operations.js suggest-editor     # Suggest least-loaded editor for "To Edit" videos
 *   node src/operations.js overdue-report      # Export overdue videos report
 *   node src/operations.js status-report       # Full pipeline status export
 *   node src/operations.js shift-deadlines <days>  # Shift all active deadlines by N days
 */
const LarkClient = require('./lark-client');
const PipelineAnalytics = require('./analytics');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new LarkClient();
const analytics = new PipelineAnalytics(client);
const tableId = process.env.LARK_TABLE_CONTENT_CALENDAR;

// ─── Suggest Editor ──────────────────────────────────────────────────

async function suggestEditor() {
  const chalk = require('chalk');
  console.log(chalk.cyan('\n🎯 Auto-Assign Editor Suggestions\n'));

  await analytics.loadData();

  // Find all "To Edit" videos without an editor
  const toEdit = analytics.records.filter(r => {
    const status = analytics._getField(r, 'Status');
    const editor = analytics._getPersonField(r, 'Video Editor');
    return status === 'To Edit' && (!editor || editor.length === 0);
  });

  if (toEdit.length === 0) {
    console.log(chalk.green('   ✅ All "To Edit" videos already have editors assigned.'));
    return;
  }

  // Get workload per editor
  const workload = analytics.getWorkloadByPerson();
  const editors = workload.filter(w => {
    // Check if this person has ever been an editor (check byStage for editing-related stages)
    return w.byStage['Editing'] || w.byStage['To Edit'] || w.byStage['Pending Video Approval'] ||
           w.byStage['Revising Video'] || w.role === 'Editor';
  });

  if (editors.length === 0) {
    console.log(chalk.yellow('   ⚠️ No editors found in workload data. Showing all team members instead.'));
    workload.forEach(w => {
      console.log(chalk.white(`   👤 ${w.name} — ${w.total} active videos`));
    });
    return;
  }

  // Sort by least loaded
  editors.sort((a, b) => a.total - b.total);

  console.log(chalk.white('   Videos needing an editor:'));
  toEdit.forEach((r, i) => {
    const title = analytics._getField(r, 'Title') || '(untitled)';
    const suggestedEditor = editors[i % editors.length]; // Round-robin least loaded
    console.log(chalk.white(`\n   ${i + 1}. "${title}"`));
    console.log(chalk.green(`      → Suggested: ${suggestedEditor.name} (${suggestedEditor.total} active videos)`));
    console.log(chalk.gray(`      Record ID: ${r.record_id}`));
  });

  console.log(chalk.cyan(`\n   💡 To auto-assign, run: node src/operations.js assign-editor <recordId> <editorName>\n`));
}

// ─── Status Report Export ────────────────────────────────────────────

async function statusReport() {
  const chalk = require('chalk');
  console.log(chalk.cyan('\n📊 Generating Pipeline Status Report...\n'));

  const summary = await analytics.getFullSummary();

  const report = {
    generatedAt: summary.generatedAt,
    totalRecords: summary.totalRecords,
    videosPerStage: summary.videosPerStage,
    bottlenecks: summary.bottlenecks,
    overdueCount: summary.overdue.length,
    overdueVideos: summary.overdue,
    upcomingDeadlines: summary.upcoming,
    workload: summary.workload,
    pendingApprovals: summary.pendingApprovals,
    outputRate: summary.outputRate,
    revisions: summary.revisions,
  };

  // Save JSON report
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const dateStr = new Date().toISOString().split('T')[0];
  const jsonPath = path.join(reportsDir, `pipeline-report-${dateStr}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(chalk.green(`   ✅ JSON report saved: ${jsonPath}`));

  // Save CSV summary
  const csvRows = [
    ['Title', 'Status', 'Deadline', 'Creator', 'Editor', 'Days Overdue'].join(','),
  ];

  analytics.records.forEach(r => {
    const title = (analytics._getField(r, 'Title') || '').replace(/,/g, ';');
    const status = analytics._getField(r, 'Status') || '';
    const deadline = analytics._getDateField(r, 'Deadline');
    const deadlineStr = deadline ? deadline.toISOString().split('T')[0] : '';
    const creator = (analytics._getPersonField(r, 'Creator') || []).join('; ');
    const editor = (analytics._getPersonField(r, 'Video Editor') || []).join('; ');

    let daysOverdue = '';
    if (deadline && deadline < new Date() && !['Approved', 'Scheduled', 'Cancelled'].includes(status)) {
      daysOverdue = Math.floor((Date.now() - deadline.getTime()) / (1000 * 60 * 60 * 24));
    }

    csvRows.push([`"${title}"`, status, deadlineStr, `"${creator}"`, `"${editor}"`, daysOverdue].join(','));
  });

  const csvPath = path.join(reportsDir, `pipeline-report-${dateStr}.csv`);
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(chalk.green(`   ✅ CSV report saved: ${csvPath}`));

  // Print summary
  console.log(chalk.white(`\n   📋 Summary:`));
  console.log(chalk.white(`      Total videos: ${summary.totalRecords}`));
  console.log(chalk.red(`      Overdue: ${summary.overdue.length}`));
  console.log(chalk.yellow(`      Pending approval: ${summary.pendingApprovals.length}`));
  console.log(chalk.magenta(`      In revision: ${summary.revisions.currentlyInRevision}`));
  console.log(chalk.green(`      Avg output: ${summary.outputRate.avgPerWeek.toFixed(1)}/week`));
  console.log('');
}

// ─── Overdue Report ──────────────────────────────────────────────────

async function overdueReport() {
  const chalk = require('chalk');
  const Table = require('cli-table3');

  console.log(chalk.cyan('\n🚨 Overdue Videos Report\n'));
  await analytics.loadData();

  const overdue = analytics.getOverdueVideos();
  if (overdue.length === 0) {
    console.log(chalk.green('   ✅ No overdue videos!'));
    return;
  }

  const table = new Table({
    head: ['Title', 'Status', 'Deadline', 'Days Over', 'Creator', 'Editor'],
    colWidths: [35, 22, 12, 10, 18, 18],
  });

  overdue.forEach(v => {
    table.push([
      v.title.substring(0, 33),
      v.status,
      v.deadline,
      v.daysOverdue,
      (v.creator || []).join(', ').substring(0, 16),
      (v.editor || []).join(', ').substring(0, 16),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.red(`\n   Total overdue: ${overdue.length}\n`));
}

// ─── Shift Deadlines ─────────────────────────────────────────────────

async function shiftDeadlines(days) {
  const chalk = require('chalk');
  console.log(chalk.cyan(`\n📅 Shifting active deadlines by ${days} day(s)...\n`));

  await analytics.loadData();

  const activeRecords = analytics.records.filter(r => {
    const status = analytics._getField(r, 'Status');
    return !['Approved', 'Scheduled', 'Cancelled', 'Idea'].includes(status);
  });

  const updates = [];
  activeRecords.forEach(r => {
    const deadline = analytics._getDateField(r, 'Deadline');
    if (!deadline) return;

    const newDeadline = new Date(deadline.getTime() + days * 24 * 60 * 60 * 1000);
    updates.push({
      record_id: r.record_id,
      fields: { Deadline: newDeadline.getTime() },
    });
  });

  if (updates.length === 0) {
    console.log(chalk.yellow('   ⚠️ No active videos with deadlines found.'));
    return;
  }

  console.log(chalk.yellow(`   ⚠️ This will update ${updates.length} records.`));
  console.log(chalk.yellow(`   Run with --confirm to apply changes.\n`));

  if (process.argv.includes('--confirm')) {
    await client.batchUpdateRecords(tableId, updates);
    console.log(chalk.green(`   ✅ Updated ${updates.length} deadlines!\n`));
  }
}

// ─── CLI Router ──────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'suggest-editor':
      await suggestEditor();
      break;
    case 'status-report':
      await statusReport();
      break;
    case 'overdue-report':
      await overdueReport();
      break;
    case 'shift-deadlines':
      const days = parseInt(process.argv[3]) || 1;
      await shiftDeadlines(days);
      break;
    default:
      const chalk = require('chalk');
      console.log(chalk.cyan('\n🛠️  TBH Pipeline Operations\n'));
      console.log(chalk.white('Available commands:'));
      console.log(chalk.gray('   suggest-editor        Suggest least-loaded editors for unassigned videos'));
      console.log(chalk.gray('   status-report         Export full pipeline report (JSON + CSV)'));
      console.log(chalk.gray('   overdue-report        Show overdue videos table'));
      console.log(chalk.gray('   shift-deadlines <N>   Shift active deadlines by N days (--confirm to apply)'));
      console.log('');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { suggestEditor, statusReport, overdueReport, shiftDeadlines };
