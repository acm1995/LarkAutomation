# TBH Pipeline Automation Suite

Automates the **To Be Honest** YouTube channel's production pipeline via the **Lark Base API**. Provides real-time analytics, automated notifications, and pipeline operations.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Lark App ID, App Secret, and other settings

# 3. Test API connection
npm run test-connection

# 4. Add tracking fields to your Base (one-time)
npm run setup-fields:dry   # Preview
npm run setup-fields       # Apply

# 5. Launch dashboard
npm run dashboard          # Opens http://localhost:3000
```

## Available Commands

| Command | Description |
|---|---|
| `npm run dashboard` | Launch the pipeline analytics dashboard |
| `npm run analytics` | Print pipeline analytics to terminal |
| `npm run test-connection` | Verify Lark API credentials |
| `npm run notify` | Start notification monitor (continuous) |
| `npm run notify:test` | Send a test notification |
| `npm run setup-fields` | Add tracking fields to Lark Base |
| `npm run setup-fields:dry` | Preview field changes |
| `npm run operations` | Show available operations |

### Operations CLI
```bash
node src/operations.js suggest-editor          # Auto-suggest editors
node src/operations.js status-report           # Export pipeline report (JSON + CSV)
node src/operations.js overdue-report          # View overdue videos table
node src/operations.js shift-deadlines 3       # Preview shifting deadlines by 3 days
node src/operations.js shift-deadlines 3 --confirm  # Apply deadline shift
```

### Notifier CLI
```bash
node src/notifier.js           # Continuous monitoring (every 30 min)
node src/notifier.js --test    # Send test notification
node src/notifier.js --once    # Run one check cycle
node src/notifier.js --daily   # Send daily summary
```

### Revision Tracker
```bash
node src/revision-tracker.js         # Monitor status changes (polls every 2 min)
node src/revision-tracker.js --scan  # Analyze current revision patterns
```

## Architecture

```
src/
├── lark-client.js        # Core API client (auth, CRUD, messaging)
├── analytics.js          # Pipeline metrics engine
├── dashboard.js          # Web dashboard server (Express)
├── messenger.js          # Lark Messenger card templates
├── notifier.js           # Automated notification monitor
├── operations.js         # Bulk pipeline operations CLI
├── revision-tracker.js   # Revision count tracking
└── setup-fields.js       # One-time Base field setup
public/
└── index.html            # Dashboard frontend
```

## Setup Requirements

1. Create a Lark App at [Lark Developer Console](https://open.larksuite.com/app)
2. Required permissions: `bitable:app`, `im:message:send_as_bot`, `contact:user.id:readonly`
3. Share TBH Base with the app
4. Fill in `.env` with credentials
