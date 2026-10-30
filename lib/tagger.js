// nekowhale-meme · 识别（打标签）
// 串行、可中止、25 情绪校验。走宿主 llm 服务独立调用，不占用对话上下文。
//
// 关于依赖：本插件用 `link:` 方式安装时，裸导入 `@deepseek-ai/*` 会走真实路径解析，
// 未必拿得到。所以对 dsh-llm 一律**动态导入 + 本地兜底**：
//   - BlockAssembler / createUserMessage 拿得到就用官方实现（与 dsh-pet 同一写法）
//   - 拿不到就用这里的最小实现，保证识别这条链在任何安装方式下都能跑
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { EMOTIONS } from './store.js'

const CALL_IDENTITY = 'nekowhale-meme-tagger'
const TURN_TIMEOUT_MS = 90_000

const MEDIA_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export function mediaTypeOf(path) {
  return MEDIA_BY_EXT[extname(String(path ?? '')).toLowerCase()] ?? 'image/png'
}

/** 最小文本累积器：只关心 text-delta 与 finish，够识别用。 */
class TextAssembler {
  constructor() {
    this.parts = []
    this._finish = { kind: 'stop' }
  }
  push(chunk) {
    if (!chunk || typeof chunk !== 'object') return
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') this.parts.push(chunk.text)
    else if (chunk.type === 'finish') this._finish = chunk.reason ?? { kind: 'stop' }
  }
  text() {
    return this.parts.join('')
  }
  get finish() {
    return this._finish
  }
}

let llmModPromise
function llmMod() {
  llmModPromise ??= import('@deepseek-ai/dsh-llm').then((m) => m).catch(() => null)
  return llmModPromise
}

/** 造一条 user 消息：官方 helper 优先，否则手搓一个等价形状。 */
async function makeUserMessage(content) {
  const mod = await llmMod()
  if (mod?.createUserMessage) {
    try { return mod.createUserMessage({ content, source: { kind: 'user' } }) } catch { /* 落到手搓 */ }
  }
  return { id: randomUUID(), role: 'user', content, source: { kind: 'user' } }
}

function makeAssembler(mod) {
  if (mod?.BlockAssembler) {
    try { return new mod.BlockAssembler() } catch { /* 落到本地实现 */ }
  }
  return new TextAssembler()
}

function blocksText(asm) {
  if (typeof asm.blocks === 'function') {
    return asm.blocks()
      .filter((b) => b && b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join('')
  }
  return typeof asm.text === 'function' ? asm.text() : ''
}

export const SYSTEM_PROMPT = `你是表情包标注员。用户给你一张表情图，你只输出一个 JSON 对象，不要任何解释、不要代码块围栏。

字段：
- emotion：从下列 25 个中文情绪里**选恰好一个**，必须逐字与列表一致：${EMOTIONS.join('、')}。列表里实在没有合适的才选「其他」，不要自造词（自造会被系统归为「其他」，丢失信息）
- tags：**4-7 个**中文短词，描述画面内容与适合的场景（如 摸鱼、被夸、摆烂、递茶、期待）
- use：**10-20 字**，一句话说明什么时候发它合适
- desc：**40-70 字**，描述表情、动作和整体状态（如：眯着眼睛微笑，脸颊泛红，两只手举在胸前反复搓动，身体轻轻晃动）

只输出 JSON，例如：
{"emotion":"兴奋","tags":["期待","搓手","跃跃欲试","等好消息","想要"],"use":"期待好事发生时","desc":"眯着眼睛微笑，脸颊泛红，两只白色猫爪般的手举在胸前反复贴合搓动，身体和头发跟着轻轻晃动，显得十分期待。"}`

/** 从模型输出里抠出 JSON 对象。允许外面套代码块或带前后废话。 */
export function parseTagJson(text) {
  const raw = String(text ?? '').trim()
  const tries = [raw]
  const fence = /```(?:json)?\s*([\s\S]*?)```/iu.exec(raw)
  if (fence) tries.push(fence[1].trim())
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) tries.push(raw.slice(first, last + 1))
  for (const t of tries) {
    if (!t) continue
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return validateTag(obj)
    } catch { /* 换下一种抠法 */ }
  }
  return { ok: false, reason: '模型没有返回合法 JSON' }
}

/**
 * 校验并规整模型的输出。
 * 字段尺度对齐作者的标注表（322 条实测）：tags 4-7 个、use 9-20 字、desc 50-76 字。
 * 校验不过于严苛——宁可留空格也不判死。**情绪不在 25 个之内（含空/自造词如「空」）
 * 不拒绝**：一律归入「其他」照常进待确认，由用户在确认环节修正（用户拍板）。
 */
