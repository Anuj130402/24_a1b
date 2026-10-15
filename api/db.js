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

pg.on('error', (err) => {
  // An idle client dying must not take the process with it.
  console.error('PostgreSQL pool error:', err.message);
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
const MONGO_DB = process.env.MONGO_DB || 'careconnect_db';

// serverSelectionTimeoutMS keeps a dead MongoDB from hanging a request
// for the 30-second default before it gives up.
const mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });

export const mongo = mongoClient.db(MONGO_DB);

/**
 * Connect without taking the process down on failure.
 *
 * A top-level `await mongoClient.connect()` throws at import time if
 * MongoDB is not up, so Express never starts listening and /health
 * cannot report which database is missing — the one moment it matters.
 * Driver operations queue and retry once the server appears, so the
 * app stays useful for its PostgreSQL screens in the meantime.
 */
export async function connectMongo() {
  try {
    await mongoClient.connect();
    await mongoClient.db(MONGO_DB).command({ ping: 1 });
    console.log('MongoDB connected');
    return true;
  } catch (err) {
    console.error(
      `MongoDB unavailable at ${MONGO_URI}: ${err.message}\n` +
      'PostgreSQL screens will work; Map and Reviews will not until it is running.'
    );
    return false;
  }
}

export async function closeAll() {
  await pg.end();
  await mongoClient.close();
}
