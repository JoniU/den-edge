// The profiles-v1 reset surface layered over guest-edge's real encrypted library rows. The production Worker owns
// every observation/copy/journal decision; this route fixture owns only den-edge's durable lock answers and lets a
// test lose a response after the server committed it.
import { readFile } from 'node:fs/promises';
import initCore, { evaluate as evaluateCore } from '../src/vendor/den-core/generated/den_core.js';
import { E2E_ORIGIN } from './base-url.mjs';

const CORE = initCore({
  module_or_path: await readFile(
    new URL('../src/vendor/den-core/generated/den_core_bg.wasm', import.meta.url),
  ),
});

const json = (route, status, body, headers = {}) => route.fulfill({ status, json: body, headers });
const headers = (library) => ({
  'x-den-generation': 'guest-library',
  'x-den-wire-min': String(library?.wireMin ?? 4),
});

async function source(edge, id) {
  await CORE;
  const library = edge.libraries.get(id);
  if (!library || edge.profileResetMoved.has(id)) return null;
  const answer = JSON.parse(
    evaluateCore(
      JSON.stringify({
        op: 'profiles_snapshot_digest',
        kind: 'source',
        input: {
          libraryId: id,
          generation: 0,
          base: library.head,
          wireMin: library.wireMin,
          rows: [...library.rows.values()]
            .map(({ k, seq, v }) => ({ k, seq, v }))
            .sort((left, right) => left.k.localeCompare(right.k)),
        },
      }),
    ),
  );
  if (typeof answer.ok !== 'string') throw new Error('den-core refused the reset fixture source');
  return { generation: 0, head: answer.ok };
}

const rendered = (record, state = record.state) => ({
  attempt: record.attempt,
  state,
  purpose: 'key-reset',
  role: record.role,
  library: record.library,
  successor: record.successor,
  lock: record.lock,
  fence: record.fence,
  ...(record.role === 'household' ? { members: record.members } : { household: record.household }),
});

/** Install after `routeGuestEdge`; Playwright's newest route handles the reset surface first and falls through. */
export async function routeProfileResetEdge(page, edge) {
  edge.profileResetMoved ??= new Map();
  edge.profileResetRecords ??= new Map();
  edge.profileResetAttempts ??= 0;
  edge.profileResetLostReplies ??= 0;
  edge.profileResetHoldReplies ??= false;
  await page.route(`${E2E_ORIGIN}/lib/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/');
    const id = parts[2];
    const rest = parts.slice(3);
    const method = request.method();
    const library = edge.libraries.get(id);

    if (edge.profileResetMoved.has(id)) {
      const moved = edge.profileResetMoved.get(id);
      if (method === 'GET' && rest[0] === 'exclusive-operation' && rest[1] === moved.attempt)
        return json(route, 200, {
          attempt: moved.attempt,
          state: 'retired',
          library: id,
          successor: moved.successor,
        });
      if (method === 'GET' && rest[0] === 'changes')
        return json(route, 410, { error: 'library_moved' }, headers(library));
    }

    if (rest[0] !== 'exclusive-operation' && !(method === 'DELETE' && rest.length === 0))
      return route.fallback();
    if (!library) return json(route, 404, { error: 'not_found' });

    if (method === 'GET' && rest[1] === 'source') {
      const observed = await source(edge, id);
      return observed
        ? json(route, 200, { source: observed, newAttempt: true }, headers(library))
        : json(route, 404, { error: 'not_found' }, headers(library));
    }

    if (method === 'POST' && rest.length === 1) {
      const body = request.postDataJSON();
      const existing = edge.profileResetRecords.get(id);
      if (existing) {
        if (existing.attempt !== body.attempt)
          return json(route, 409, { error: 'migration_in_progress' }, headers(library));
        if (
          existing.role === 'household' &&
          (edge.profileResetHoldReplies || edge.profileResetLostReplies > 0)
        ) {
          if (edge.profileResetLostReplies > 0) edge.profileResetLostReplies -= 1;
          return route.abort('connectionfailed');
        }
        return json(route, 200, rendered(existing), headers(library));
      }
      if (body.purpose !== 'key-reset')
        return json(route, 404, { error: 'not_found' }, headers(library));
      const record = {
        attempt: body.attempt,
        state: 'open',
        role: body.role,
        library: id,
        successor: body.successor,
        members: body.members ?? [],
        household: body.household,
        lock: `fixture-lock-${id}`,
        fence: body.expectedSource,
      };
      edge.profileResetRecords.set(id, record);
      if (body.role === 'household') edge.profileResetAttempts += 1;
      if (
        body.role === 'household' &&
        (edge.profileResetHoldReplies || edge.profileResetLostReplies > 0)
      ) {
        if (edge.profileResetLostReplies > 0) edge.profileResetLostReplies -= 1;
        return route.abort('connectionfailed');
      }
      return json(route, 200, rendered(record), headers(library));
    }

    const attempt = rest[1];
    const record = edge.profileResetRecords.get(id);
    if (method === 'GET' && rest.length === 2) {
      if (!record || record.attempt !== attempt)
        return json(route, 404, { error: 'not_found' }, headers(library));
      const household =
        record.role === 'household' ? record : edge.profileResetRecords.get(record.household);
      return json(route, 200, rendered(record, household?.state ?? record.state), headers(library));
    }
    if (method === 'POST' && rest[2] === 'successor') {
      if (!record || record.attempt !== attempt)
        return json(route, 409, { error: 'migration_in_progress' }, headers(library));
      record.state = 'committed';
      return json(route, 200, rendered(record, 'committed'), headers(library));
    }
    if (method === 'DELETE' && rest.length === 2) {
      if (!record || record.attempt !== attempt)
        return json(route, 404, { error: 'not_found' }, headers(library));
      record.state = 'aborted';
      return json(route, 200, { attempt, state: 'aborted' }, headers(library));
    }
    if (method === 'DELETE' && rest.length === 0) {
      const owningAttempt = request.headers()['x-den-exclusive-attempt'];
      const successor = request.headers()['x-den-successor'];
      if (!record || record.attempt !== owningAttempt || typeof successor !== 'string')
        return json(route, 409, { error: 'migration_in_progress' }, headers(library));
      edge.profileResetMoved.set(id, { attempt: owningAttempt, successor });
      return json(route, 200, { deleted: true }, headers(library));
    }
    return json(route, 404, { error: 'not_found' }, headers(library));
  });
}
