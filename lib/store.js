// nekowhale-meme · 数据层
// 负责：数据目录解析、config/index/health 读写、命名规则、SHA-1 去重、
// pending → tagged → library 三态流转、分组的增删改名移图。
//
// 设计要点（与方案.md 对齐）：
// - 磁盘文件名永不重命名。用户改名只改索引里的 displayName。
// - 进队列：<YYYYMMDDTHHMMSS>-<6位哈希>.<ext>
// - 入库：  <组id>-<时间戳>-<6位哈希>.<ext>
// - nekowhale 导入的图保留原名（只读组，不参与重命名与 SHA-1 冲突改名）。
// - index.json 写前留一份 .bak。
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

/** 25 个中文情绪：与 nekowhale 一一对应，单选。 */
export const EMOTIONS = [
  '开心', '大笑', '喜欢', '害羞', '得意', '兴奋', '惊讶', '疑惑', '思考', '无语',
  '难过', '哭', '生气', '害怕', '疲惫', '赞同', '拒绝', '打招呼', '感谢', '道歉',
  '卖萌', '搞怪', '嘲讽', '安慰', '其他',
]
export const EMOTION_SET = new Set(EMOTIONS)

export const GROUP_READONLY_NEKOWHALE = 'nekowhale'
export const GROUP_FAV = 'fav'
export const GROUP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/u
export const STATE_PENDING = 'pending'
export const STATE_TAGGED = 'tagged'
export const STATE_LIBRARY = 'library'

/** 一个角色包对应的只读组 id：`pack-<包名的 sha1 前 8 位>`，跨次运行稳定。 */
export function packGroupId(packName) {
  return `pack-${createHash('sha1').update(String(packName)).digest('hex').slice(0, 8)}`
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
export const MAX_BYTES = 8 * 1024 * 1024
export const MAX_EDGE = 2048

/** 允许的图片后缀（小写，带点）。 */
export function isImageName(name) {
  return IMAGE_EXT.has(extname(String(name ?? '')).toLowerCase())
}

/** 6 位十六进制短哈希。 */
export function shortHash(bytes) {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 6)
}

export function sha1Of(bytes) {
  return createHash('sha1').update(bytes).digest('hex')
}

/** `20261029T014312` —— 本地时间紧凑戳，用作文件名与 id 的组成部分。 */
export function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** `2026-10-29T01:43:12Z` —— 索引里的 addedAt（ISO，UTC）。 */
export function isoNow(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/u, 'Z')
}

/** 生成一个不重复的 6 位哈希文件段：内容哈希 + 必要时盐。 */
export function uniqueStem(bytes, taken) {
  let ha = shortHash(bytes)
  let salt = 0
  while (taken.has(ha)) {
    salt += 1
    ha = createHash('sha1').update(bytes).update(`#${salt}`).digest('hex').slice(0, 6)
  }
  return ha
}

/** 组 id → 目录名。只读组用它的中文名（包名），自定义组用组 id。 */
export function groupDirName(group) {
  if (group.readonly) return String(group.name || group.id)
  if (group.id === GROUP_FAV) return '我的收藏'
  return group.id
}

/** 把任意用户输入规范成合法组 id；重复则加数字后缀。 */
export function makeGroupId(label, taken) {
  const ascii = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^[-_]+|[-_]+$/gu, '')
    .slice(0, 24)
  let base = ascii || `g${randomBytes(2).toString('hex')}`
  if (!GROUP_ID_RE.test(base)) base = `g${randomBytes(2).toString('hex')}`
  let id = base
  let n = 1
  while (taken.has(id) || id === GROUP_READONLY_NEKOWHALE || id === GROUP_FAV) {
    id = `${base.slice(0, 28)}${n}`
    n += 1
  }
  return id
}

/**
 * 数据目录默认值：`$DSH_HOME/nekowhale-meme`。
 *
 * 与 dsh-nekowhale-stickers 等其他插件的约定一致——默认落在 DSH 家目录下，
 * 而不是某个盘符的固定路径。**绝不写死具体盘符**：别人装了如果没那个盘会直接崩。
 * 用户可以在设置页改成任意位置（包括外接盘）。
 */
