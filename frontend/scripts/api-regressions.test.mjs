import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import ts from 'typescript';

async function loadApiModule() {
  const sourcePath = new URL('../src/lib/api.ts', import.meta.url);
  const source = (await readFile(sourcePath, 'utf8')).replaceAll(
    'import.meta.env.VITE_API_URL',
    'undefined'
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('ensureCsrfCookie fetches a new token after the cookie has been cleared', async () => {
  const { ensureCsrfCookie } = await loadApiModule();
  const calls = [];
  const documentMock = { cookie: '' };
  globalThis.document = documentMock;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    documentMock.cookie = 'csrftoken=token-1';
    return jsonResponse({ detail: 'CSRF cookie set' });
  };

  await ensureCsrfCookie();
  assert.equal(calls.length, 1);

  documentMock.cookie = '';
  await ensureCsrfCookie();
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/v1/api/csrf', '/v1/api/csrf']
  );
});

test('apiRequest refreshes CSRF state before a mutation after logout-style cookie clearing', async () => {
  const { ensureCsrfCookie, apiRequest } = await loadApiModule();
  const calls = [];
  const documentMock = { cookie: '' };
  let csrfCounter = 0;

  globalThis.document = documentMock;
  globalThis.fetch = async (url, init = {}) => {
    const record = { url: String(url), init };
    calls.push(record);

    if (record.url === '/v1/api/csrf') {
      csrfCounter += 1;
      documentMock.cookie = `csrftoken=token-${csrfCounter}`;
      return jsonResponse({ detail: 'CSRF cookie set' });
    }

    if (record.url === '/v1/api/tasks') {
      return jsonResponse({ ok: true });
    }

    throw new Error(`Unexpected URL: ${record.url}`);
  };

  await ensureCsrfCookie();
  documentMock.cookie = '';

  const response = await apiRequest('/tasks', {
    method: 'POST',
    body: { title: 'Regression test' },
  });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/v1/api/csrf', '/v1/api/csrf', '/v1/api/tasks']
  );
  assert.equal(calls[2].init.headers.get('X-CSRFToken'), 'token-2');
});
