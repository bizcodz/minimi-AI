import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { getDatabase, closeDatabase } from './db/index.js';
import { AgentOrchestrator } from './agent/agentOrchestrator.js';
import { createChatRouter } from './api/chatRouter.js';
import { createConversationsRouter } from './api/conversationsRouter.js';
import { rateLimiter, requestTimeout, errorHandler } from './api/middleware.js';

export function createApp() {
  const app = express();

  // Initialize DB and Agent
  const { db, sqlite } = getDatabase();
  const orchestrator = new AgentOrchestrator(db, sqlite);

  // Core Middlewares
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimiter);
  app.use(requestTimeout());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      timezone: config.APP_TIMEZONE,
      limits: {
        maxSearchCalls: config.MAX_SEARCH_CALLS_PER_REQUEST,
        maxToolRounds: config.MAX_TOOL_ROUNDS,
      },
      apiKeysConfigured: {
        openai: Boolean(config.OPENAI_API_KEY && config.OPENAI_API_KEY !== 'dummy-key'),
        tavily: Boolean(config.TAVILY_API_KEY),
      },
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'minimi-ai-backend' });
  });

  // API Routers
  app.use('/api/chat', createChatRouter(orchestrator));
  app.use('/api/conversations', createConversationsRouter(db, sqlite));

  // Global Error Handler
  app.use(errorHandler);

  return { app, db, sqlite, orchestrator };
}

export function startServer(port = config.PORT) {
  const { app } = createApp();

  const server = app.listen(port, () => {
    console.log(`[Minimi AI Backend] Server running on http://127.0.0.1:${port}`);
    console.log(`[Minimi AI Backend] Configured timezone: ${config.APP_TIMEZONE}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Minimi AI Backend] Gracefully shutting down...');
    server.close(() => {
      closeDatabase();
      console.log('[Minimi AI Backend] Database closed and server terminated.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}
