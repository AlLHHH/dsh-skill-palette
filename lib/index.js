/**
 * dsh-skill-palette — host half.
 *
 * 一条认证路由 `POST /api/dsh-skill-palette/skill-zh`：
 *
 *   {}            → 返回已经翻译好的中文说明缓存
 *   { items: [] } → 让「默认模型」把这些技能的英文说明各压成一句中文，合并写盘
 *
 * 缓存落在 `<dsh home>/skill-zh.json`（和拆开前同一份，翻译结果不浪费）。
 * 只发送技能名与英文描述（都是公开元数据），不发对话、不发文件。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

export const name = 'dsh-skill-palette'

/** 翻译一段说明要多久：一轮模型调用，给足 90 秒。 */
const TRANSLATE_TIMEOUT_MS = 90_000
/** 一次最多翻多少条：太多会吃光模型的输出预算，客户端按 20 条分批。 */
const TRANSLATE_MAX_ITEMS = 40
/** 路由与缓存文件。 */
const ROUTE = '/api/dsh-skill-palette/skill-zh'
const FILE = path.join(process.env.DSH_HOME ?? path.join(homedir(), '.dsh'), 'skill-zh.json')

/** 非数组对象才当记录看，其余一律 null（宿主传进来的结构不可信）。 */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function readZhCache() {
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
    return asRecord(parsed) ?? {}
  } catch {
    return {}
  }
}

/** Persist the cache; a read-only home only costs the next call. */
function writeZhCache(map) {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(map, null, 2) + '\n', 'utf8')
  } catch {
    /* nothing to do: the caller keeps the fresh lines for this session */
  }
}

/** The model route an auxiliary call should use: the harness default selection. */
function defaultRoute(ctx) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  const record = asRecord(selection)
  const provider = typeof record?.provider === 'string' ? record.provider : ''
  const model = typeof record?.model === 'string' ? record.model : ''
  return provider === '' || model === '' ? null : { provider, model }
}

/** Pull the first JSON object out of a model answer, fences and prose included. */
function jsonObjectOf(answer) {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return asRecord(JSON.parse(answer.slice(start, end + 1)))
  } catch {
    return null
  }
}

/**
 * Translate a batch of skill descriptions into short Chinese lines.
 * Only public skill metadata leaves the machine — no conversation, no files.
 */

async function translateItems(ctx, items) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('LLM 服务不可用（宿主没装模型插件）')
  const route = defaultRoute(ctx)
  if (route === null) throw new Error('没有默认模型：先去「设置 → 模型」选一个')
  const lines = items.map((item, index) => (index + 1) + '. ' + item.name + ': ' + String(item.description ?? '').slice(0, 600))
  const prompt = [
    '下面是一批 AI 技能（skill）的名字和英文说明。给每一条写一句中文说明。',
    '要求：',
    '- 每条一行，8 到 30 个汉字，说清「这个技能拿来干什么」，不要复述英文句式；',
    '- 保留必要的专有名词（APK、CSS、Figma、Word 之类）；',
    '- 只输出 JSON 对象，键必须和给定的名字完全一致，值就是中文说明；',
    '- 不要输出解释、不要代码块、不要多余字段。',
    '',
    ...lines,
  ].join('\n')
  let answer = ''
  const controller = new AbortController()
  const guard = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS)
  try {
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system: '你是一个翻译器，只输出严格的 JSON。',
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin:dsh-skill-palette' } })],
      temperature: 0.2,
      maxTokens: 4000,
      signal: controller.signal,
    })) {
      if (chunk.type === 'text-delta') answer += chunk.text
    }
  } finally {
    clearTimeout(guard)
  }
  const parsed = jsonObjectOf(answer)
  if (parsed === null) throw new Error('模型没有返回可解析的 JSON')
  const out = {}
  for (const item of items) {
    const value = parsed[item.name]
    if (typeof value === 'string' && value.trim() !== '') out[item.name] = value.trim().slice(0, 120)
  }
  if (Object.keys(out).length === 0) throw new Error('模型返回空结果')
  return out
}

/** The client's poll cadence; the platform read is cached for the same window. */

export function apply(ctx) {
  ctx.inject(['connection'], (c) => {
    const connection = c.get('connection')
    const register = typeof connection?.fetch?.register === 'function' ? connection.fetch.register.bind(connection.fetch) : undefined
    if (register === undefined) return
    const handler = async (request) => {
      let body = null
      try {
        body = await request.json()
      } catch {
        body = null
      }
      if (body?.clear === true) {
        writeZhCache({})
        return Response.json({ ok: true, value: {} }, { headers: { 'cache-control': 'no-store' } })
      }
      const items = Array.isArray(body?.items) ? body.items : []
      const wanted = items
        .filter((item) => item !== null && typeof item === 'object' && typeof item.name === 'string' && item.name !== '')
        .slice(0, TRANSLATE_MAX_ITEMS)
      if (wanted.length === 0) {
        return Response.json({ ok: true, value: readZhCache() }, { headers: { 'cache-control': 'no-store' } })
      }
      try {
        const fresh = await translateItems(ctx, wanted)
        const merged = { ...readZhCache(), ...fresh }
        writeZhCache(merged)
        return Response.json({ ok: true, value: merged }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error?.message ?? error) },
          { status: 502, headers: { 'cache-control': 'no-store' } },
        )
      }
    }
    try {
      c.effect(
        () => register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: handler }),
        'dsh-skill-palette: /api route',
      )
    } catch {
      /* 注册表拒绝不等于插件失败 */
    }
  })
}

export default { name, apply }
