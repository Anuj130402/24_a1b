// Database connections. Both are created once and shared.

import pkg from 'pg';
import { MongoClient } from 'mongodb';

const { Pool } = pkg;

// Same env var the Python seeders use, so one setting covers everything.
// Default connects over the Unix socket as the current OS user, which is
// how Homebrew/Postgres.app installs behave out of the box.
export const pg = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  database: process.env.DATABASE_URL ? undefined : 'careconnect',
  max: 10,
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
const MONGO_DB = process.env.MONGO_DB || 'careconnect_db';

const mongoClient = new MongoClient(MONGO_URI);
await mongoClient.connect();

export const mongo = mongoClient.db(MONGO_DB);

export async function closeAll() {
  await pg.end();
  await mongoClient.close();
}
