import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { entities, messageEntities } from '../db/schema.js';

// Predefined catalog of recognized entities for fast deterministic extraction
const KNOWN_ENTITIES = [
  // CRM Tools
  { name: 'HubSpot', normalizedName: 'hubspot', type: 'company', aliases: ['hubspot crm'] },
  { name: 'Salesforce', normalizedName: 'salesforce', type: 'company', aliases: ['salesforce crm'] },
  { name: 'Pipedrive', normalizedName: 'pipedrive', type: 'product', aliases: ['pipedrive crm'] },
  { name: 'Zoho CRM', normalizedName: 'zoho_crm', type: 'product', aliases: ['zoho'] },
  { name: 'Close', normalizedName: 'close_crm', type: 'product', aliases: ['close.com', 'close crm'] },
  { name: 'Freshsales', normalizedName: 'freshsales', type: 'product', aliases: ['freshworks crm'] },
  { name: 'Copper', normalizedName: 'copper_crm', type: 'product', aliases: ['copper'] },

  // Postgres & Database Hosting
  { name: 'PostgreSQL', normalizedName: 'postgresql', type: 'technology', aliases: ['postgres', 'psql'] },
  { name: 'Supabase', normalizedName: 'supabase', type: 'product', aliases: ['supabase postgres'] },
  { name: 'Neon', normalizedName: 'neon_postgres', type: 'product', aliases: ['neon database', 'neon tech'] },
  { name: 'Render', normalizedName: 'render', type: 'company', aliases: ['render postgres', 'render.com'] },
  { name: 'Railway', normalizedName: 'railway', type: 'company', aliases: ['railway.app'] },
  { name: 'AWS RDS', normalizedName: 'aws_rds', type: 'product', aliases: ['rds', 'amazon rds'] },
  { name: 'Fly.io', normalizedName: 'fly_io', type: 'company', aliases: ['flyio'] },
  { name: 'Crunchy Data', normalizedName: 'crunchy_data', type: 'company', aliases: ['crunchy bridge'] },
  { name: 'Timescale', normalizedName: 'timescale', type: 'company', aliases: ['timescaledb'] },

  // General Categories / Topics
  { name: 'CRM', normalizedName: 'crm', type: 'topic', aliases: ['customer relationship management', 'crm tools'] },
  { name: 'Postgres Hosting', normalizedName: 'postgres_hosting', type: 'topic', aliases: ['postgresql hosting', 'database hosting'] },
  { name: 'AI Models', normalizedName: 'ai_models', type: 'topic', aliases: ['llm', 'large language models'] },
];

/**
 * Deterministically extract recognized entities from text
 */
export function extractEntitiesDeterministically(text) {
  if (!text || typeof text !== 'string') return [];

  const lower = text.toLowerCase();
  const matched = [];
  const matchedKeys = new Set();

  for (const entity of KNOWN_ENTITIES) {
    let isMatch = false;

    // Check main name
    const nameRegex = new RegExp(`\\b${escapeRegex(entity.name.toLowerCase())}\\b`, 'i');
    if (nameRegex.test(lower)) {
      isMatch = true;
    }

    // Check aliases
    if (!isMatch && entity.aliases) {
      for (const alias of entity.aliases) {
        const aliasRegex = new RegExp(`\\b${escapeRegex(alias.toLowerCase())}\\b`, 'i');
        if (aliasRegex.test(lower)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch && !matchedKeys.has(entity.normalizedName)) {
      matchedKeys.add(entity.normalizedName);
      matched.push({
        name: entity.name,
        normalizedName: entity.normalizedName,
        type: entity.type,
      });
    }
  }

  // Also extract dynamic capitalized words that look like company/product names (e.g. "Linear", "Notion", "Airtable")
  const capitalizedTerms = text.match(/\b[A-Z][a-zA-Z0-9_.-]{2,}\b/g) || [];
  const commonStopWords = new Set([
    'What', 'When', 'Where', 'Which', 'Who', 'How', 'Did', 'Does', 'Have',
    'Has', 'Had', 'The', 'This', 'That', 'These', 'Those', 'Monday', 'Tuesday',
    'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January',
    'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December', 'Yesterday', 'Today', 'Tomorrow',
  ]);

  for (const term of capitalizedTerms) {
    if (commonStopWords.has(term)) continue;
    const norm = term.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!norm || norm.length < 3) continue;

    if (!matchedKeys.has(norm)) {
      matchedKeys.add(norm);
      matched.push({
        name: term,
        normalizedName: norm,
        type: 'other',
      });
    }
  }

  return matched;
}

function escapeRegex(string) {
  return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Ensure entities exist in SQLite database and associate them with a message
 */
export async function persistEntitiesAndLinks(db, messageId, extractedEntities) {
  if (!extractedEntities || extractedEntities.length === 0) return [];

  const now = new Date().toISOString();
  const linked = [];

  for (const item of extractedEntities) {
    try {
      // Find or insert entity
      const existing = db
        .select()
        .from(entities)
        .where(eq(entities.normalizedName, item.normalizedName))
        .get();

      let entityId;
      if (existing) {
        entityId = existing.id;
      } else {
        entityId = crypto.randomUUID();
        db.insert(entities).values({
          id: entityId,
          name: item.name,
          normalizedName: item.normalizedName,
          type: item.type || 'other',
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      // Link to message if not already linked
      if (messageId) {
        const linkId = crypto.randomUUID();
        db.insert(messageEntities).values({
          id: linkId,
          messageId,
          entityId,
          createdAt: now,
        }).run();
      }

      linked.push({ id: entityId, ...item });
    } catch (err) {
      console.warn('Failed to persist entity:', item.name, err.message);
    }
  }

  return linked;
}
