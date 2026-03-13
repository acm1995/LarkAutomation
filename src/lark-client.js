/**
 * TBH Pipeline — Lark Base API Client
 * Handles authentication, record CRUD, and field operations
 */
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://open.larksuite.com/open-apis';

class LarkClient {
  constructor() {
    this.appId = process.env.LARK_APP_ID;
    this.appSecret = process.env.LARK_APP_SECRET;
    this.appToken = process.env.LARK_BASE_APP_TOKEN;
    this.tenantToken = null;
    this.tokenExpiry = 0;

    if (!this.appId || !this.appSecret || this.appId === 'your_app_id_here') {
      console.warn('[LarkClient] Warning: LARK_APP_ID or LARK_APP_SECRET not configured. Copy .env.example to .env and fill in your credentials.');
    }
  }

  // ─── Authentication ────────────────────────────────────────────────

  async getToken() {
    if (this.tenantToken && Date.now() < this.tokenExpiry) {
      return this.tenantToken;
    }

    try {
      const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        app_id: this.appId,
        app_secret: this.appSecret,
      });

      if (res.data.code !== 0) {
        throw new Error(`Auth failed: ${res.data.msg}`);
      }

      this.tenantToken = res.data.tenant_access_token;
      // Token expires in 2 hours, refresh 5 min early
      this.tokenExpiry = Date.now() + (res.data.expire - 300) * 1000;
      return this.tenantToken;
    } catch (err) {
      throw new Error(`Failed to get tenant token: ${err.message}`);
    }
  }

  async request(method, path, data = null, params = null) {
    const token = await this.getToken();
    const config = {
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    if (data) config.data = data;
    if (params) config.params = params;

    try {
      const res = await axios(config);
      if (res.data.code !== 0) {
        throw new Error(`API Error (${res.data.code}): ${res.data.msg}`);
      }
      return res.data.data;
    } catch (err) {
      if (err.response) {
        throw new Error(`HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
      }
      throw err;
    }
  }

  // ─── Table Operations ──────────────────────────────────────────────

  async listTables() {
    const data = await this.request('GET', `/bitable/v1/apps/${this.appToken}/tables`);
    return data.items || [];
  }

  async getTableMeta(tableId) {
    const tables = await this.listTables();
    return tables.find(t => t.table_id === tableId);
  }

  // ─── Field Operations ──────────────────────────────────────────────

  async listFields(tableId) {
    const data = await this.request('GET', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`);
    return data.items || [];
  }

  async createField(tableId, fieldConfig) {
    return this.request('POST', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`, fieldConfig);
  }

  async updateField(tableId, fieldId, fieldConfig) {
    return this.request('PUT', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields/${fieldId}`, fieldConfig);
  }

  // ─── Record Operations ─────────────────────────────────────────────

  /**
   * List records with pagination support
   * @param {string} tableId
   * @param {object} options - { filter, sort, fieldNames, pageSize, pageToken }
   * @returns {Promise<{records: Array, hasMore: boolean, pageToken: string, total: number}>}
   */
  async listRecords(tableId, options = {}) {
    const params = {};
    if (options.pageSize) params.page_size = Math.min(options.pageSize, 500);
    else params.page_size = 500;
    if (options.pageToken) params.page_token = options.pageToken;
    if (options.filter) params.filter = options.filter;
    if (options.sort) params.sort = JSON.stringify(options.sort);
    if (options.fieldNames) params.field_names = JSON.stringify(options.fieldNames);

    const data = await this.request('GET', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`, null, params);
    return {
      records: data.items || [],
      hasMore: data.has_more || false,
      pageToken: data.page_token || null,
      total: data.total || 0,
    };
  }

  /**
   * Fetch ALL records (handles pagination automatically)
   */
  async getAllRecords(tableId, options = {}) {
    const allRecords = [];
    let pageToken = null;
    let hasMore = true;

    while (hasMore) {
      const result = await this.listRecords(tableId, { ...options, pageToken });
      allRecords.push(...result.records);
      hasMore = result.hasMore;
      pageToken = result.pageToken;
    }

    return allRecords;
  }

  async getRecord(tableId, recordId) {
    return this.request('GET', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`);
  }

  async createRecord(tableId, fields) {
    return this.request('POST', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`, { fields });
  }

  async updateRecord(tableId, recordId, fields) {
    return this.request('PUT', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`, { fields });
  }

  async batchUpdateRecords(tableId, records) {
    // records: [{ record_id, fields: {...} }, ...]
    // Max 500 per batch
    const batches = [];
    for (let i = 0; i < records.length; i += 500) {
      batches.push(records.slice(i, i + 500));
    }

    const results = [];
    for (const batch of batches) {
      const res = await this.request('POST', `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_update`, {
        records: batch,
      });
      results.push(res);
    }
    return results;
  }

  // ─── Messenger Operations ──────────────────────────────────────────

  async sendMessage(receiveIdType, receiveId, msgType, content) {
    return this.request('POST', `/im/v1/messages`, {
      receive_id: receiveId,
      msg_type: msgType,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    }, { receive_id_type: receiveIdType });
  }

  async sendTextMessage(chatId, text, idType = 'chat_id') {
    return this.sendMessage(idType, chatId, 'text', JSON.stringify({ text }));
  }

  async sendCardMessage(chatId, card, idType = 'chat_id') {
    return this.sendMessage(idType, chatId, 'interactive', JSON.stringify(card));
  }

  // ─── User Operations ───────────────────────────────────────────────

  async getUserByEmail(email) {
    const data = await this.request('POST', `/contact/v3/users/batch_get_id`, {
      emails: [email],
    }, { user_id_type: 'open_id' });
    return data.user_list?.[0] || null;
  }

  // ─── Utility ───────────────────────────────────────────────────────

  /**
   * Get a field value from a record, handling Lark's nested field format
   */
  static getFieldValue(record, fieldName) {
    const val = record.fields?.[fieldName];
    if (val === undefined || val === null) return null;

    // Handle person/user fields (array of { id, name, ... })
    if (Array.isArray(val) && val.length > 0 && val[0]?.name) {
      return val.map(v => v.name);
    }

    // Handle single select (string or { text })
    if (typeof val === 'object' && val.text) return val.text;

    // Handle URL fields
    if (typeof val === 'object' && val.link) return val.link;

    // Handle date fields (timestamp in ms)
    if (typeof val === 'number' && fieldName.toLowerCase().includes('date') || fieldName.toLowerCase().includes('deadline')) {
      return new Date(val);
    }

    return val;
  }
}

// ─── CLI Test ────────────────────────────────────────────────────────

async function testConnection() {
  const chalk = require('chalk');
  const client = new LarkClient();

  console.log(chalk.cyan('\n🔗 Testing Lark API Connection...\n'));

  try {
    await client.getToken();
    console.log(chalk.green('✅ Authentication successful!'));

    const tables = await client.listTables();
    console.log(chalk.green(`✅ Found ${tables.length} tables:`));
    tables.forEach(t => {
      console.log(chalk.white(`   📋 ${t.name} (${t.table_id})`));
    });

    // Test Content Calendar
    const tableId = process.env.LARK_TABLE_CONTENT_CALENDAR;
    if (tableId) {
      const fields = await client.listFields(tableId);
      console.log(chalk.green(`\n✅ Content Calendar has ${fields.length} fields:`));
      fields.forEach(f => {
        console.log(chalk.white(`   📎 ${f.field_name} (${f.type})`));
      });

      const { records, total } = await client.listRecords(tableId, { pageSize: 3 });
      console.log(chalk.green(`\n✅ Content Calendar has ${total} records. First 3:`));
      records.forEach(r => {
        const title = LarkClient.getFieldValue(r, 'Title') || '(unnamed)';
        const status = LarkClient.getFieldValue(r, 'Status') || '(no status)';
        console.log(chalk.white(`   🎬 "${title}" — ${status}`));
      });
    }

    console.log(chalk.cyan('\n✨ All tests passed! API connection is working.\n'));
  } catch (err) {
    console.error(chalk.red(`\n❌ Connection failed: ${err.message}`));
    console.error(chalk.yellow('   Make sure your .env file has valid LARK_APP_ID and LARK_APP_SECRET'));
    process.exit(1);
  }
}

if (require.main === module && process.argv.includes('--test')) {
  testConnection();
}

module.exports = LarkClient;
