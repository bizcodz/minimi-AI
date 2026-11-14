import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { conversations, messages, evidence, factObservations } from '../db/schema.js';

export function createConversationsRouter(db, sqlite) {
  const router = Router();

  // GET /api/conversations - List all conversations with preview and count
  router.get('/', async (req, res, next) => {
    try {
      const stmt = sqlite.prepare(`
        SELECT 
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          COUNT(m.id) as message_count,
          (
            SELECT content FROM messages 
            WHERE conversation_id = c.id 
            ORDER BY created_at DESC LIMIT 1
          ) as last_message_preview
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `);

      const list = stmt.all();
      res.json({ conversations: list });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/conversations/:id - Get single conversation details with messages and evidence
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      const conv = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .get();

      if (!conv) {
        return res.status(404).json({ error: 'NotFound', message: 'Conversation not found.' });
      }

      const convMessages = db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(messages.createdAt)
        .all();

      // Retrieve associated research evidence
      const stmtEvidence = sqlite.prepare(`
        SELECT e.* 
        FROM evidence e
        JOIN research_runs r ON r.id = e.research_run_id
        WHERE r.conversation_id = ?
        ORDER BY e.retrieved_at ASC
      `);
      const convEvidence = stmtEvidence.all(id);

      // Retrieve fact observations
      const stmtFacts = sqlite.prepare(`
        SELECT f.*, ent.name as entity_name
        FROM fact_observations f
        JOIN entities ent ON ent.id = f.entity_id
        JOIN messages m ON m.id = f.message_id
        WHERE m.conversation_id = ?
        ORDER BY f.observed_at ASC
      `);
      const convFacts = stmtFacts.all(id);

      res.json({
        conversation: conv,
        messages: convMessages,
        evidence: convEvidence,
        observations: convFacts,
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/conversations/:id - Delete conversation and cascading data
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      const existing = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .get();

      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: 'Conversation not found.' });
      }

      // SQLite foreign keys are ON, so deleting from conversations cascades to messages, runs, etc.
      db.delete(conversations).where(eq(conversations.id, id)).run();

      res.json({ success: true, message: 'Conversation deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
