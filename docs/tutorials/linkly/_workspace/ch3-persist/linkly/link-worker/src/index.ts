import { registerWorker, Logger } from 'iii-sdk'
import type { ApiRequest, ApiResponse } from 'iii-sdk'
import { makeCode } from './codes.js'

const iii = registerWorker(process.env.III_URL ?? 'ws://localhost:49134', {
  workerName: 'link-worker',
})
const logger = new Logger()

const DB = 'primary'

// The database holds the durable record; iii-state is the hot lookup cache.
async function ensureSchema(): Promise<void> {
  await iii.trigger({
    function_id: 'database::execute',
    payload: {
      db: DB,
      sql: 'CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, url TEXT NOT NULL, created_at TEXT NOT NULL)',
    },
  })
  await iii.trigger({
    function_id: 'database::execute',
    payload: {
      db: DB,
      sql: 'CREATE TABLE IF NOT EXISTS clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, clicked_at TEXT NOT NULL)',
    },
  })
}

iii.registerFunction('link::create', async (payload: { url: string; code?: string }) => {
  const code = payload.code ?? makeCode()
  await iii.trigger({
    function_id: 'database::execute',
    payload: {
      db: DB,
      sql: 'INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)',
      params: [code, payload.url, new Date().toISOString()],
    },
  })
  await iii.trigger({
    function_id: 'state::set',
    payload: { scope: 'links', key: code, value: { url: payload.url } },
  })
  logger.info('link created', { code, url: payload.url })
  return { code, url: payload.url }
})

iii.registerFunction('link::resolve', async (payload: { code: string }) => {
  // Hot path: read the cache in iii-state.
  const cached = await iii.trigger<{ scope: string; key: string }, { url: string } | null>({
    function_id: 'state::get',
    payload: { scope: 'links', key: payload.code },
  })
  if (cached) {
    return { url: cached.url }
  }
  // Cache miss: fall back to the durable table, then warm the cache.
  const { rows } = await iii.trigger<
    { db: string; sql: string; params: string[] },
    { rows: Array<{ url: string }> }
  >({
    function_id: 'database::query',
    payload: { db: DB, sql: 'SELECT url FROM links WHERE code = ?', params: [payload.code] },
  })
  const url = rows[0]?.url ?? null
  if (url) {
    await iii.trigger({
      function_id: 'state::set',
      payload: { scope: 'links', key: payload.code, value: { url } },
    })
  }
  return { url }
})

iii.registerFunction('http::redirect', async (req: ApiRequest): Promise<ApiResponse> => {
  const code = req.path_params.code
  const { url } = await iii.trigger<{ code: string }, { url: string | null }>({
    function_id: 'link::resolve',
    payload: { code },
  })
  if (!url) {
    return {
      status_code: 404,
      body: { error: 'link not found' },
      headers: { 'Content-Type': 'application/json' },
    }
  }
  // Record the click as durable history. For now this runs inline, on the
  // redirect's hot path; the next chapter moves it onto a queue.
  await iii.trigger({
    function_id: 'database::execute',
    payload: {
      db: DB,
      sql: 'INSERT INTO clicks (code, clicked_at) VALUES (?, ?)',
      params: [code, new Date().toISOString()],
    },
  })
  return { status_code: 302, headers: { Location: url } }
})

iii.registerTrigger({
  type: 'http',
  function_id: 'http::redirect',
  config: { api_path: '/s/:code', http_method: 'GET' },
})

iii.registerFunction(
  'http::create',
  async (req: ApiRequest<{ url?: string; code?: string }>): Promise<ApiResponse> => {
    const { url, code } = req.body ?? {}
    if (!url) {
      return {
        status_code: 400,
        body: { error: 'missing "url"' },
        headers: { 'Content-Type': 'application/json' },
      }
    }
    const link = await iii.trigger<{ url: string; code?: string }, { code: string; url: string }>({
      function_id: 'link::create',
      payload: { url, code },
    })
    return {
      status_code: 201,
      body: link,
      headers: { 'Content-Type': 'application/json' },
    }
  },
)

iii.registerTrigger({
  type: 'http',
  function_id: 'http::create',
  config: { api_path: '/links', http_method: 'POST' },
})

ensureSchema()
  .then(() => console.info('link-worker ready'))
  .catch((err) => console.error('schema init failed', err))
