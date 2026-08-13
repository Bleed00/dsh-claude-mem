/**
 * Model-facing memory tools over a `WorkerClient`. Owns schemas, validation,
 * and presentation; execution goes through the worker client.
 * @module dsh-claude-mem/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkerClient } from './worker.js'
import type {
  MemGetObservationsRequest,
  MemSaveRequest,
  MemSearchRequest,
  MemSearchResult,
  MemTimelineRequest,
} from './types.js'

export interface ToolsConfig {
  search?: boolean
  timeline?: boolean
  getObservations?: boolean
  save?: boolean
  context?: boolean
  timeoutMs: number
}

/** One observation's schema-exact projection (mutable, all-optional extras). */
interface IndexItem {
  id: number
  title: string
  type?: string
  project?: string
  createdAtEpoch?: number
  narrative?: string
}

interface QueryOutput {
  items: IndexItem[]
  content?: string
}

function projectQueryResult(value: MemSearchResult): QueryOutput {
  const items: IndexItem[] = value.items.map(item => ({
    id: item.id,
    title: item.title,
    ...item.type !== undefined ? { type: item.type } : {},
    ...item.project !== undefined ? { project: item.project } : {},
    ...item.createdAtEpoch !== undefined ? { createdAtEpoch: item.createdAtEpoch } : {},
    ...item.narrative !== undefined ? { narrative: item.narrative } : {},
  }))
  return {
    items,
    ...value.content !== undefined ? { content: value.content } : {},
  }
}

/** Register the enabled memory tools on `ctx.tools`. */
export function applyMemoryTools(ctx: Context, worker: WorkerClient, config: ToolsConfig): void {
  if (config.search !== false) applySearchTool(ctx, worker, config.timeoutMs)
  if (config.timeline !== false) applyTimelineTool(ctx, worker, config.timeoutMs)
  if (config.getObservations !== false) applyGetObservationsTool(ctx, worker, config.timeoutMs)
  if (config.save !== false) applySaveTool(ctx, worker, config.timeoutMs)
  if (config.context !== false) applyContextTool(ctx, worker, config.timeoutMs)
}

function applySearchTool(ctx: Context, worker: WorkerClient, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'mem_search',
    description: 'Search persistent cross-session memory for observations matching a query. Returns an index with ids, titles, and types — fetch full details only for filtered ids.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text search query.' },
      limit: { type: 'integer', description: 'Max results (default 20).' },
      project: { type: 'string', description: 'Filter by project name.' },
      platformSource: { type: 'string', description: 'Optional platform filter (e.g. "dsh"); omit to search all memory.' },
      type: { type: 'string', description: "Category: 'observations', 'sessions', or 'prompts'." },
      obsType: { type: 'string', description: 'Comma-separated observation types (e.g. bugfix, feature, decision).' },
      dateStart: { type: 'string', description: 'Start date filter (ISO).' },
      dateEnd: { type: 'string', description: 'End date filter (ISO).' },
      offset: { type: 'integer', description: 'Pagination offset.' },
      orderBy: { type: 'string', description: "'date_desc' or 'date_asc'." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false, properties: {
              id: { type: 'number', required: true },
              title: { type: 'string', required: true },
              type: { type: 'string' },
              project: { type: 'string' },
              createdAtEpoch: { type: 'number' },
              narrative: { type: 'string' },
            },
          } },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatQueryOutput(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return projectQueryResult(await worker.search(buildSearchRequest(args), exec.signal))
    },
  }))
}

function applyTimelineTool(ctx: Context, worker: WorkerClient, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'mem_timeline',
    description: 'Get context around one memory observation (its surrounding observations) by id or query.',
    parameters: {
      anchor: { type: 'integer', description: 'Observation id to center around.' },
      query: { type: 'string', description: 'Find the anchor from this query.' },
      depthBefore: { type: 'integer', description: 'Items before anchor (default 3).' },
      depthAfter: { type: 'integer', description: 'Items after anchor (default 3).' },
      project: { type: 'string', description: 'Filter by project name.' },
      platformSource: { type: 'string', description: 'Optional platform filter; omit to search all memory.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false, properties: {
              id: { type: 'number', required: true },
              title: { type: 'string', required: true },
              type: { type: 'string' },
              project: { type: 'string' },
              narrative: { type: 'string' },
            },
          } },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatQueryOutput(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input: MemTimelineRequest = {
        ...args.anchor !== undefined ? { anchor: args.anchor } : {},
        ...args.query !== undefined ? { query: args.query } : {},
        ...args.depthBefore !== undefined ? { depthBefore: args.depthBefore } : {},
        ...args.depthAfter !== undefined ? { depthAfter: args.depthAfter } : {},
        ...args.project !== undefined ? { project: args.project } : {},
        ...args.platformSource !== undefined ? { platformSource: args.platformSource } : {},
      }
      return projectQueryResult(await worker.timeline(input, exec.signal))
    },
  }))
}

