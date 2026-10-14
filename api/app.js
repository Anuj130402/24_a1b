import express from 'express';
import cors from 'cors';

import browse from './routes/browse.js';
import transactions from './routes/transactions.js';
import analytics from './routes/analytics.js';
import mongoRoutes from './routes/mongo.js';
import { errorHandler } from './middleware/errors.js';
import { pg, mongo } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  const out = { api: 'ok', postgres: 'down', mongo: 'down' };
  try {
    await pg.query('SELECT 1');
    out.postgres = 'ok';
  } catch { /* reported as down */ }
  try {
    await mongo.command({ ping: 1 });
    out.mongo = 'ok';
  } catch { /* reported as down */ }
  res.json(out);
});

app.use(browse);
app.use(transactions);
app.use(analytics);
app.use(mongoRoutes);

app.use((_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

// Must be last, after every route.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`CareConnect API on http://localhost:${PORT}`);
});