export function defaultDataDir() {
  const home = process.env.DSH_HOME
  if (home && isAbsolute(home)) return join(home, 'nekowhale-meme')
  // 没读到 DSH_HOME 时的兜底：按各平台的家目录约定
  if (process.platform === 'win32') {
    const base = process.env.USERPROFILE || process.env.HOME
    if (base) return join(base, '.dsh', 'nekowhale-meme')
  } else {
    const base = process.env.HOME
    if (base) return join(base, '.dsh', 'nekowhale-meme')
  }
  return join(process.cwd(), 'nekowhale-meme')
}

/** 原子写 JSON：先写 .tmp 再 rename，写 index 前留 .bak。目录不存在时自动建。 */
function writeJsonAtomic(file, value, { backup = false } = {}) {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const text = `${JSON.stringify(value, null, 2)}\n`
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, 'utf8')
  if (backup && existsSync(file)) {
    try { copyFileSync(file, `${file}.bak`) } catch { /* 备份失败不阻塞主流程 */ }
  }
  renameSync(tmp, file)
}

function readJson(file, fallback) {
  try {
    const raw = readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** 一份在内存里的索引，读写都走它；所有变更后立即落盘。 */
export class Store {
  constructor(dataDir, { log = () => {} } = {}) {
    this.log = log
    this.dir = resolve(dataDir)
    this.pendingDir = join(this.dir, 'pending')
    this.libraryDir = join(this.dir, 'library')
    this.indexFile = join(this.dir, 'index.json')
    this.healthFile = join(this.dir, 'health.json')
    this.configFile = join(this.dir, 'config.json')
    this.index = this.#loadIndex()
  }

  get dataDir() { return this.dir }

  #ensureDirs() {
    for (const d of [this.dir, this.pendingDir, this.libraryDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true })
    }
  }

  /**
   * 首次落到一个新目录时，把目录结构与默认索引一起建好。
   * 换数据目录（设置页改路径）后立刻可见，不必等第一次变更。
   */
  init() {
    this.#ensureDirs()
    if (!existsSync(this.indexFile)) writeJsonAtomic(this.indexFile, this.index)
    return this
  }

  #loadIndex() {
    const raw = readJson(this.indexFile, null)
    const groups = Array.isArray(raw?.groups) ? raw.groups : []
    // 只读组按包动态创建（见 ensurePackGroup），这里只在**全新库**里预置大肥鱼那两包
    if (groups.length === 0) {
      groups.push({ id: GROUP_FAV, name: '我的收藏', readonly: false, order: 0 })
    }
    if (!groups.some((g) => g.id === GROUP_FAV)) {
      groups.push({ id: GROUP_FAV, name: '我的收藏', readonly: false, order: groups.length })
    }
    const items = Array.isArray(raw?.items) ? raw.items.map((it) => ({
      state: STATE_LIBRARY,
      enabled: true,
      tags: [],
      ...it,
    })) : []
    return { version: 1, groups, items }
  }

  /**
   * 取（或建）某个角色包对应的只读组。
   * @param {string} packName 站点上的包名，如「大肥鱼」「玛丽」
   * @param {string} [packKey] 可选的稳定 key（默认由包名派生）
   */
  ensurePackGroup(packName, packKey) {
    const id = packKey || packGroupId(packName)
    let g = this.group(id)
    if (!g) {
      g = { id, name: String(packName), readonly: true, pack: String(packName), order: this.index.groups.length }
      this.index.groups.push(g)
      this.save()
    } else if (!g.readonly || g.name !== String(packName)) {
      // 名称/pack 字段补正（老数据可能只有 id）
      g.readonly = true
      g.name = String(packName)
      g.pack = String(packName)
      this.save()
    }
    return g
  }

  save() {
    this.#ensureDirs()
    writeJsonAtomic(this.indexFile, this.index, { backup: true })
  }

  /** 所有已知磁盘文件段（防撞名用）。 */
  #takenSegments() {
    const taken = new Set()
    for (const it of this.index.items) {
      const parts = String(it.file ?? '').split(/[\\/]/u).pop() ?? ''
      const m = /-([0-9a-f]{6})\.\w+$/u.exec(parts)
      if (m) taken.add(m[1])
      else taken.add(shortHashFromName(parts))
    }
    return taken
  }

  groups() {
    return [...this.index.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
  }

  group(id) {
    return this.index.groups.find((g) => g.id === id)
  }

  groupCounts() {
    const out = {}
    for (const it of this.index.items) {
      if (it.state !== STATE_LIBRARY) continue
      out[it.group] = (out[it.group] ?? 0) + 1
    }
    return out
  }

  itemsByState(state) {
    return this.index.items.filter((it) => it.state === state)
  }

  item(id) {
    return this.index.items.find((it) => it.id === id)
  }

  /** 相对数据目录的路径（索引里存相对路径，换目录不炸）。 */
  relPath(abs) {
    return abs.startsWith(this.dir) ? abs.slice(this.dir.length).replace(/^[\\/]+/u, '').split(/[\\/]/u).join('/') : abs
  }

  absPath(rel) {
    return resolve(this.dir, ...String(rel).split('/'))
  }

  /**
   * 把一个已有文件收进待识别队列。
   * @param {string} sourceAbs 源文件绝对路径
   * @param {object} opts { displayName?, originalName?, source? }
   * @returns 新条目（state=pending），或 { skipped: 原因 }
   */
  async addToPending(sourceAbs, opts = {}) {
    this.#ensureDirs()
    if (!existsSync(sourceAbs)) return { skipped: '文件不存在' }
    let info
    try { info = await stat(sourceAbs) } catch { return { skipped: '读不到文件信息' } }
    if (!info.isFile()) return { skipped: '不是一个文件' }
    if (info.size <= 0) return { skipped: '空文件' }
    if (info.size > MAX_BYTES) return { skipped: `超过 8MB（${(info.size / 1024 / 1024).toFixed(1)}MB），请先压缩` }
    if (!isImageName(sourceAbs)) return { skipped: '不支持的图片格式' }
    const bytes = readFileSync(sourceAbs)
    const sha1 = sha1Of(bytes)
    const dup = this.index.items.find((it) => it.sha1 === sha1 && it.state === STATE_LIBRARY)
    if (dup) {
      const g = this.group(dup.group)
      return { skipped: `这张已经在库里（组「${g?.name ?? dup.group}」下）`, duplicateOf: dup.id }
    }
    const taken = this.#takenSegments()
    const seg = uniqueStem(bytes, taken)
    const st = stampNow()
    const id = `${st}-${seg}`
    const ext = extname(sourceAbs).toLowerCase()
    const fileName = `${id}${ext}`
    const target = join(this.pendingDir, fileName)
    await copyFile(sourceAbs, target)
    const item = {
      id,
      state: STATE_PENDING,
      group: opts.group ?? GROUP_FAV,
      file: this.relPath(target),
      displayName: opts.displayName || basename(sourceAbs, ext),
      originalName: opts.originalName || basename(sourceAbs),
      emotion: null,
      tags: [],
      use: '',
      desc: '',
      addedAt: isoNow(),
      source: opts.source || 'upload',
      sha1,
      bytes: info.size,
      enabled: true,
      failReason: '',
    }
    this.index.items.unshift(item)
    this.save()
    return item
  }

  /** 待识别条目 → 打标签结果（仅内存字段，不搬文件）。 */
  applyTag(id, patch) {
    const it = this.item(id)
    if (!it || it.state !== STATE_PENDING) return undefined
    it.state = STATE_TAGGED
    it.emotion = patch.emotion
    it.tags = patch.tags ?? []
    it.use = patch.use ?? ''
    it.desc = patch.desc ?? ''
    it.failReason = ''
    this.save()
    return it
  }

  /** 识别失败：退回 pending 并记原因。 */
  markFail(id, reason) {
    const it = this.item(id)
    if (!it) return undefined
    it.state = STATE_PENDING
    it.failReason = String(reason ?? '识别失败').slice(0, 200)
    this.save()
    return it
  }

  /** 撤销一次误标（tagged → pending），用于「重新识别」前清空。 */
  backToPending(id) {
    const it = this.item(id)
    if (!it || it.state !== STATE_TAGGED) return undefined
    it.state = STATE_PENDING
    it.emotion = null
    it.tags = []
    it.use = ''
    it.desc = ''
    it.failReason = ''
    this.save()
    return it
  }

  /**
   * tagged → library：把文件从 pending/ 搬到 library/<组目录>/ 并改名。
   * 磁盘名 = <组id>-<时间戳>-<6位哈希>.<ext>
   */
  async confirm(id, groupId) {
    const it = this.item(id)
    if (!it) return { error: '条目不存在' }
    if (it.state !== STATE_TAGGED) return { error: '只有「已标识·待确认」的图可以入库' }
    const g = this.group(groupId || it.group)
    if (!g) return { error: '目标分组不存在' }
    const from = this.absPath(it.file)
    if (!existsSync(from)) {
      this.removeItem(id, { reason: '文件已不存在' })
      return { error: '源文件已不存在，已从索引移除' }
    }
    const ext = extname(from).toLowerCase()
    const stamp = (it.id.split('-').at(-2) || stampNow())
    let seg = it.id.split('-').at(-1)
    if (g.readonly) {
      // 只读组（角色包）不接受手工入库
      return { error: `「${g.name}」是只读组，不能手工入库` }
    }
    // 组内撞名时加盐重算
    const dir = join(this.libraryDir, groupDirName(g))
    await mkdir(dir, { recursive: true })
    let finalName = `${g.id}-${stamp}-${seg}${ext}`
    let salt = 0
    while (existsSync(join(dir, finalName))) {
      salt += 1
      seg = createHash('sha1').update(String(it.sha1)).update(`#${salt}`).digest('hex').slice(0, 6)
      finalName = `${g.id}-${stamp}-${seg}${ext}`
    }
    const to = join(dir, finalName)
    try {
      await rename(from, to)
    } catch (e) {
      // 跨盘 rename 会失败，退回复制 + 删除
      try {
        await copyFile(from, to)
        await rm(from, { force: true })
      } catch (e2) {
        return { error: `搬到库目录失败：${e2?.message ?? e2}` }
      }
    }
    it.state = STATE_LIBRARY
    it.group = g.id
    it.file = this.relPath(to)
    it.enabled = true
    this.save()
    return { item: it }
  }

  /** 从索引移除（不动文件，除非 purge）。 */
  removeItem(id, { purge = false } = {}) {
    const idx = this.index.items.findIndex((it) => it.id === id)
    if (idx < 0) return false
    const it = this.index.items[idx]
    if (purge) {
      try {
        const p = this.absPath(it.file)
        if (existsSync(p)) rmSync(p, { force: true })
        const sidecar = `${p}.json`
        if (existsSync(sidecar)) rmSync(sidecar, { force: true })
      } catch { /* 删文件失败不影响索引 */ }
    }
    this.index.items.splice(idx, 1)
    this.save()
    return true
  }

  /** 改显示名/情绪/标签/描述（仅库内条目）。 */
  updateMeta(id, patch) {
    const it = this.item(id)
    if (!it) return { error: '条目不存在' }
    if (it.state !== STATE_LIBRARY) return { error: '只有已入库的图可以改' }
    const g = this.group(it.group)
    if (g?.readonly) return { error: '只读组的图不可编辑' }
    if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
      it.displayName = patch.displayName.trim().slice(0, 60)
    }
    if (typeof patch.emotion === 'string' && EMOTION_SET.has(patch.emotion)) it.emotion = patch.emotion
    if (Array.isArray(patch.tags)) it.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 7)
    if (typeof patch.use === 'string') it.use = patch.use.slice(0, 40)
    if (typeof patch.desc === 'string') it.desc = patch.desc.slice(0, 90)
    if (typeof patch.enabled === 'boolean') it.enabled = patch.enabled
    this.save()
    return { item: it }
  }

  /** 移到另一个组：文件也搬家。 */
  async moveToGroup(ids, groupId) {
    const g = this.group(groupId)
    if (!g) return { error: '目标分组不存在' }
    if (g.readonly) return { error: '不能移入只读组' }
    const moved = []
    const failed = []
    for (const id of ids) {
      const it = this.item(id)
      if (!it || it.state !== STATE_LIBRARY) { failed.push({ id, reason: '条目不存在或未入库' }); continue }
      const from = this.absPath(it.file)
      if (!existsSync(from)) {
        this.removeItem(id)
        failed.push({ id, reason: '文件已不存在，已移除索引' })
        continue
      }
      const ext = extname(from).toLowerCase()
      const dir = join(this.libraryDir, groupDirName(g))
      await mkdir(dir, { recursive: true })
      // 命名规则：<组id>-<时间戳>-<6位哈希>.<ext>；组内撞名时加盐重算哈希
      const stamp = String(it.id).split('-').at(-2) || stampNow()
      let seg = String(it.id).split('-').at(-1)
      let name = `${g.id}-${stamp}-${seg}${ext}`
      let salt = 0
      while (existsSync(join(dir, name))) {
        salt += 1
        seg = createHash('sha1').update(String(it.sha1)).update(`#m${salt}`).digest('hex').slice(0, 6)
        name = `${g.id}-${stamp}-${seg}${ext}`
      }
      const to = join(dir, name)
      try {
        await rename(from, to)
      } catch {
        await copyFile(from, to)
        await rm(from, { force: true })
      }
      it.group = g.id
      it.file = this.relPath(to)
      moved.push(it.id)
    }
    this.save()
    return { moved, failed }
  }

  /** 建组。 */
  createGroup(name) {
    const label = String(name ?? '').trim()
    if (!label) return { error: '组名不能为空' }
    if (label.length > 20) return { error: '组名最多 20 个字' }
    if (this.index.groups.some((g) => g.name === label)) return { error: '已有同名分组' }
    const taken = new Set(this.index.groups.map((g) => g.id))
    const id = makeGroupId(label, taken)
    const g = { id, name: label, readonly: false, order: this.index.groups.length }
    this.index.groups.push(g)
    this.save()
    return { group: g }
  }

  renameGroup(id, name) {
    const g = this.group(id)
    if (!g) return { error: '分组不存在' }
    if (g.readonly) return { error: '只读组不能改名' }
    const label = String(name ?? '').trim()
    if (!label) return { error: '组名不能为空' }
    if (label.length > 20) return { error: '组名最多 20 个字' }
    if (this.index.groups.some((o) => o.id !== id && o.name === label)) return { error: '已有同名分组' }
    g.name = label
    this.save()
    return { group: g }
  }

  /**
   * 删组：组里的图一起删（可选连文件），至少保留 1 个自定义组。
   * 只读组不可删。
   */
  async deleteGroup(id, { purgeFiles = true } = {}) {
    const g = this.group(id)
    if (!g) return { error: '分组不存在' }
    if (g.readonly) return { error: '只读组不能删除' }
    const custom = this.index.groups.filter((x) => !x.readonly)
    if (custom.length <= 1) return { error: '至少要保留一个自己的分组' }
    const victims = this.index.items.filter((it) => it.group === id)
    // removeItem 每次都会 save()，这里逐条删完后统一再存一次组表
    for (const it of victims) this.removeItem(it.id, { purge: purgeFiles })
    this.index.groups = this.index.groups.filter((x) => x.id !== id)
    this.save()
    try {
      const dir = join(this.libraryDir, groupDirName(g))
      if (purgeFiles && existsSync(dir)) await rm(dir, { recursive: true, force: true })
    } catch { /* 目录删不掉就算了 */ }
    return { deleted: victims.length }
  }

  // ------------------------------------------------------------------ health
  readHealth() {
    const raw = readJson(this.healthFile, null)
    return {
      missing: Array.isArray(raw?.missing) ? raw.missing : [],
      lastScanAt: typeof raw?.lastScanAt === 'string' ? raw.lastScanAt : '',
    }
  }

  addMissing(entry) {
    const h = this.readHealth()
    const exists = h.missing.some((m) => m.id === entry.id && m.at === entry.at)
    if (!exists) h.missing.push(entry)
    writeJsonAtomic(this.healthFile, h)
    return h
  }

  clearMissing() {
    const h = this.readHealth()
    writeJsonAtomic(this.healthFile, { missing: [], lastScanAt: h.lastScanAt })
  }

  touchScan() {
    const h = this.readHealth()
    writeJsonAtomic(this.healthFile, { ...h, lastScanAt: isoNow() })
  }

  /**
   * 全量自检：把索引里文件不存在的条目删掉、记进失效清单。
   * @returns { removed: [...], missingCount }
   */
  scan() {
    const removed = []
    const keep = []
    for (const it of this.index.items) {
      // pending 的条目丢了只是没了待识别的图，不算「库内失效」
      if (it.state === STATE_PENDING) {
        const p = this.absPath(it.file)
        if (!existsSync(p)) { keep.push({ ...it, broken: true }); continue }
        keep.push(it)
        continue
      }
      const p = this.absPath(it.file)
      let ok = false
      try { ok = existsSync(p) && statSync(p).size > 0 } catch { ok = false }
      if (ok) { keep.push(it); continue }
      removed.push({
        id: it.id,
        displayName: it.displayName,
        originalName: it.originalName,
        group: this.group(it.group)?.name ?? it.group,
        at: isoNow(),
      })
      try {
        const sidecar = `${p}.json`
        if (existsSync(sidecar)) rmSync(sidecar, { force: true })
      } catch { /* 忽略 */ }
    }
    if (removed.length > 0) {
      this.index.items = keep
      this.save()
      const h = this.readHealth()
      h.missing.push(...removed)
      h.lastScanAt = isoNow()
      writeJsonAtomic(this.healthFile, h)
    } else {
      this.touchScan()
    }
    const h = this.readHealth()
    return { removed, missingCount: h.missing.length }
  }

  /** 挑一张可用的库内图（按情绪/组过滤）。用于斗图与发送兜底。 */
  pickLibrary({ emotion, groups, exclude = [], random = Math.random } = {}) {
    const allow = Array.isArray(groups) && groups.length > 0 ? new Set(groups) : undefined
    const pool = this.index.items.filter((it) => {
      if (it.state !== STATE_LIBRARY) return false
      if (it.enabled === false) return false
      if (allow && !allow.has(it.group)) return false
      if (emotion && it.emotion !== emotion) return false
      if (exclude.includes(it.id)) return false
      return true
    })
    if (pool.length === 0) return undefined
    return pool[Math.floor(random() * pool.length)]
  }
}