function applyGetObservationsTool(ctx: Context, worker: WorkerClient, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'mem_get_observations',
    description: 'Fetch full details (narrative) for memory observations by id.',
    parameters: {
      ids: { type: 'array', required: true, items: { type: 'integer' }, description: 'Observation ids (required).' },
      project: { type: 'string', description: 'Filter by project name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false, properties: {
              id: { type: 'number', required: true },
              title: { type: 'string', required: true },
              type: { type: 'string' },
              project: { type: 'string' },
              narrative: { type: 'string' },
            },
          } },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatQueryOutput(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.ids.length === 0) throw new Error('at least one observation id is required')
      const input: MemGetObservationsRequest = {
        ids: args.ids,
        ...args.project !== undefined ? { project: args.project } : {},
      }
      return projectQueryResult(await worker.getObservations(input, exec.signal))
    },
  }))
}

function applySaveTool(ctx: Context, worker: WorkerClient, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'mem_save',
    description: 'Save one manual memory as an observation in persistent memory (no generation job; stores the text as given).',
    parameters: {
      text: { type: 'string', required: true, description: 'Memory text to save.' },
      title: { type: 'string', description: 'Optional title.' },
      project: { type: 'string', description: 'Optional project.' },
      metadata: { type: 'object', additionalProperties: true, description: 'Optional free-form metadata.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          id: { type: 'number', required: true },
          title: { type: 'string', required: true },
          project: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Saved observation #${value.id} (${value.title})` }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input: MemSaveRequest = {
        text: args.text.trim(),
        ...args.title !== undefined ? { title: args.title } : {},
        ...args.project !== undefined ? { project: args.project } : {},
        ...args.metadata !== undefined ? { metadata: args.metadata } : {},
      }
      return await worker.save(input, exec.signal)
    },
  }))
}

function applyContextTool(ctx: Context, worker: WorkerClient, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'mem_context',
    description: 'Render the worker\'s session-start context text for one or more projects (the same text injected at startup).',
    parameters: {
      projects: { type: 'string', required: true, description: 'Project chain, comma-separated; the last is primary.' },
      platformSource: { type: 'string', description: 'Optional platform filter.' },
      full: { type: 'boolean', description: 'Request full context instead of configured limits.' },
      colors: { type: 'boolean', description: 'Request terminal-color formatting.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.projects.trim().length === 0) throw new Error('at least one project is required')
      return await worker.context({
        projects: args.projects,
        ...args.platformSource !== undefined ? { platformSource: args.platformSource } : {},
        ...args.full !== undefined ? { full: args.full } : {},
        ...args.colors !== undefined ? { colors: args.colors } : {},
      }, exec.signal)
    },
  }))
}

function buildSearchRequest(args: {
  query: string
  limit?: number
  project?: string
  platformSource?: string
  type?: string
  obsType?: string
  dateStart?: string
  dateEnd?: string
  offset?: number
  orderBy?: string
}): MemSearchRequest {
  const orderBy = args.orderBy === 'date_asc' || args.orderBy === 'date_desc' ? args.orderBy : undefined
  return {
    query: args.query.trim(),
    ...args.limit !== undefined ? { limit: args.limit } : {},
    ...args.project !== undefined ? { project: args.project } : {},
    ...args.platformSource !== undefined ? { platformSource: args.platformSource } : {},
    ...args.type !== undefined ? { type: args.type } : {},
    ...args.obsType !== undefined ? { obsType: args.obsType } : {},
    ...args.dateStart !== undefined ? { dateStart: args.dateStart } : {},
    ...args.dateEnd !== undefined ? { dateEnd: args.dateEnd } : {},
    ...args.offset !== undefined ? { offset: args.offset } : {},
    ...orderBy !== undefined ? { orderBy } : {},
  }
}

export function formatQueryOutput(value: QueryOutput): string {
  if (value.content !== undefined && value.content.length > 0) return value.content
  if (value.items.length === 0) return 'No results found.'
  return value.items
    .map((item) => {
      const type = item.type !== undefined ? ` [${item.type}]` : ''
      const project = item.project !== undefined ? ` (${item.project})` : ''
      const narrative = item.narrative !== undefined ? `\n  ${item.narrative}` : ''
      return `#${item.id} ${item.title}${type}${project}${narrative}`
    })
    .join('\n')
}
