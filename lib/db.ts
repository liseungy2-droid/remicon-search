import { createClient } from '@libsql/client';

let client: ReturnType<typeof createClient> | null = null;

export function getDB() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
  return client;
}
