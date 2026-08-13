/**
 * Local HTTP client for the claude-mem worker. Self-contained: reimplements the
 * small deadline/timeout helpers locally so this package has no
 * `@deepseek-ai/dsh-timeout` dependency.
 * @module dsh-claude-mem/worker
 */

import { MemError } from './types.js'
import type {
  MemContextRequest,
  MemGetObservationsRequest,
  MemObservation,
  MemSaveRequest,
  MemSaveResult,
  MemSearchRequest,
  MemSearchResult,
  MemSessionInitRequest,
  MemSessionSummarizeRequest,
  MemTimelineRequest,
} from './types.js'

/** Resolved client limits. */
export interface WorkerLimits {
  /** Worker base URL, e.g. `http://127.0.0.1:37700`. */
  baseUrl: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
}

const MEM_TIMEOUT = 'MEM_TIMEOUT'

/** A deadline signal plus its timer cleanup; safe to dispose once. */
interface Deadline {
  readonly signal: AbortSignal
  [Symbol.dispose](): void
}

/** Fuse an upstream signal with an identifiable timeout. */
function deadline(upstream: AbortSignal | undefined, timeoutMs: number, code: string): Deadline {
  if (timeoutMs <= 0) {
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {} }
  }
  const timer = new AbortController()
  const id = setTimeout(() => { timer.abort(new TimeoutReason(code, timeoutMs)) }, timeoutMs)
  return {
    signal: upstream !== undefined ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() { clearTimeout(id) },
  }
}

class TimeoutReason extends Error {
  override name = 'TimeoutReason'
  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

function timeoutOf(x: AbortSignal, code: string): TimeoutReason | undefined {
  const reason: unknown = x.reason
  return reason instanceof TimeoutReason && reason.code === code ? reason : undefined
}

/**
 * The local claude-mem worker HTTP client. The worker is a separate process;
 * network availability fails loudly at execution time.
 */
export class WorkerClient {
  constructor(private readonly limits: WorkerLimits) {}

  async search(request: MemSearchRequest, signal?: AbortSignal): Promise<MemSearchResult> {
    const query = new URLSearchParams({ query: request.query })
    if (request.limit !== undefined) query.set('limit', String(request.limit))
    if (request.project !== undefined) query.set('project', request.project)
    if (request.platformSource !== undefined) query.set('platformSource', request.platformSource)
    if (request.type !== undefined) query.set('type', request.type)
    if (request.obsType !== undefined) query.set('obs_type', request.obsType)
    if (request.dateStart !== undefined) query.set('dateStart', request.dateStart)
    if (request.dateEnd !== undefined) query.set('dateEnd', request.dateEnd)
    if (request.offset !== undefined) query.set('offset', String(request.offset))
    if (request.orderBy !== undefined) query.set('orderBy', request.orderBy)
    return await this.query('/api/search', query, signal)
  }

  async timeline(request: MemTimelineRequest, signal?: AbortSignal): Promise<MemSearchResult> {
    const query = new URLSearchParams()
    if (request.anchor !== undefined) query.set('anchor', String(request.anchor))
    if (request.query !== undefined) query.set('query', request.query)
    if (request.depthBefore !== undefined) query.set('depth_before', String(request.depthBefore))
    if (request.depthAfter !== undefined) query.set('depth_after', String(request.depthAfter))
    if (request.project !== undefined) query.set('project', request.project)
    if (request.platformSource !== undefined) query.set('platformSource', request.platformSource)
    return await this.query('/api/timeline', query, signal)
  }

  async getObservations(request: MemGetObservationsRequest, signal?: AbortSignal): Promise<MemSearchResult> {
    if (request.ids.length === 0) throw new MemError('at least one observation id is required', 'MEM_INVALID_REQUEST')
    const body: Record<string, unknown> = { ids: request.ids }
    if (request.project !== undefined) body.project = request.project
    const raw: unknown = await this.requestJson<unknown>('/api/observations/batch', { method: 'POST', body }, signal)
    return { items: (Array.isArray(raw) ? raw : []).map(asObservation) }
  }

  async save(request: MemSaveRequest, signal?: AbortSignal): Promise<MemSaveResult> {
    if (request.text.trim().length === 0) throw new MemError('memory text must be a non-empty string', 'MEM_INVALID_REQUEST')
    const body: Record<string, unknown> = { text: request.text }
    if (request.title !== undefined) body.title = request.title
    if (request.project !== undefined) body.project = request.project
    if (request.metadata !== undefined) body.metadata = request.metadata
    return await this.requestJson<MemSaveResult>('/api/memory/save', { method: 'POST', body }, signal)
  }

  async context(request: MemContextRequest, signal?: AbortSignal): Promise<string> {
    const projects = request.projects.trim()
    if (projects.length === 0) throw new MemError('at least one project is required', 'MEM_INVALID_REQUEST')
    const query = new URLSearchParams({ projects })
    if (request.platformSource !== undefined) query.set('platformSource', request.platformSource)
    if (request.full !== undefined) query.set('full', String(request.full))
    if (request.colors !== undefined) query.set('colors', String(request.colors))
    return await this.requestText('/api/context/inject', query, signal)
  }

