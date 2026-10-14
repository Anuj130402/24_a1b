// One data hook for every screen, so loading and error behaviour is
// identical across all six.
//
// Requests go to /api/*, which Vite proxies to the Express server on
// :3001 (see vite.config.js). Same-origin in the browser, so no CORS
// surprises during the demo.

import { useState, useEffect, useCallback, useRef } from 'react';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export function useApi(path, { skip = false, pollMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip && !!path);
  const [error, setError] = useState(null);
  const first = useRef(true);

  const run = useCallback(async ({ quiet = false } = {}) => {
    if (skip || !path) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}${path}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setData(body);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      first.current = false;
    }
  }, [path, skip]);

  useEffect(() => { run(); }, [run]);

  // Polling for the map. Refreshes quietly so the list does not flash
  // back to a spinner every few seconds.
  useEffect(() => {
    if (!pollMs || skip || !path) return undefined;
    const id = setInterval(() => run({ quiet: true }), pollMs);
    return () => clearInterval(id);
  }, [pollMs, run, skip, path]);

  return { data, loading, error, refetch: run };
}

/** For POST and PATCH. Throws with the API's human-readable `error`. */
export async function send(path, method, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}
