import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { persistEntitiesAndLinks } from '../../src/agent/entityExtractor.js';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

describe('Conversation Persistence & Cascade Deletion', () => {
  let sqlite;
  let db;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('persists conversations, messages, and cascades deletion', async () => {
    const convId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 1. Insert conversation
    db.insert(schema.conversations).values({
      id: convId,
      title: 'Postgres Hosting Test',
      createdAt: now,
      updatedAt: now,
    }).run();

    // 2. Insert message
    db.insert(schema.messages).values({
      id: msgId,
      conversationId: convId,
      role: 'user',
      content: 'Tell me about Neon and Supabase pricing',
      createdAt: now,
    }).run();

    // 3. Link entities
    await persistEntitiesAndLinks(db, msgId, [
      { name: 'Neon', normalizedName: 'neon', type: 'product' },
      { name: 'Supabase', normalizedName: 'supabase', type: 'product' },
    ]);

    // Check message & entities exist
    const savedMsg = db.select().from(schema.messages).where(eq(schema.messages.id, msgId)).get();
    expect(savedMsg).toBeDefined();

    const linkedEntities = db.select().from(schema.messageEntities).where(eq(schema.messageEntities.messageId, msgId)).all();
    expect(linkedEntities).toHaveLength(2);

    // 4. Delete conversation
    db.delete(schema.conversations).where(eq(schema.conversations.id, convId)).run();

    // 5. Verify cascading deletion deleted messages and message_entities
    const checkMsg = db.select().from(schema.messages).where(eq(schema.messages.id, msgId)).get();
    expect(checkMsg).toBeUndefined();

    const checkLinks = db.select().from(schema.messageEntities).where(eq(schema.messageEntities.messageId, msgId)).all();
    expect(checkLinks).toHaveLength(0);
  });
});
