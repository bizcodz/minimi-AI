import { Router } from 'express';
import { z } from 'zod';

const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1, 'Message cannot be empty').max(4000, 'Message is too long (max 4000 chars)'),
});

export function createChatRouter(orchestrator) {
  const router = Router();

  router.post('/', async (req, res, next) => {
    // 1. Validate payload
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: parsed.error.format(),
      });
    }

    const { conversationId, message } = parsed.data;

    // 2. Setup Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (Nginx, etc.)
    res.flushHeaders?.();

    // Helper to send typed SSE event
    const sendEvent = (eventName, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Client disconnect handler
    let isClientConnected = true;
    req.on('close', () => {
      isClientConnected = false;
    });

    try {
      await orchestrator.process({
        conversationId: conversationId || undefined,
        message,
        onEvent: (event, payload) => {
          if (!isClientConnected) return;
          sendEvent(event, payload);
        },
      });

      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      console.error('Chat processing error:', err);
      if (!res.writableEnded) {
        sendEvent('error', {
          error: 'ExecutionError',
          message: err.message || 'Error occurred during research execution.',
        });
        res.end();
      }
    }
  });

  return router;
}
