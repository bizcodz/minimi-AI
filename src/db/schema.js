import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  type: text('type', {
    enum: ['company', 'product', 'technology', 'topic', 'other'],
  }).notNull().default('other'),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const messageEntities = sqliteTable('message_entities', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  entityId: text('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
});

export const researchRuns = sqliteTable('research_runs', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  status: text('status', { enum: ['pending', 'completed', 'failed'] }).notNull().default('completed'),
  createdAt: text('created_at').notNull(),
});

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  researchRunId: text('research_run_id')
    .notNull()
    .references(() => researchRuns.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  snippet: text('snippet').notNull(),
  rawContent: text('raw_content'),
  publishedDate: text('published_date'),
  retrievedAt: text('retrieved_at').notNull(),
  score: real('score').default(1.0),
});

export const factObservations = sqliteTable('fact_observations', {
  id: text('id').primaryKey(),
  entityId: text('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  evidenceId: text('evidence_id').references(() => evidence.id, { onDelete: 'set null' }),
  factType: text('fact_type', { enum: ['pricing', 'feature', 'tier', 'general'] }).notNull().default('general'),
  claim: text('claim').notNull(),
  value: text('value').notNull(),
  currency: text('currency').default('USD'),
  billingInterval: text('billing_interval'), // 'monthly', 'annual', 'one-time', etc.
  changeType: text('change_type', {
    enum: [
      'increase',
      'decrease',
      'new_plan',
      'removed_plan',
      'feature_addition',
      'feature_removal',
      'model_change',
      'no_change',
      'unverified',
    ],
  }).notNull().default('no_change'),
  observedAt: text('observed_at').notNull(),
  confidence: real('confidence').notNull().default(1.0),
  status: text('status', {
    enum: [
      'confirmed_change',
      'no_change',
      'insufficient_evidence',
      'historical_unavailable',
    ],
  }).notNull().default('no_change'),
});