/** 从文件名里抠出 6 位哈希（nekowhale 原名没有哈希时返回空串）。 */
function shortHashFromName(fileName) {
  const m = /-([0-9a-f]{6})\.\w+$/u.exec(String(fileName ?? ''))
  return m ? m[1] : ''
}

/** 把配置读写收在一处，避免各路由各写一遍。 */
export function loadConfig(store, defaults) {
  const raw = readJson(store.configFile, null)
  return normalizeConfig(raw, defaults)
}

export function saveConfig(store, cfg, defaults) {
  const next = normalizeConfig(cfg, defaults)
  writeJsonAtomic(store.configFile, next)
  return next
}

export function normalizeConfig(raw, defaults) {
  const base = {
    dataDir: defaults.dataDir,
    tagModel: defaults.tagModel ?? null,
    autoSend: {
      enabled: false,
      channels: ['web', 'im'],
      limitPer10: 2,
      trigger: 'keywords',
      groups: [GROUP_FAV],
    },
  }
  if (!raw || typeof raw !== 'object') return base
  const out = { ...base }
  if (typeof raw.dataDir === 'string' && raw.dataDir.trim()) out.dataDir = raw.dataDir.trim()
  if (raw.tagModel && typeof raw.tagModel.provider === 'string' && typeof raw.tagModel.model === 'string'
    && raw.tagModel.provider && raw.tagModel.model) {
    out.tagModel = { provider: raw.tagModel.provider, model: raw.tagModel.model }
  }
  const a = raw.autoSend
  if (a && typeof a === 'object') {
    out.autoSend = {
      enabled: a.enabled === true,
      channels: Array.isArray(a.channels) ? a.channels.filter((c) => c === 'web' || c === 'im') : base.autoSend.channels,
      limitPer10: clampInt(a.limitPer10, 1, 10, 2),
      trigger: a.trigger === 'model' ? 'model' : 'keywords',
      groups: Array.isArray(a.groups) ? a.groups.filter((g) => typeof g === 'string' && GROUP_ID_RE.test(g)).slice(0, 20)
        : base.autoSend.groups,
    }
  }
  return out
}

function clampInt(v, min, max, dflt) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}