export function validateTag(obj) {
  const raw = typeof obj.emotion === 'string' ? obj.emotion.trim() : ''
  const known = EMOTIONS.includes(raw)
  const emotion = known ? raw : '其他'
  let tags = Array.isArray(obj.tags)
    ? obj.tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 7)
    : []
  // 兜底：作者最少的也是 4 个；模型给太少时补通用词，别留一个孤零零的「表情」
  if (tags.length === 0) tags = ['表情', '待补充', '未分类']
  return {
    ok: true,
    tag: {
      emotion,
      tags,
      use: typeof obj.use === 'string' ? obj.use.trim().slice(0, 40) : '',
      desc: typeof obj.desc === 'string' ? obj.desc.trim().slice(0, 90) : '',
    },
    // 留痕：被归入「其他」时带上模型原词，UI/日志可提示用户去确认环节修正
    ...(!known ? { normalized: true, rawEmotion: raw } : {}),
  }
}

/** 列出所有 provider 及其模型（含是否支持图片输入），供队列页下拉用。 */
export async function listModelCatalog(llm) {
  if (!llm) return []
  const named = (id, name) => ({ id: String(id ?? ''), name: String(name ?? '') || String(id ?? '') })
  let providers = (typeof llm.listProviders === 'function' ? llm.listProviders() : []).map((p) => named(p?.id, p?.name))
  if (providers.length === 0 && typeof llm.listConfigurableProviders === 'function') {
    providers = llm.listConfigurableProviders().map((p) => named(p?.provider, p?.displayName))
  }
  providers = providers.filter((p) => p.id)
  const out = []
  for (const p of providers) {
    let models = []
    try {
      const list = await llm.listModels?.(p.id)
      models = (Array.isArray(list) ? list : []).map((m) => named(m?.id, m?.name)).filter((m) => m.id)
    } catch { /* 该 provider 没有模型列表就跳过 */ }
    for (const m of models) {
      let vision = false
      try {
        const info = await llm.resolveModelInfo?.(p.id, m.id)
        const input = info?.input ?? info?.inputModalities
        if (Array.isArray(input)) vision = input.includes('image')
        else if (info?.vision === true) vision = true
        else if (Array.isArray(info?.modalities?.input)) vision = info.modalities.input.includes('image')
      } catch { /* 拿不到模态信息就按不支持图片算 */ }
      out.push({ provider: p.id, providerName: p.name, model: m.id, modelName: m.name, vision })
    }
  }
  return out
}

/** 当前 DSH 默认模型 { provider, model }。 */
export function defaultModelOf(ctx) {
  try {
    const sel = ctx.agentDefaultModel?.currentSelection?.()
    if (sel?.provider && sel?.model) return { provider: String(sel.provider), model: String(sel.model) }
  } catch { /* 没有这个服务就算了 */ }
  return undefined
}

/**
 * 选识别模型：用户手动选过就沿用；否则取「原生默认 + 支持视觉」，再否则任一支持视觉的。
 * @returns {{provider,model}|undefined}
 */
export async function resolveTagModel(ctx, llm, configured) {
  if (configured?.provider && configured?.model) return configured
  const catalog = await listModelCatalog(llm)
  const vision = catalog.filter((r) => r.vision)
  const dflt = defaultModelOf(ctx)
  if (dflt) {
    const hit = vision.find((r) => r.provider === dflt.provider && r.model === dflt.model)
    if (hit) return { provider: hit.provider, model: hit.model }
    const sameProvider = vision.find((r) => r.provider === dflt.provider)
    if (sameProvider) return { provider: sameProvider.provider, model: sameProvider.model }
  }
  if (vision.length > 0) return { provider: vision[0].provider, model: vision[0].model }
  return undefined
}

/** 串行、可中止的单批识别器。 */
export class Tagger {
  /** 当前这张图的请求中止控制器（cancel() 掐它，实现秒停）。 */
  #abortCtl = null

  constructor({ ctx, store, llm, log = () => {} }) {
    this.ctx = ctx
    this.store = store
    this.llm = llm
    this.log = log
    this.running = false
    this.cancelRequested = false
    // 当前这张图的请求中止控制器：cancel() 直接 abort 它，实现秒停
    this.#abortCtl = null
    this.progress = { active: false, done: 0, total: 0, currentId: '', model: null, stopped: false, failures: 0 }
    this.onChange = () => {}
  }

  get state() {
    return { ...this.progress, active: this.running }
  }

  cancel() {
    if (!this.running) return false
    this.cancelRequested = true
    // 关键：只置标志位的话，当前这张的模型调用要跑到超时（90s）才轮到检查——
    // 用户点「中止」看起来就是无反应。这里同时掐断进行中的请求，让它立刻抛错返回。
    try { this.#abortCtl?.abort(new Error('用户中止')) } catch { /* 已 abort 过 */ }
    return true
  }

  #emit() {
    try { this.onChange(this.state) } catch { /* UI 回调出错不影响识别 */ }
  }

