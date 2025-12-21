/**
 * Conversation Store
 *
 * Handles persistent storage of conversations and messages using SQLite.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export class ConversationStore {
  /**
   * Create a new ConversationStore instance.
   *
   * @param {string} dbPath - Path to the SQLite database file.
   */
  constructor(dbPath) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.runMigrations();
    console.log(`[ConversationStore] Database initialized at ${dbPath}`);
  }

  /**
   * Initialize database schema.
   */
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        title TEXT,
        total_tokens INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        context_snapshot TEXT,
        token_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS world_credentials (
        world_id TEXT PRIMARY KEY,
        api_key_encrypted TEXT NOT NULL,
        api_key_iv TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS file_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        file_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        claude_file_id TEXT NOT NULL,
        filename TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(world_id, file_type, content_hash)
      );

      CREATE TABLE IF NOT EXISTS message_batches (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        gm_rulings TEXT,
        formatted_prompt TEXT,
        response_message_id INTEGER,
        status TEXT DEFAULT 'collecting',
        veto_count INTEGER DEFAULT 0,
        veto_corrections TEXT,
        time_window_seconds INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        completed_at DATETIME,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (response_message_id) REFERENCES messages(id)
      );

      CREATE TABLE IF NOT EXISTS pdf_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_size INTEGER NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER DEFAULT 50,
        display_name TEXT,
        processing_status TEXT DEFAULT 'pending',
        error_message TEXT,
        extracted_text_length INTEGER,
        claude_file_id TEXT,
        content_hash TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        UNIQUE(world_id, content_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_world ON conversations(world_id);
      CREATE INDEX IF NOT EXISTS idx_file_registry_world ON file_registry(world_id);
      CREATE INDEX IF NOT EXISTS idx_batches_conversation ON message_batches(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_batches_world ON message_batches(world_id);
      CREATE INDEX IF NOT EXISTS idx_batches_status ON message_batches(status);
      CREATE INDEX IF NOT EXISTS idx_pdf_world ON pdf_documents(world_id);
      CREATE INDEX IF NOT EXISTS idx_pdf_status ON pdf_documents(processing_status);
      CREATE INDEX IF NOT EXISTS idx_pdf_category ON pdf_documents(category);

      CREATE TABLE IF NOT EXISTS canon_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        original_message_id INTEGER,
        content TEXT NOT NULL,
        published_by TEXT NOT NULL,
        published_by_name TEXT,
        scene_context TEXT,
        token_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_canon_world ON canon_messages(world_id);
      CREATE INDEX IF NOT EXISTS idx_canon_conversation ON canon_messages(conversation_id);

      CREATE TABLE IF NOT EXISTS house_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        rule_context TEXT NOT NULL,
        foundry_interpretation TEXT,
        pdf_interpretation TEXT,
        gm_ruling TEXT NOT NULL,
        ruling_type TEXT NOT NULL DEFAULT 'session',
        source_pdf_id INTEGER,
        created_by TEXT NOT NULL,
        created_by_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (source_pdf_id) REFERENCES pdf_documents(id)
      );

      CREATE INDEX IF NOT EXISTS idx_house_rules_world ON house_rules(world_id);
      CREATE INDEX IF NOT EXISTS idx_house_rules_type ON house_rules(ruling_type);

      CREATE TABLE IF NOT EXISTS gm_prep_scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        pdf_id INTEGER NOT NULL,
        adventure_name TEXT NOT NULL,
        journal_uuid TEXT,
        script_content TEXT,
        generation_status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pdf_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
        UNIQUE(world_id, pdf_id)
      );

      CREATE INDEX IF NOT EXISTS idx_gm_prep_world ON gm_prep_scripts(world_id);
      CREATE INDEX IF NOT EXISTS idx_gm_prep_pdf ON gm_prep_scripts(pdf_id);
    `);
  }

  /**
   * Run database migrations for schema updates.
   * Handles adding new columns to existing tables.
   */
  runMigrations() {
    // Check if priority column exists in pdf_documents
    const pdfColumns = this.db.prepare("PRAGMA table_info(pdf_documents)").all();
    const hasPriorityColumn = pdfColumns.some(col => col.name === 'priority');

    if (!hasPriorityColumn) {
      console.log('[ConversationStore] Running migration: adding priority column to pdf_documents');
      this.db.exec(`ALTER TABLE pdf_documents ADD COLUMN priority INTEGER DEFAULT 50`);
    }
  }

  /**
   * Get or create a conversation for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {Object} options - Optional settings (title).
   * @returns {Object} The conversation object.
   */
  getOrCreateConversation(worldId, options = {}) {
    // Try to get existing conversation
    let conversation = this.db.prepare(`
      SELECT * FROM conversations
      WHERE world_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(worldId);

    if (!conversation) {
      const id = uuidv4();
      const title = options.title || 'New Session';

      this.db.prepare(`
        INSERT INTO conversations (id, world_id, title)
        VALUES (?, ?, ?)
      `).run(id, worldId, title);

      conversation = { id, world_id: worldId, title, total_tokens: 0 };
      console.log(`[ConversationStore] Created new conversation ${id} for world ${worldId}`);
    }

    return conversation;
  }

  /**
   * Create a new conversation for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {string} title - The conversation title.
   * @returns {Object} The new conversation object.
   */
  createConversation(worldId, title = 'New Session') {
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO conversations (id, world_id, title)
      VALUES (?, ?, ?)
    `).run(id, worldId, title);

    console.log(`[ConversationStore] Created conversation ${id} for world ${worldId}`);
    return { id, world_id: worldId, title, total_tokens: 0 };
  }

  /**
   * Add a message to a conversation.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} role - 'user' or 'assistant'.
   * @param {string} content - The message content.
   * @param {Object} contextSnapshot - Optional game state snapshot.
   * @returns {Object} The created message.
   */
  addMessage(conversationId, role, content, contextSnapshot = null) {
    const tokenCount = this.estimateTokens(content);

    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, context_snapshot, token_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      conversationId,
      role,
      content,
      contextSnapshot ? JSON.stringify(contextSnapshot) : null,
      tokenCount
    );

    // Update conversation
    this.db.prepare(`
      UPDATE conversations
      SET updated_at = CURRENT_TIMESTAMP,
          total_tokens = total_tokens + ?
      WHERE id = ?
    `).run(tokenCount, conversationId);

    return {
      id: result.lastInsertRowid,
      conversation_id: conversationId,
      role,
      content,
      token_count: tokenCount
    };
  }

  /**
   * Get messages for a conversation.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {number} limit - Maximum messages to retrieve.
   * @returns {Array} Array of messages.
   */
  getMessages(conversationId, limit = 100) {
    return this.db.prepare(`
      SELECT id, role, content, token_count, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(conversationId, limit);
  }

  /**
   * Get messages formatted for Claude API.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {number} maxTokens - Maximum total tokens.
   * @returns {Array} Messages array for Claude API.
   */
  getMessagesForContext(conversationId, maxTokens = 50000) {
    const messages = this.getMessages(conversationId);

    // Calculate total tokens
    let totalTokens = messages.reduce((sum, m) => sum + m.token_count, 0);

    // If within budget, return all messages
    if (totalTokens <= maxTokens) {
      return messages.map(m => ({ role: m.role, content: m.content }));
    }

    // Otherwise, take most recent messages that fit
    const result = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (currentTokens + msg.token_count > maxTokens) break;
      result.unshift({ role: msg.role, content: msg.content });
      currentTokens += msg.token_count;
    }

    return result;
  }

  /**
   * Get all conversations for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of conversations.
   */
  getConversations(worldId) {
    return this.db.prepare(`
      SELECT * FROM conversations
      WHERE world_id = ?
      ORDER BY updated_at DESC
    `).all(worldId);
  }

  /**
   * Estimate token count for text.
   * Uses rough estimate of ~4 characters per token.
   *
   * @param {string} text - The text to estimate.
   * @returns {number} Estimated token count.
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get a specific conversation by ID.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Object|null} The conversation or null.
   */
  getConversation(conversationId) {
    return this.db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `).get(conversationId);
  }

  /**
   * Update conversation title.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} title - The new title.
   * @returns {boolean} Success status.
   */
  updateConversationTitle(conversationId, title) {
    const result = this.db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, conversationId);

    return result.changes > 0;
  }

  /**
   * Delete a conversation and its messages.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {boolean} Success status.
   */
  deleteConversation(conversationId) {
    // Delete messages first
    this.db.prepare(`
      DELETE FROM messages WHERE conversation_id = ?
    `).run(conversationId);

    // Delete batches
    this.db.prepare(`
      DELETE FROM message_batches WHERE conversation_id = ?
    `).run(conversationId);

    // Delete conversation
    const result = this.db.prepare(`
      DELETE FROM conversations WHERE id = ?
    `).run(conversationId);

    console.log(`[ConversationStore] Deleted conversation ${conversationId}`);
    return result.changes > 0;
  }

  /**
   * Get conversation statistics.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Object} Statistics object.
   */
  getConversationStats(conversationId) {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as messageCount,
        SUM(token_count) as totalTokens,
        MIN(created_at) as firstMessage,
        MAX(created_at) as lastMessage
      FROM messages
      WHERE conversation_id = ?
    `).get(conversationId);

    return {
      messageCount: stats.messageCount || 0,
      totalTokens: stats.totalTokens || 0,
      firstMessage: stats.firstMessage,
      lastMessage: stats.lastMessage
    };
  }

  /**
   * Store a conversation summary.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} summary - The summary text.
   * @param {number} summarizedUpToMessageId - ID of last summarized message.
   */
  storeSummary(conversationId, summary, summarizedUpToMessageId) {
    // Add summary as a special "summary" role message
    const tokenCount = this.estimateTokens(summary);

    this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, token_count, context_snapshot)
      VALUES (?, 'summary', ?, ?, ?)
    `).run(
      conversationId,
      summary,
      tokenCount,
      JSON.stringify({ summarizedUpToMessageId })
    );

    console.log(`[ConversationStore] Stored summary for conversation ${conversationId}`);
  }

  /**
   * Get messages with summarization for context.
   * If conversation is too long, includes summary + recent messages.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {number} maxTokens - Maximum total tokens.
   * @param {number} recentMessageCount - Number of recent messages to always include.
   * @returns {Object} Object with messages array and needsSummarization flag.
   */
  getMessagesWithSummary(conversationId, maxTokens = 50000, recentMessageCount = 20) {
    // Get all messages
    const allMessages = this.db.prepare(`
      SELECT id, role, content, token_count, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId);

    // Calculate total tokens
    const totalTokens = allMessages.reduce((sum, m) => sum + m.token_count, 0);

    // If within budget, return all non-summary messages
    if (totalTokens <= maxTokens) {
      const messages = allMessages
        .filter(m => m.role !== 'summary')
        .map(m => ({ role: m.role, content: m.content }));
      return { messages, needsSummarization: false, totalTokens };
    }

    // Check for existing summary
    const summaryMessage = allMessages.find(m => m.role === 'summary');

    if (summaryMessage) {
      // Use summary + messages after it
      const summaryIndex = allMessages.indexOf(summaryMessage);
      const messagesAfterSummary = allMessages.slice(summaryIndex + 1)
        .filter(m => m.role !== 'summary');

      const recentMessages = messagesAfterSummary.slice(-recentMessageCount);
      const recentTokens = recentMessages.reduce((sum, m) => sum + m.token_count, 0);

      // If summary + recent fits, use it
      if (summaryMessage.token_count + recentTokens <= maxTokens) {
        const messages = [
          { role: 'user', content: `[Previous conversation summary]\n${summaryMessage.content}` },
          ...recentMessages.map(m => ({ role: m.role, content: m.content }))
        ];
        return { messages, needsSummarization: false, totalTokens };
      }
    }

    // Need summarization - return recent messages and flag
    const nonSummaryMessages = allMessages.filter(m => m.role !== 'summary');
    const recentMessages = nonSummaryMessages.slice(-recentMessageCount);

    return {
      messages: recentMessages.map(m => ({ role: m.role, content: m.content })),
      needsSummarization: true,
      totalTokens,
      oldMessages: nonSummaryMessages.slice(0, -recentMessageCount)
    };
  }

  /**
   * Clear all messages from a conversation (fresh start).
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {boolean} Success status.
   */
  clearConversation(conversationId) {
    this.db.prepare(`
      DELETE FROM messages WHERE conversation_id = ?
    `).run(conversationId);

    this.db.prepare(`
      UPDATE conversations
      SET total_tokens = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(conversationId);

    console.log(`[ConversationStore] Cleared messages from conversation ${conversationId}`);
    return true;
  }

  /**
   * Close the database connection.
   */
  close() {
    this.db.close();
    console.log('[ConversationStore] Database connection closed');
  }

  // ===== Message Batch Methods =====

  /**
   * Create a new message batch.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} worldId - The world ID.
   * @param {Array} messages - Array of player messages.
   * @param {Array} gmRulings - Array of GM rulings.
   * @param {number} timeWindowSeconds - Batch collection duration.
   * @returns {Object} The created batch.
   */
  createBatch(conversationId, worldId, messages, gmRulings = [], timeWindowSeconds = 10) {
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO message_batches
        (id, conversation_id, world_id, messages, gm_rulings, time_window_seconds, status)
      VALUES (?, ?, ?, ?, ?, ?, 'collecting')
    `).run(
      id,
      conversationId,
      worldId,
      JSON.stringify(messages),
      JSON.stringify(gmRulings),
      timeWindowSeconds
    );

    console.log(`[ConversationStore] Created batch ${id} for conversation ${conversationId}`);
    return { id, conversationId, worldId, messages, gmRulings, status: 'collecting' };
  }

  /**
   * Get a batch by ID.
   *
   * @param {string} batchId - The batch ID.
   * @returns {Object|null} The batch or null.
   */
  getBatch(batchId) {
    const row = this.db.prepare(`
      SELECT * FROM message_batches WHERE id = ?
    `).get(batchId);

    if (!row) return null;

    return {
      ...row,
      messages: JSON.parse(row.messages),
      gm_rulings: row.gm_rulings ? JSON.parse(row.gm_rulings) : [],
      veto_corrections: row.veto_corrections ? JSON.parse(row.veto_corrections) : []
    };
  }

  /**
   * Update batch messages (add new messages to batch).
   *
   * @param {string} batchId - The batch ID.
   * @param {Array} messages - Updated messages array.
   * @param {Array} gmRulings - Updated GM rulings array.
   */
  updateBatchMessages(batchId, messages, gmRulings = []) {
    this.db.prepare(`
      UPDATE message_batches
      SET messages = ?, gm_rulings = ?
      WHERE id = ? AND status = 'collecting'
    `).run(JSON.stringify(messages), JSON.stringify(gmRulings), batchId);
  }

  /**
   * Update batch status.
   *
   * @param {string} batchId - The batch ID.
   * @param {string} status - New status (collecting, sent, completed, vetoed).
   * @param {Object} options - Optional updates (responseMessageId, formattedPrompt).
   */
  updateBatchStatus(batchId, status, options = {}) {
    let updates = ['status = ?'];
    let params = [status];

    if (status === 'sent') {
      updates.push('sent_at = CURRENT_TIMESTAMP');
      if (options.formattedPrompt) {
        updates.push('formatted_prompt = ?');
        params.push(options.formattedPrompt);
      }
    }

    if (status === 'completed') {
      updates.push('completed_at = CURRENT_TIMESTAMP');
      if (options.responseMessageId) {
        updates.push('response_message_id = ?');
        params.push(options.responseMessageId);
      }
    }

    if (status === 'vetoed') {
      updates.push('veto_count = veto_count + 1');
      if (options.correction) {
        // Append correction to existing corrections
        const batch = this.getBatch(batchId);
        const corrections = batch?.veto_corrections || [];
        corrections.push(options.correction);
        updates.push('veto_corrections = ?');
        params.push(JSON.stringify(corrections));
      }
    }

    params.push(batchId);

    this.db.prepare(`
      UPDATE message_batches
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);
  }

  /**
   * Get the last batch for a conversation (for veto operations).
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Object|null} The last batch or null.
   */
  getLastBatchForConversation(conversationId) {
    const row = this.db.prepare(`
      SELECT * FROM message_batches
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(conversationId);

    if (!row) return null;

    return {
      ...row,
      messages: JSON.parse(row.messages),
      gm_rulings: row.gm_rulings ? JSON.parse(row.gm_rulings) : [],
      veto_corrections: row.veto_corrections ? JSON.parse(row.veto_corrections) : []
    };
  }

  /**
   * Get collecting batch for a world (if any).
   *
   * @param {string} worldId - The world ID.
   * @returns {Object|null} The collecting batch or null.
   */
  getCollectingBatch(worldId) {
    const row = this.db.prepare(`
      SELECT * FROM message_batches
      WHERE world_id = ? AND status = 'collecting'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(worldId);

    if (!row) return null;

    return {
      ...row,
      messages: JSON.parse(row.messages),
      gm_rulings: row.gm_rulings ? JSON.parse(row.gm_rulings) : [],
      veto_corrections: row.veto_corrections ? JSON.parse(row.veto_corrections) : []
    };
  }

  /**
   * Delete old completed batches (cleanup).
   *
   * @param {number} daysOld - Delete batches older than this many days.
   * @returns {number} Number of deleted batches.
   */
  cleanupOldBatches(daysOld = 30) {
    const result = this.db.prepare(`
      DELETE FROM message_batches
      WHERE status IN ('completed', 'vetoed')
        AND completed_at < datetime('now', '-' || ? || ' days')
    `).run(daysOld);

    if (result.changes > 0) {
      console.log(`[ConversationStore] Cleaned up ${result.changes} old batches`);
    }
    return result.changes;
  }

  // ===== Canon Messages Methods =====

  /**
   * Publish a message to canon (official narrative history).
   *
   * @param {string} worldId - The world ID.
   * @param {string} conversationId - The conversation ID.
   * @param {string} content - The message content.
   * @param {Object} options - Publication options.
   * @param {string} options.publishedBy - User ID who published.
   * @param {string} options.publishedByName - User name who published.
   * @param {number} options.originalMessageId - Original message ID if from existing message.
   * @param {string} options.sceneContext - Scene context at time of publishing.
   * @returns {Object} The created canon message.
   */
  publishToCanon(worldId, conversationId, content, options = {}) {
    const tokenCount = this.estimateTokens(content);

    const result = this.db.prepare(`
      INSERT INTO canon_messages
        (world_id, conversation_id, content, published_by, published_by_name, original_message_id, scene_context, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      worldId,
      conversationId,
      content,
      options.publishedBy || 'unknown',
      options.publishedByName || 'GM',
      options.originalMessageId || null,
      options.sceneContext ? JSON.stringify(options.sceneContext) : null,
      tokenCount
    );

    console.log(`[ConversationStore] Published canon message ${result.lastInsertRowid} for world ${worldId}`);

    return {
      id: result.lastInsertRowid,
      world_id: worldId,
      conversation_id: conversationId,
      content,
      published_by: options.publishedBy,
      published_by_name: options.publishedByName,
      token_count: tokenCount
    };
  }

  /**
   * Get canon messages for a world.
   *
   * @param {string} worldId - The world ID.
   * @param {number} limit - Maximum messages to retrieve.
   * @param {number} offset - Offset for pagination.
   * @returns {Array} Array of canon messages.
   */
  getCanonMessages(worldId, limit = 100, offset = 0) {
    return this.db.prepare(`
      SELECT id, content, published_by_name, scene_context, token_count, created_at
      FROM canon_messages
      WHERE world_id = ?
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).all(worldId, limit, offset);
  }

  /**
   * Get canon messages formatted for Claude context.
   * Returns a summary of the official narrative history.
   *
   * @param {string} worldId - The world ID.
   * @param {number} maxTokens - Maximum tokens to include.
   * @returns {Object} Object with messages array and total token count.
   */
  getCanonForContext(worldId, maxTokens = 20000) {
    const messages = this.getCanonMessages(worldId, 500);

    // Calculate total tokens
    let totalTokens = messages.reduce((sum, m) => sum + m.token_count, 0);

    // If within budget, return all
    if (totalTokens <= maxTokens) {
      return {
        messages: messages.map(m => m.content),
        totalTokens
      };
    }

    // Otherwise, take most recent that fit
    const result = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (currentTokens + msg.token_count > maxTokens) break;
      result.unshift(msg.content);
      currentTokens += msg.token_count;
    }

    return { messages: result, totalTokens: currentTokens };
  }

  /**
   * Update a canon message (GM correction).
   *
   * @param {number} canonId - The canon message ID.
   * @param {string} content - The new content.
   * @param {string} correctedBy - User ID making correction.
   * @returns {boolean} Success status.
   */
  updateCanonMessage(canonId, content, correctedBy) {
    const tokenCount = this.estimateTokens(content);

    const result = this.db.prepare(`
      UPDATE canon_messages
      SET content = ?, token_count = ?
      WHERE id = ?
    `).run(content, tokenCount, canonId);

    if (result.changes > 0) {
      console.log(`[ConversationStore] Canon message ${canonId} updated by ${correctedBy}`);
    }

    return result.changes > 0;
  }

  /**
   * Delete a canon message (GM retcon).
   *
   * @param {number} canonId - The canon message ID.
   * @returns {boolean} Success status.
   */
  deleteCanonMessage(canonId) {
    const result = this.db.prepare(`
      DELETE FROM canon_messages WHERE id = ?
    `).run(canonId);

    if (result.changes > 0) {
      console.log(`[ConversationStore] Canon message ${canonId} deleted (retconned)`);
    }

    return result.changes > 0;
  }

  /**
   * Get canon message count for a world.
   *
   * @param {string} worldId - The world ID.
   * @returns {number} Count of canon messages.
   */
  getCanonCount(worldId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM canon_messages WHERE world_id = ?
    `).get(worldId);
    return row.count;
  }
}