  async sessionInit(request: MemSessionInitRequest, signal?: AbortSignal): Promise<void> {
    const body: Record<string, unknown> = { contentSessionId: request.contentSessionId }
    if (request.project !== undefined) body.project = request.project
    if (request.prompt !== undefined) body.prompt = request.prompt
    if (request.platformSource !== undefined) body.platformSource = request.platformSource
    if (request.customTitle !== undefined) body.customTitle = request.customTitle
    await this.requestJson<unknown>('/api/sessions/init', { method: 'POST', body }, signal)
  }

  async sessionSummarize(request: MemSessionSummarizeRequest, signal?: AbortSignal): Promise<void> {
    const body: Record<string, unknown> = { contentSessionId: request.contentSessionId }
    if (request.project !== undefined) body.project = request.project
    if (request.platformSource !== undefined) body.platformSource = request.platformSource
    await this.requestJson<unknown>('/api/sessions/summarize', { method: 'POST', body }, signal)
  }

  private async query(path: string, query: URLSearchParams, signal?: AbortSignal): Promise<MemSearchResult> {
    const raw: unknown = await this.requestJson<unknown>(path, { method: 'GET', query }, signal)
    return normalizeQueryResult(raw)
  }

  private async requestJson<T>(path: string, options: { method: 'GET' | 'POST'; query?: URLSearchParams; body?: unknown }, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new MemError('memory request aborted', 'MEM_ABORTED')
    using d = deadline(signal, this.limits.timeoutMs, MEM_TIMEOUT)
    const url = this.urlFor(path, options.query)
    const init: RequestInit = { method: options.method, signal: d.signal }
    if (options.body !== undefined) {
      init.headers = { 'content-type': 'application/json' }
      init.body = JSON.stringify(options.body)
    }
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error: unknown) {
      const reason = timeoutOf(d.signal, MEM_TIMEOUT)
      if (reason !== undefined) throw new MemError(`memory request timed out after ${reason.timeoutMs}ms`, 'MEM_TIMEOUT')
      throw new MemError(`memory request failed: ${error instanceof Error ? error.message : String(error)}`, 'MEM_PROVIDER_ERROR')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new MemError(`memory worker returned HTTP ${response.status}: ${text.slice(0, 500)}`, 'MEM_PROVIDER_ERROR')
    }
    return await response.json() as T
  }

  private async requestText(path: string, query: URLSearchParams, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new MemError('memory request aborted', 'MEM_ABORTED')
    using d = deadline(signal, this.limits.timeoutMs, MEM_TIMEOUT)
    const url = this.urlFor(path, query)
    let response: Response
    try {
      response = await fetch(url, { method: 'GET', signal: d.signal })
    } catch (error: unknown) {
      const reason = timeoutOf(d.signal, MEM_TIMEOUT)
      if (reason !== undefined) throw new MemError(`memory request timed out after ${reason.timeoutMs}ms`, 'MEM_TIMEOUT')
      throw new MemError(`memory request failed: ${error instanceof Error ? error.message : String(error)}`, 'MEM_PROVIDER_ERROR')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new MemError(`memory worker returned HTTP ${response.status}: ${text.slice(0, 500)}`, 'MEM_PROVIDER_ERROR')
    }
    return await response.text()
  }

  private urlFor(path: string, query?: URLSearchParams): string {
    const base = this.limits.baseUrl.replace(/\/+$/, '')
    const qs = query !== undefined && query.size > 0 ? `?${query.toString()}` : ''
    return `${base}${path}${qs}`
  }
}

function normalizeQueryResult(raw: unknown): MemSearchResult {
  if (Array.isArray(raw)) {
    return { items: raw.map(asObservation) }
  }
  if (raw !== null && typeof raw === 'object') {
    const { content, ...rest } = raw as Record<string, unknown>
    const items: MemObservation[] = Array.isArray(rest.items) ? (rest.items as unknown[]).map(asObservation) : []
    const text = contentText(content)
    return { items, ...text !== undefined ? { content: text } : {} }
  }
  return { items: [] }
}

function asObservation(value: unknown): MemObservation {
  const record = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const id = typeof record.id === 'number' ? record.id : Number(record.id) || 0
  return {
    id,
    title: typeof record.title === 'string' ? record.title : '',
    ...typeof record.type === 'string' ? { type: record.type } : {},
    ...typeof record.project === 'string' ? { project: record.project } : {},
    ...typeof record.created_at_epoch === 'number'
      ? { createdAtEpoch: record.created_at_epoch }
      : typeof record.createdAtEpoch === 'number' ? { createdAtEpoch: record.createdAtEpoch } : {},
    ...typeof record.narrative === 'string' ? { narrative: record.narrative } : {},
    ...Array.isArray(record.concepts) ? { concepts: record.concepts.filter((c): c is string => typeof c === 'string') } : {},
    ...Array.isArray(record.files) ? { files: record.files.filter((f): f is string => typeof f === 'string') } : {},
  }
}

function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const texts = content
    .filter((block): block is { type: string; text?: unknown } =>
      block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'text',
    )
    .map(block => block.text)
    .filter((text): text is string => typeof text === 'string')
  return texts.length > 0 ? texts.join('\n') : undefined
}