  /**
   * 批量识别。整批串行，点中止后当前这张跑完就停，其余保持待识别。
   * @param {string[]} ids
   * @param {{provider,model}|undefined} model
   */
  async run(ids, model) {
    if (this.running) return { error: '已经在识别中，请先中止' }
    const targets = ids.map((id) => this.store.item(id)).filter((it) => it && it.state === 'pending')
    if (targets.length === 0) return { error: '没有可识别的图（只有「待识别」可以识别）' }
    const sel = model?.provider && model?.model
      ? model
      : await resolveTagModel(this.ctx, this.llm(), undefined)
    if (!sel) return { error: '找不到支持图片输入的模型，请在队列页手动选一个' }
    this.running = true
    this.cancelRequested = false
    this.progress = { active: true, done: 0, total: targets.length, currentId: '', model: sel, stopped: false, failures: 0 }
    this.#emit()
    const results = []
    for (const it of targets) {
      if (this.cancelRequested) { this.progress.stopped = true; break }
      this.progress.currentId = it.id
      this.#emit()
      this.#abortCtl = new AbortController()
      const r = await this.#tagOne(it, sel)
      this.#abortCtl = null
      // 中止掐断的是当前这张：它没得到结果，退回待识别但不算失败、不记失败原因
      if (r.aborted) {
        this.progress.stopped = true
        this.#emit()
        break
      }
      this.progress.done += 1
      if (r.ok) {
        // 模型自造的情绪被归入「其他」时，把原词塞进标签，用户在确认环节能看到并修正
        if (r.normalized && r.rawEmotion) {
          r.tag.tags = [r.rawEmotion, ...r.tag.tags].slice(0, 7)
        }
        this.store.applyTag(it.id, r.tag)
        results.push({ id: it.id, ok: true, tag: r.tag })
      } else {
        this.store.markFail(it.id, r.reason)
        this.progress.failures += 1
        results.push({ id: it.id, ok: false, reason: r.reason })
      }
      this.#emit()
    }
    this.running = false
    this.progress.active = false
    this.progress.currentId = ''
    this.#emit()
    return { results, stopped: this.progress.stopped, model: sel }
  }

  async #tagOne(it, sel) {
    const abs = this.store.absPath(it.file)
    let bytes
    try {
      bytes = await readFile(abs)
    } catch {
      return { ok: false, reason: '读不到图片文件' }
    }
    if (bytes.length === 0) return { ok: false, reason: '图片是空文件' }
    const mediaType = mediaTypeOf(abs)
    const attachments = this.ctx.get('attachments')
    if (!attachments?.saveImage) return { ok: false, reason: '宿主没提供 attachments 服务，图片无法交给模型' }
    let attachment
    try {
      attachment = await attachments.saveImage({ data: bytes, mediaType, name: it.originalName })
    } catch (e) {
      return { ok: false, reason: `图片没能交给模型：${e?.message ?? e}` }
    }
    if (!attachment) return { ok: false, reason: '附件服务没有返回可用的图片引用' }
    const llm = this.llm()
    if (!llm || typeof llm.stream !== 'function') return { ok: false, reason: 'LLM 服务不可用' }
    const content = [
      { type: 'image', attachment },
      { type: 'text', text: '请按 system 的格式给这张表情打标签，只输出 JSON。' },
    ]
    const userMessage = await makeUserMessage(content)
    const mod = await llmMod()
    const assembler = makeAssembler(mod)
    try {
      for await (const chunk of llm.stream({
        provider: sel.provider,
        model: sel.model,
        sessionId: CALL_IDENTITY,
        messages: [userMessage],
        system: SYSTEM_PROMPT,
        temperature: 0.2,
        // 超时 + 用户中止共用同一个 signal：cancel() 掐控制器，这张立刻抛回
        signal: this.#abortCtl
          ? AbortSignal.any([AbortSignal.timeout(TURN_TIMEOUT_MS), this.#abortCtl.signal])
          : AbortSignal.timeout(TURN_TIMEOUT_MS),
      })) assembler.push(chunk)
    } catch (e) {
      if (this.cancelRequested) return { ok: false, aborted: true }
      return { ok: false, reason: `调用模型失败：${e?.message ?? e}` }
    }
    const text = blocksText(assembler).trim()
    if (!text) {
      const finish = assembler.finish ?? { kind: 'stop' }
      return { ok: false, reason: finish?.kind === 'max-tokens' ? '输出被截断' : '模型没有返回内容' }
    }
    return parseTagJson(text)
  }
}
