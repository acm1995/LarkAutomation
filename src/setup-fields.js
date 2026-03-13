/**
 * TBH Pipeline — Field Setup Script
 * Adds new tracking fields to the Content Calendar table
 *
 * Usage:
 *   node src/setup-fields.js             # Apply field changes
 *   node src/setup-fields.js --dry-run   # Preview changes without applying
 */
const LarkClient = require('./lark-client');
require('dotenv').config();

const client = new LarkClient();
const tableId = process.env.LARK_TABLE_CONTENT_CALENDAR;

const NEW_FIELDS = [
  {
    field_name: 'Script Revision Count',
    type: 2, // Number
    property: {
      formatter: '0',
    },
    description: { text: 'Auto-tracked: number of script revision rounds' },
  },
  {
    field_name: 'Video Revision Count',
    type: 2, // Number
    property: {
      formatter: '0',
    },
    description: { text: 'Auto-tracked: number of video editing revision rounds' },
  },
  {
    field_name: 'Priority',
    type: 3, // Single Select
    property: {
      options: [
        { name: 'Low', color: 0 },
        { name: 'Medium', color: 2 },
        { name: 'High', color: 4 },
        { name: 'Urgent', color: 6 },
      ],
    },
    description: { text: 'Video priority for triage' },
  },
  {
    field_name: 'Bottleneck Flag',
    type: 7, // Checkbox
    description: { text: 'Auto-flagged when video is stuck in a stage' },
  },
  {
    field_name: 'Last Status Change',
    type: 5, // Date
    property: {
      date_formatter: 'yyyy/MM/dd HH:mm',
    },
    description: { text: 'Timestamp of the most recent status change' },
  },
];

async function setupFields() {
  const chalk = require('chalk');
  const isDryRun = process.argv.includes('--dry-run');

  console.log(chalk.cyan(`\n🔧 TBH Base Field Setup ${isDryRun ? '(DRY RUN)' : ''}\n`));

  // Get existing fields
  const existingFields = await client.listFields(tableId);
  const existingNames = existingFields.map(f => f.field_name);

  console.log(chalk.gray(`   Existing fields: ${existingNames.length}`));
  console.log(chalk.gray(`   Fields to add: ${NEW_FIELDS.length}\n`));

  for (const field of NEW_FIELDS) {
    if (existingNames.includes(field.field_name)) {
      console.log(chalk.yellow(`   ⏭️  "${field.field_name}" already exists — skipping`));
      continue;
    }

    if (isDryRun) {
      console.log(chalk.blue(`   📋 Would create: "${field.field_name}" (type: ${field.type})`));
    } else {
      try {
        await client.createField(tableId, field);
        console.log(chalk.green(`   ✅ Created: "${field.field_name}"`));
      } catch (err) {
        console.error(chalk.red(`   ❌ Failed to create "${field.field_name}": ${err.message}`));
      }
    }
  }

  console.log(chalk.cyan(`\n✨ Field setup ${isDryRun ? 'preview' : ''} complete!\n`));

  if (isDryRun) {
    console.log(chalk.gray('   Run without --dry-run to apply changes.\n'));
  }
}

if (require.main === module) {
  setupFields().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = setupFields;
