import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  TAVILY_API_KEY: z.string().optional().default(''),
  MAX_SEARCH_CALLS_PER_REQUEST: z.coerce.number().default(4),
  MAX_TOOL_ROUNDS: z.coerce.number().default(2),
  SEARCH_TIMEOUT_MS: z.coerce.number().default(10000),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(60000),
  MAX_SEARCH_RESULTS_PER_CALL: z.coerce.number().default(5),
  DATABASE_PATH: z.string().default('data/minimi.sqlite'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
  resolvedDbPath: path.resolve(process.cwd(), parsed.data.DATABASE_PATH),
};
