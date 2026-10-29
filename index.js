// nekowhale-meme —— 大肥鱼表情库（宿主半）
//
// 定位：完全自包含的 DSH 表情库插件，**不依赖任何其他插件**。
// 「下载初始表情包」直接连公开站点 kiriyuki.com（清单 /api/manifest、图 /media/gif），
// 不需要装 dsh-nekowhale-stickers，也不需要它提供任何服务。
//
// 半边划分：
//   宿主半（本文件）：数据层、识别、HTTP 路由、模型工具、斗图触发
//   客户端半（client.js）：队列页 + 设置页（三 Tab / 批量 / 编辑 / 提醒条）
//
// 注意：本文件不 `export default`（DSH loader 会优先它并丢掉 inject / Config）。
import Schema from '@deepseek-ai/schemastery'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { EMOTIONS, STATE_LIBRARY, STATE_PENDING, STATE_TAGGED, Store, defaultDataDir, groupDirName, loadConfig, saveConfig } from './lib/store.js'
import { Tagger, listModelCatalog, mediaTypeOf, resolveTagModel } from './lib/tagger.js'
import { judgePrompt, matchEmotion } from './lib/keywords.js'

/**
 * dsh-tools 的 defineTool 只是给类型/默认值的糖衣，运行时等价于恒等函数。
 * 这里**不导入它**（link 安装下裸导入可能失败），直接用普通对象注册 ——
 * 已由 dsh-pet-encore 实测可行（它就是这么注册工具的）。
 */
const defineTool = (spec) => spec

export const name = 'nekowhale-meme'
export const inject = []

/** 唯一的路由前缀；客户端半按这个前缀取图与调接口。 */
const ROUTE = '/nekowhale-meme'

// ---------------------------------------------------------------- 初始表情包：直连 kiriyuki.com
// 站点是公开的（无需 key/登录/装别的插件）：
//   /api/manifest                清单：包/文件/hash/尺寸（无标签）
//   /media/gif/<pack>/<file>.gif  图本体
//   /meme/kit/nekowhale.json      作者的人工标注表：emotion/tags/use/desc（只覆盖大肥鱼 322 张）
// 站点是**模板化**的：同 stem（如 10N01_猫猫搓手）在不同包里是同一动作换角色重渲染，
// 所以 emotion/tags/use 能按 stem 跨包套用（实测全站 96.9% 命中）；desc 里含角色名，
// 别的角色不能照搬，只有原配包才保留。
const NEKO_SITE = 'https://kiriyuki.com'
const NEKO_PACK_MAIN = '大肥鱼'
const NEKO_KIT_PATH = '/meme/kit/nekowhale.json'
/**
 * desc 含角色名，只有原配的「大肥鱼」能原样保留。
 * （原来还有「大肥鱼和GPT娘」，但双人包已整体不支持下载，这里顺带留名只为兼容旧索引。）
 */
const NEKO_DESC_PACKS = new Set([NEKO_PACK_MAIN, '大肥鱼和GPT娘'])
const IMPORT_TIMEOUT_MS = 30_000
const IMPORT_CONCURRENCY = 4

/** 下载进度（客户端轮询 /import-progress）。 */
const importProgress = {
  active: false,
  done: 0,
  total: 0,
  added: 0,
  skipped: 0,
  failed: 0,
  tagged: 0,          // 有多少张套上了人工标注
  untagged: 0,        // 有多少张没标注（如兔兔系列）
  phase: 'idle',      // idle | manifest | kit | download | done | error
  error: '',
  startedAt: 0,
  finishedAt: 0,
}

/** 带重试的单次下载。 */
async function fetchWithRetry(url, { tries = 3, timeoutMs = IMPORT_TIMEOUT_MS } = {}) {
  let last
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      last = e
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw last ?? new Error('下载失败')
}

/**
 * 拉作者的标注表，按 stem 建索引：stem → { emotion, tags, use, desc, dir }。
 * 拿不到就返回空表（下载照常，只是没有标签）——不能让标注表拖垮整个导入。
 */
let kitCache = null
async function fetchKit(warn) {
  if (kitCache) return kitCache
  try {
    const buf = await fetchWithRetry(`${NEKO_SITE}${NEKO_KIT_PATH}`, { tries: 2, timeoutMs: 45_000 })
    const kit = JSON.parse(buf.toString('utf8'))
    const byStem = new Map()
    for (const s of Array.isArray(kit?.stickers) ? kit.stickers : []) {
      // id 形如 `<pack>/<stem>`
      const slash = String(s.id ?? '').indexOf('/')
      const stem = slash >= 0 ? String(s.id).slice(slash + 1) : String(s.stem ?? '')
      if (!stem) continue
      // 同一 stem 可能出现多次（大肥鱼 + 双人包），优先保留单人包那份
      const packOf = slash >= 0 ? String(s.id).slice(0, slash) : ''
      if (byStem.has(stem) && packOf !== NEKO_PACK_MAIN) continue
      byStem.set(stem, {
        emotion: typeof s.emotion === 'string' ? s.emotion : '',
        tags: Array.isArray(s.tags) ? s.tags.slice(0, 8) : [],
        use: typeof s.use === 'string' ? s.use : '',
        desc: typeof s.desc === 'string' ? s.desc : '',
        dir: typeof s.dir === 'string' ? s.dir : '',
      })
    }
    kitCache = { byStem, version: kit?.version ?? '', attribution: kit?.attribution?.text ?? '' }
    return kitCache
  } catch (e) {
    warn?.(`标注表拉取失败，本次下载不带标签：${e?.message ?? e}`)
    kitCache = { byStem: new Map(), version: '', attribution: '' }
    return kitCache
  }
}

/**
 * 判断一个包是不是「双人包」。
 * 三重依据（任一成立即算）：① manifest 的 packs[].template 含「双人」；
 * ② 包名含「双人」「和」；③ 条目里 TT 编码（双人互动）占比 > 50%。
 * 双人包一律不出现在包选择器里，也不接受下载——本项目不做双人方向（dir）字段，
 * 少了方向信息，双人图发出去可能是反的。
 */
function isDuoPack(packName, itemsOfPack, templateOf) {
  if (String(templateOf ?? '').includes('双人')) return true
  if (/双人|和/u.test(String(packName ?? ''))) return true
  if (itemsOfPack.length === 0) return false
  const tt = itemsOfPack.filter((x) => /^\d*TT/u.test(String(x.stem ?? ''))).length
  return tt > itemsOfPack.length * 0.5
}

/**
 * 调系统目录选择框。返回选中的绝对路径；取消返回 null；
 * 环境不支持（非 Windows 且无 zenity/kdialog、PowerShell 缺失等）抛 { fallback: true }，
 * 客户端收到后改用自绘的 /browse-dirs 浏览器。
 */
async function pickDirNative(startPath) {
  // 1) 宿主就是 Electron 时，主进程里可直接用原生 dialog
  try {
    const { createRequire } = await import('node:module')
    const electron = createRequire(import.meta.url)('electron')
    if (electron?.dialog?.showOpenDialog) {
      const ret = await electron.dialog.showOpenDialog({
        title: '选择数据目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: startPath,
      })
      if (ret.canceled) return null
      const p = ret.filePaths?.[0]
      return p ? resolve(p) : null
    }
  } catch { /* 插件跑在渲染侧/非 Electron：落到系统命令 */ }

  if (process.platform === 'win32') {
    // 2) Windows：PowerShell 的 FolderBrowserDialog（系统原生选择框）
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const ps1 = join(tmpdir(), `nkm-pickdir-${tag}.ps1`)
    const out = join(tmpdir(), `nkm-pickdir-${tag}.out`)
    const script = [
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "选择数据目录（可新建文件夹）"',
      '$d.ShowNewFolderButton = $true',
      `$d.SelectedPath = '${String(startPath ?? '').replace(/'/gu, "''")}'`,
      '$r = $d.ShowDialog()',
      // 结果读 SelectedPath（WinForms 经典属性，PS 5.1 有）；
      // 千万别用 FolderName——那是 .NET 8/PS7 才加的，PS 5.1 读出来是空字符串，
      // 会被 JS 当成"用户取消"，表现为"点了确定但没回填"。
      `if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [IO.File]::WriteAllText('${out.replace(/'/gu, "''")}', $d.SelectedPath, [Text.Encoding]::UTF8) } else { [IO.File]::WriteAllText('${out.replace(/'/gu, "''")}', '__CANCELLED__', [Text.Encoding]::UTF8) }`,
    ].join('\n')
    await writeFile(ps1, '\ufeff' + script, 'utf8')
    try {
      await new Promise((res2, rej) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
          { windowsHide: true, timeout: 5 * 60_000 }, (err) => (err ? rej(err) : res2()))
      })
      const got = readFileSyncSafe(out)
      if (got === '__CANCELLED__' || got === '') return null
      return got ? resolve(got) : null
    } catch (e) {
      throw Object.assign(new Error(`PowerShell 选择框不可用：${e?.message ?? e}`), { fallback: true })
    } finally {
      rmSyncSafe(ps1); rmSyncSafe(out)
    }
  }

  // 3) Linux 桌面：zenity / kdialog
  for (const [cmd, args] of [
    ['zenity', ['--file-selection', '--directory', `--filename=${startPath ?? '/'}/`]],
    ['kdialog', ['--getexistingdirectory', startPath ?? '/']],
  ]) {
    try {
      const p = await new Promise((res2, rej) => {
        execFile(cmd, args, { timeout: 5 * 60_000 }, (err, stdout) => (err ? rej(err) : res2(String(stdout).trim())))
      })
      if (!p) return null
      return resolve(p)
    } catch { /* 换下一个 */ }
  }
  throw Object.assign(new Error('本环境没有可用的系统目录选择框'), { fallback: true })
}

function readFileSyncSafe(p) {
  // PowerShell [IO.File]::WriteAllText(…, UTF8) 会带 BOM（\uFEFF），
  // JS 的 trim() 去不掉它——带着 BOM 的路径不是合法盘符路径，会被判非绝对路径丢掉。
  try { return readFileSync(p, 'utf8').replace(/^[\uFEFF\u200B]+/u, '').trim() } catch { return null }
}
function rmSyncSafe(p) {
  try { rmSync(p, { force: true }) } catch { /* 忽略 */ }
}

/**
 * 清理 inbox/ 里本插件自己生成的中转文件（`<毫秒时间戳>-<随机数>-<原名>`）。
 * 不碰用户手动放进来的图（那些文件名不符合该模式）。
 * @returns 删除数量
 */
async function cleanupInbox(inboxDir) {
  if (!existsSync(inboxDir)) return 0
  let n = 0
  try {
    for (const name of await readdir(inboxDir)) {
      // 只匹配本插件生成的形态：纯数字-纯数字-其余
      if (!/^\d{10,16}-\d{1,6}-/u.test(name)) continue
      try { await rm(join(inboxDir, name), { force: true }); n += 1 } catch { /* 单个失败不影响其他 */ }
    }
  } catch { /* 目录读不了就算了 */ }
  return n
}

/**
 * 把旧数据目录的内容整体搬到新目录（剪切迁移）。
 *
 * 顺序与安全性要点：
 *  - 目标目录里**已有同名文件时不覆盖**（跳过并记入 conflicts），避免误吞用户放在新目录里的东西。
 *  - 单个条目搬完立即删源（真·剪切），中途失败则保留源，最坏情况是"部分搬移"，
 *    此时返回 moved/failed 让调用方知道状态——不至于一半图消失。
 *  - `index.json` 里的 `file` 是相对路径，目录整体搬走后不用重写索引。
 *  - inbox/ 不搬（里面只是中转垃圾）。
 *
 * @returns {{ moved: string[], skipped: string[], failed: {name,reason}[] }}
 */
async function migrateDataDir(fromDir, toDir) {
  const out = { moved: [], skipped: [], failed: [] }
  if (resolve(fromDir) === resolve(toDir)) return out
  if (!existsSync(fromDir)) return out
  await mkdir(toDir, { recursive: true })

  // 顶层要搬的东西（config.json 稍后单独写，避免搬完又被覆盖）
  const entries = ['index.json', 'index.json.bak', 'health.json', 'pending', 'library', 'inbox']
  for (const name of entries) {
    const src = join(fromDir, name)
    if (!existsSync(src)) continue
    const dst = join(toDir, name)
    try {
      const info = await stat(src)
      if (!info.isDirectory()) {
        // 文件：目标已存在就跳过（不覆盖新目录里可能已有的数据）
        if (existsSync(dst)) { out.skipped.push(name); continue }
        await rename(src, dst)
        out.moved.push(name)
        continue
      }
      // 目录：逐项搬，保留子结构
      await mkdir(dst, { recursive: true })
      const result = await migrateDirTree(src, dst)
      out.moved.push(...result.moved)
      out.skipped.push(...result.skipped)
      out.failed.push(...result.failed)
      // 目录搬空后删掉空壳
      try {
        const left = await readdir(src)
        if (left.length === 0) await rm(src, { recursive: true, force: true })
      } catch { /* 留个空目录无害 */ }
    } catch (e) {
      out.failed.push({ name, reason: String(e?.message ?? e) })
    }
  }
  return out
}

/** 递归把 src 树里的文件搬到 dst，已存在的跳过不覆盖。 */
async function migrateDirTree(src, dst) {
  const out = { moved: [], skipped: [], failed: [] }
  let ents
  try { ents = await readdir(src, { withFileTypes: true }) } catch (e) {
    out.failed.push({ name: src, reason: String(e?.message ?? e) })
    return out
  }
  for (const ent of ents) {
    const s = join(src, ent.name)
    const d = join(dst, ent.name)
    if (ent.isDirectory()) {
      await mkdir(d, { recursive: true })
      const sub = await migrateDirTree(s, d)
      out.moved.push(...sub.moved); out.skipped.push(...sub.skipped); out.failed.push(...sub.failed)
      try { const left = await readdir(s); if (left.length === 0) await rm(s, { recursive: true, force: true }) } catch { /* 忽略 */ }
      continue
    }
    try {
      if (existsSync(d)) { out.skipped.push(ent.name); continue }
      await rename(s, d)
      out.moved.push(ent.name)
    } catch (e) {
      // 跨盘 rename 会失败（EXDEV），退回复制 + 删除
      try {
        await copyFile(s, d)
        await rm(s, { force: true })
        out.moved.push(ent.name)
      } catch (e2) {
        out.failed.push({ name: ent.name, reason: String(e2?.message ?? e2) })
      }
    }
  }
  return out
}

/** 拉包清单（带缓存）：包名 / 张数 / 总字节 / 已下载几张。双人包会被剔除。 */
let packListCache = null
async function fetchPackList(store) {
  if (!packListCache) {
    const buf = await fetchWithRetry(`${NEKO_SITE}/api/manifest`, { tries: 3, timeoutMs: 60_000 })
    const manifest = JSON.parse(buf.toString('utf8'))
    const itemsAll = Array.isArray(manifest?.items) ? manifest.items : []
    const templateBy = new Map()
    for (const p of Array.isArray(manifest?.packs) ? manifest.packs : []) {
      templateBy.set(p.key, p.template ?? '')
    }
    const byPack = new Map()
    for (const it of itemsAll) {
      if (!it?.pack) continue
      const cur = byPack.get(it.pack) ?? { name: it.pack, count: 0, bytes: 0, hashes: [], items: [] }
      cur.count += 1
      cur.bytes += Number(it.bytes) || 0
      if (it.hash) cur.hashes.push(String(it.hash).slice(0, 12))
      cur.items.push(it)
      byPack.set(it.pack, cur)
    }
    // 剔除双人包
    packListCache = [...byPack.values()]
      .filter((p) => !isDuoPack(p.name, p.items, templateBy.get(p.name)))
      .map(({ items: _items, ...rest }) => rest)
  }
  // 每次实时算「已下载几张」（不缓存这层，因为可能边下边看）
  const haveHash = new Set()
  for (const it of store.index.items) {
    if (it.state === STATE_LIBRARY && it.sha1) haveHash.add(String(it.sha1).slice(0, 12))
  }
  return packListCache.map((p) => ({
    name: p.name,
    count: p.count,
    bytes: p.bytes,
    have: p.hashes.filter((h) => haveHash.has(h)).length,
  }))
}

/**
 * 从站点导入指定包。**每个角色包一个只读组**（方案 A）：
 * 组名=包名，组内只放该包的图，筛选与 AI 授权都清晰。
 * 已存在（按 hash）的跳过；文件按原名保存（只读组保留原名，不参与重命名规则）。
 */
async function importFromSite(packs, { log, warn, store }) {
  if (importProgress.active) return { ok: false, error: '正在导入中，请等待完成' }
  Object.assign(importProgress, {
    active: true, done: 0, total: 0, added: 0, skipped: 0, failed: 0,
    tagged: 0, untagged: 0,
    phase: 'manifest', error: '', startedAt: Date.now(), finishedAt: 0,
    packCount: 0, packDone: 0,
  })
  try {
    // 1) 拉清单
    let manifest
    try {
      const buf = await fetchWithRetry(`${NEKO_SITE}/api/manifest`, { tries: 3, timeoutMs: 60_000 })
      manifest = JSON.parse(buf.toString('utf8'))
    } catch (e) {
      importProgress.phase = 'error'
      importProgress.error = `拉取清单失败：${e?.message ?? e}`
      return { ok: false, error: importProgress.error }
    }
    const allItems = Array.isArray(manifest?.items) ? manifest.items : []
    const templateBy = new Map()
    for (const p of Array.isArray(manifest?.packs) ? manifest.packs : []) {
      templateBy.set(p.key, p.template ?? '')
    }
    // 双人包不在支持范围内：直接拒绝（不只是从选择器里藏掉）
    const duoAsked = packs.filter((pk) => {
      const its = allItems.filter((x) => x.pack === pk)
      return isDuoPack(pk, its, templateBy.get(pk))
    })
    if (duoAsked.length > 0) {
      importProgress.phase = 'error'
      importProgress.error = `不支持双人包：${duoAsked.join('、')}（本项目不处理双人方向）`
      return { ok: false, error: importProgress.error }
    }
    const items = allItems.filter((it) => it?.pack && it?.file && packs.includes(it.pack))
    if (items.length === 0) {
      importProgress.phase = 'error'
      importProgress.error = `清单里没有包 ${packs.join('、')} 的表情`
      return { ok: false, error: importProgress.error }
    }
    const gifBase = manifest.gif_base || '/media/gif'

    // 2) 拉作者的标注表（拿不到也继续，只是没有标签）
    importProgress.phase = 'kit'
    const kit = await fetchKit(warn)

    // 3) 实到的包（按清单里的顺序，可能某包为空）
    const realPacks = [...new Set(items.map((it) => it.pack))]
    importProgress.packCount = realPacks.length
    importProgress.packDone = 0

    // 4) 每个包建一个只读组 + 目录
    const packState = new Map()
    for (const pk of realPacks) {
      const g = store.ensurePackGroup(pk)
      const dir = join(store.libraryDir, groupDirName(g))
      await mkdir(dir, { recursive: true })
      const packItems = items.filter((it) => it.pack === pk)
      packState.set(pk, { group: g, dir, items: packItems, cursor: 0, left: packItems.length })
    }

    // 5) 已有哪些（按 hash 前 12 位，避免重复下载同一张图）
    const haveHash = new Set()
    for (const it of store.index.items) {
      if (it.state !== STATE_LIBRARY) continue
      if (it.sha1) haveHash.add(String(it.sha1).slice(0, 12))
    }

    /**
     * 按 stem 套作者的标注：
     * - emotion / tags / use：纯语义，任何角色都适用
     * - desc：含角色名，只有原配的两个包能原样保留，别的包留空
     */
    const annotate = (manifestItem) => {
      const hit = kit.byStem.get(String(manifestItem.stem ?? ''))
      if (!hit) return { emotion: '', tags: [], use: '', desc: '', tagged: false }
      return {
        emotion: hit.emotion,
        tags: hit.tags,
        use: hit.use,
        desc: NEKO_DESC_PACKS.has(manifestItem.pack) ? hit.desc : '',
        tagged: true,
      }
    }

    importProgress.phase = 'download'
    importProgress.total = items.length
    const failed = []
    let cursor = 0

    const worker = async () => {
      while (true) {
        const idx = cursor++
        if (idx >= items.length) return
        const it = items[idx]
        const ps = packState.get(it.pack)
        if (!ps) { importProgress.done += 1; continue }
        const hash12 = String(it.hash ?? '').slice(0, 12)
        const id = `nk-${hash12 || String(it.stem).slice(0, 12)}`
        // 已经导入过（同一张图）就跳过
        if (hash12 && haveHash.has(hash12)) {
          importProgress.skipped += 1
          importProgress.done += 1
          ps.left -= 1
          if (ps.left <= 0) importProgress.packDone += 1
          continue
        }
        if (store.item(id)) {
          importProgress.skipped += 1
          importProgress.done += 1
          ps.left -= 1
          if (ps.left <= 0) importProgress.packDone += 1
          continue
        }
        const safeFile = basename(String(it.file))
        const target = join(ps.dir, safeFile)
        try {
          if (!existsSync(target)) {
            const url = `${NEKO_SITE}${gifBase}/${encodeURIComponent(it.pack)}/${encodeURIComponent(safeFile)}${it.hash ? `?h=${encodeURIComponent(it.hash)}` : ''}`
            const buf = await fetchWithRetry(url)
            if (buf.length === 0) throw new Error('下载到空文件')
            await writeFile(target, buf)
          }
          const rel = store.relPath(target)
          const meta = annotate(it)
          store.index.items.push({
            id,
            state: STATE_LIBRARY,
            group: ps.group.id,
            file: rel,
            displayName: String(it.name || it.stem || safeFile),
            originalName: safeFile,
            emotion: meta.emotion,
            tags: meta.tags,
            use: meta.use,
            desc: meta.desc,
            addedAt: new Date().toISOString().slice(0, 19) + 'Z',
            source: 'kiriyuki',
            pack: it.pack,
            sha1: hash12,
            bytes: Number(it.bytes) || 0,
            enabled: true,
            annotated: meta.tagged,      // 有没有套上作者标注，供以后筛选
          })
          if (hash12) haveHash.add(hash12)
          importProgress.added += 1
          if (meta.tagged) importProgress.tagged += 1
          else importProgress.untagged += 1
        } catch (e) {
          importProgress.failed += 1
          if (failed.length < 20) failed.push({ id: it.id, file: safeFile, reason: e?.message ?? String(e) })
        }
        ps.left -= 1
        if (ps.left <= 0) importProgress.packDone += 1
        importProgress.done += 1
        // 每 20 张落一次盘，避免中途崩了全丢
        if (importProgress.added > 0 && importProgress.added % 20 === 0) {
          try { store.save() } catch { /* 落盘失败下次再试 */ }
        }
      }
    }
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, () => worker()))

    store.save()
    importProgress.phase = 'done'
    importProgress.finishedAt = Date.now()
    log(`初始表情包导入完成：新增 ${importProgress.added}（带标签 ${importProgress.tagged}），跳过 ${importProgress.skipped}，失败 ${importProgress.failed}`)
    return {
      ok: true,
      added: importProgress.added,
      skipped: importProgress.skipped,
      failed,
      total: items.length,
      packs: realPacks,
      tagged: importProgress.tagged,
      untagged: importProgress.untagged,
      kitVersion: kit.version,
      attribution: kit.attribution,
      groups: [...packState.values()].map((p) => ({ id: p.group.id, name: p.group.name, count: p.items.length })),
    }
  } catch (e) {
    importProgress.phase = 'error'
    importProgress.error = String(e?.message ?? e)
    warn(`导入出错：${e?.message ?? e}`)
    return { ok: false, error: importProgress.error }
  } finally {
    importProgress.active = false
  }
}

export const Config = Schema.object({
  dataDir: Schema.string().description('数据目录。留空则用 $DSH_HOME/nekowhale-meme（设置页里也能改，支持任意盘）'),
  autoSendOnTurnEnd: Schema.boolean().default(true).description('总开关：允许斗图在回合结束时发图（具体策略在设置页）'),
}).description('大肥鱼表情库')

// ------------------------------------------------------------------ 小工具
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function json(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(obj))
}

async function readJsonBody(req, limit = 16 * 1024 * 1024) {
  if (req.method !== 'POST') throw Object.assign(new Error('只接受 POST'), { code: 'METHOD' })
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求体太大'), { code: 'TOO_LARGE' })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' })
  }
}

/** 一次纯文本生成：给 system + 一句 user，返回拼好的文本。 */
async function onceText(llm, sel, system, userText, timeoutMs) {
  let msg
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    msg = mod.createUserMessage({ content: [{ type: 'text', text: userText }], source: { kind: 'user' } })
  } catch {
    msg = { id: `m-${Date.now()}`, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'user' } }
  }
  const parts = []
  for await (const chunk of llm.stream({
    provider: sel.provider,
    model: sel.model,
    sessionId: 'nekowhale-meme-judge',
    messages: [msg],
    system,
    temperature: 0,
    signal: AbortSignal.timeout(timeoutMs),
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text)
  }
  return parts.join('')
}

/** 从用户消息的 content 块里抽文本。 */
function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('')
}

export function apply(ctx, config) {
  const log = (m) => { try { ctx.logger?.('nekowhale-meme')?.info?.(m) } catch { /* 没 logger 就算了 */ } }
  const warn = (m) => { try { ctx.logger?.('nekowhale-meme')?.warn?.(m) } catch { /* 同上 */ } }

  // ---------------------------------------------------------------- 数据层
  const baseDataDir = (() => {
    const fromConfig = typeof config?.dataDir === 'string' ? config.dataDir.trim() : ''
    if (fromConfig && isAbsolute(fromConfig)) return fromConfig
    return defaultDataDir()
  })()

  const defaults = {
    dataDir: baseDataDir,
    tagModel: null,
  }

  let store
  let tagger
  let cfg

  function boot(dataDir) {
    store = new Store(dataDir, { log }).init()
    cfg = loadConfig(store, defaults)
    const llm = () => ctx.get('llm')
    tagger = new Tagger({ ctx, store, llm, log })
    tagger.onChange = () => {
      // 进度变化时不需要主动推送：客户端轮询 state 就够（避免再引入 SSE）。
    }
    return store
  }

  const initialDir = (() => {
    // config.json 可能把 dataDir 改到别的盘。换目录时旧目录会留下指向新目录的
    // 指针（见 /config 的 dirChanged 分支），所以这里要**沿链跟随**：
    // 锚点 → 目标 → 目标的下一个目标…（最多 5 跳防环），直到最新一份配置。
    let cur = baseDataDir
    for (let hop = 0; hop < 5; hop += 1) {
      try {
        const probe = new Store(cur, { log })
        const loaded = loadConfig(probe, { ...defaults, dataDir: cur })
        const next = loaded.dataDir && isAbsolute(loaded.dataDir) ? resolve(loaded.dataDir) : null
        if (!next || next === resolve(cur) || !existsSync(next)) break
        cur = next
      } catch { break }
    }
    return cur
  })()

  boot(initialDir)
  log(`数据目录：${store.dataDir}`)
  // 启动时顺手清一次历史遗留的中转文件（旧版本没清理，会越积越多）
  void cleanupInbox(join(store.dataDir, 'inbox')).then((n) => {
    if (n > 0) log(`已清理 ${n} 个残留的上传中转文件`)
  }).catch(() => {})

  function reload(dataDir) {
    boot(dataDir)
    log(`数据目录已切换：${store.dataDir}`)
  }

  // ---------------------------------------------------------------- 状态组装
  function stateFor(query) {
    const tab = query.get('tab') ?? 'pending'
    const group = query.get('group') ?? ''
    const counts = {
      pending: store.itemsByState(STATE_PENDING).length,
      tagged: store.itemsByState(STATE_TAGGED).length,
      library: store.itemsByState(STATE_LIBRARY).length,
    }
    const groupCounts = store.groupCounts()
    const groups = store.groups().map((g) => ({
      id: g.id,
      name: g.name,
      readonly: g.readonly === true,
      count: groupCounts[g.id] ?? 0,
    }))
    let items
    if (tab === 'pending') {
      items = store.itemsByState(STATE_PENDING)
    } else if (tab === 'tagged') {
      items = store.itemsByState(STATE_TAGGED)
    } else {
      items = store.itemsByState(STATE_LIBRARY).filter((it) => (group ? it.group === group : true))
    }
    items = items.map((it) => publicItem(it))
    const health = store.readHealth()
    return {
      ok: true,
      tab,
      group,
      counts,
      groups,
      items,
      emotions: EMOTIONS,
      autoSend: cfg.autoSend,
      dataDir: store.dataDir,
      tagModel: cfg.tagModel,
      tagging: tagger.state,
      missing: { count: health.missing.length, items: health.missing.slice(-50), lastScanAt: health.lastScanAt },
      nekowhale: { available: true },
    }
  }

  function publicItem(it) {
    const full = store.absPath(it.file)
    let size = 0
    let exists = false
    try {
      const s = statSync(full)
      size = s.size
      exists = s.size > 0
    } catch { exists = false }
    return {
      id: it.id,
      state: it.state,
      group: it.group,
      groupName: store.group(it.group)?.name ?? it.group,
      displayName: it.displayName,
      originalName: it.originalName,
      emotion: it.emotion ?? '',
      tags: it.tags ?? [],
      use: it.use ?? '',
      desc: it.desc ?? '',
      addedAt: it.addedAt,
      source: it.source,
      enabled: it.enabled !== false,
      failReason: it.failReason ?? '',
      bytes: size || it.bytes || 0,
      exists,
      ext: extname(full).toLowerCase(),
      url: `${ROUTE}/image/${encodeURIComponent(it.id)}`,
      readonly: store.group(it.group)?.readonly === true,
    }
  }

  // ---------------------------------------------------------------- 斗图（回合结束触发）
  const sessions = new Map()

  function sessionSlot(sid) {
    let s = sessions.get(sid)
    if (!s) {
      s = { lastUserText: '', turn: 0, sentTurns: [], popup: null }
      sessions.set(sid, s)
    }
    return s
  }

  /** 每个会话的「最近 10 轮内已发几张」。 */
  function recentSendCount(slot) {
    const now = slot.turn
    slot.sentTurns = slot.sentTurns.filter((t) => now - t < 10)
    return slot.sentTurns.length
  }

  let latestPopup = null

  function firePopup(item, text) {
    latestPopup = {
      at: Date.now(),
      id: item.id,
      url: `${ROUTE}/image/${encodeURIComponent(item.id)}`,
      name: item.displayName,
      emotion: item.emotion ?? '',
    }
    return latestPopup
  }

  async function judgeByModel(text) {
    const llm = ctx.get('llm')
    if (!llm?.stream) return undefined
    const sel = cfg.tagModel ?? (await resolveTagModel(ctx, llm, undefined))
    if (!sel) return undefined
    let out = ''
    try {
      out = await onceText(llm, sel, judgePrompt(), text, 30000)
    } catch (e) {
      warn(`斗图模型判断失败：${e?.message ?? e}`)
      return undefined
    }
    const first = out.trim().split(/[，,。\s]/u).find((w) => EMOTIONS.includes(w))
    return first
  }

  async function maybeAutoSend(sid, slot) {
    if (!config.autoSendOnTurnEnd) return
    const a = cfg.autoSend
    if (!a?.enabled) return
    if (!(a.channels ?? []).includes('web')) return
    if (recentSendCount(slot) >= a.limitPer10) return
    const text = slot.lastUserText
    if (!text.trim()) return
    const emotion = a.trigger === 'model' ? await judgeByModel(text) : matchEmotion(text)
    if (!emotion) return
    // 发送前单张兜底：文件不存在就删索引、记失效清单、换下一张，最多验证 3 张，全程静默
    const tried = []
    let good
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = store.pickLibrary({ emotion, groups: a.groups, exclude: tried })
      if (!candidate) break
      tried.push(candidate.id)
      const p = store.absPath(candidate.file)
      let ok = false
      try { ok = existsSync(p) && statSync(p).size > 0 } catch { ok = false }
      if (ok) { good = candidate; break }
      store.addMissing({
        id: candidate.id, displayName: candidate.displayName, originalName: candidate.originalName,
        group: store.group(candidate.group)?.name ?? candidate.group, at: new Date().toISOString().slice(0, 19) + 'Z',
      })
      store.removeItem(candidate.id)
    }
    if (!good) {
      if (tried.length > 0) warn(`情绪「${emotion}」下可用图片已耗尽`)
      return
    }
    slot.sentTurns.push(slot.turn)
    firePopup(good, text)
    log(`斗图：${emotion} → ${good.displayName}`)
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    const type = event?.type
    if (!type) return
    const sid = String(session?.header?.id ?? session?.id ?? 'unknown')
    const slot = sessionSlot(sid)
    if (type === 'turn/start') {
      slot.turn = Number.isSafeInteger(event?.data?.turn) ? event.data.turn : slot.turn + 1
      return
    }
    if (type === 'user/message') {
      if (event?.surfaceOp !== 'append') return
      if (event?.data?.source?.kind !== 'user') return
      slot.lastUserText = textOfContent(event?.data?.content)
      return
    }
    if (type !== 'turn/end') return
    const reason = typeof event?.data?.reason === 'string' ? event.data.reason : event?.data?.reason?.kind
    if (reason !== 'completed') return
    void maybeAutoSend(sid, slot).catch((e) => warn(`斗图出错：${e?.message ?? e}`))
  }))

  // ---------------------------------------------------------------- 工具（模型侧）
  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => tctx.tools.register(defineTool({
      name: 'meme_import',
      description: '把一张图收进表情库的「待识别」队列（只进队列，不触发识别）。来源可以是本地路径、URL，或留空取本会话最近一张附件。',
      parameters: {
        path: { type: 'string', description: '本地图片绝对路径（可选）' },
        url: { type: 'string', description: '图片 URL（可选）' },
        group: { type: 'string', description: '入库目标分组 id（可选，默认 fav）' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } } } },
      render: (_a, v) => [{ type: 'text', text: v?.text ?? '' }],
      async execute(args) {
        const p = typeof args?.path === 'string' ? args.path.trim() : ''
        const u = typeof args?.url === 'string' ? args.url.trim() : ''
        if (!p && !u) return { ok: false, text: '请给 path 或 url（聊天附件请直接在插件页上传）' }
        let src = p
        if (u) {
          try {
            const res = await fetch(u, { signal: AbortSignal.timeout(20000) })
            if (!res.ok) return { ok: false, text: `下载失败：HTTP ${res.status}` }
            const buf = Buffer.from(await res.arrayBuffer())
            const name = (u.split('?')[0].split('/').pop() || 'download').slice(-60)
            const dir = join(store.dataDir, 'inbox')
            await mkdir(dir, { recursive: true })
            src = join(dir, name.includes('.') ? name : `${name}.png`)
            await writeFile(src, buf)
          } catch (e) {
            return { ok: false, text: `下载出错：${e?.message ?? e}` }
          }
        }
        const r = await store.addToPending(src, { group: args?.group, source: u ? 'url' : 'path' })
        if (r?.skipped) return { ok: false, text: r.skipped }
        return { ok: true, text: `已进待识别队列：${r.originalName}（id ${r.id}）。到队列页点「识别勾选」打标签。` }
      },
    })), 'nekowhale-meme: meme_import')

    tctx.effect(() => tctx.tools.register(defineTool({
      name: 'meme_tag',
      description: '对「待识别」的图触发打标签（串行、可中止、25 个中文情绪单选）。不传 itemIds 则识别全部待识别。',
      parameters: {
        itemIds: { type: 'array', items: { type: 'string' }, description: '要识别的条目 id；留空=全部待识别' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } } } },
      render: (_a, v) => [{ type: 'text', text: v?.text ?? '' }],
      timeoutMs: 600000,
      async execute(args) {
        if (tagger.running) return { ok: false, text: '已经在识别中' }
        const ids = Array.isArray(args?.itemIds) && args.itemIds.length > 0
          ? args.itemIds.map(String)
          : store.itemsByState(STATE_PENDING).map((it) => it.id)
        const r = await tagger.run(ids, cfg.tagModel ?? undefined)
        if (r?.error) return { ok: false, text: r.error }
        const ok = r.results.filter((x) => x.ok).length
        const bad = r.results.length - ok
        return {
          ok: bad === 0,
          text: `识别完成：成功 ${ok} 张，失败 ${bad} 张${r.stopped ? '（已中止，其余保持待识别）' : ''}。成功的那批在「已标识·待确认」等你确认入库。`,
        }
      },
    })), 'nekowhale-meme: meme_tag')

    tctx.effect(() => tctx.tools.register(defineTool({
      name: 'meme_search',
      description: '在已入库可用的图里检索（只搜 library 且未停用的条目）。返回每张的显示名、情绪、标签与图片地址。',
      parameters: {
        query: { type: 'string', description: '中文情境词，如 摸鱼 被夸 摆烂' },
        emotion: { type: 'string', description: '只要这个情绪（25 个之一）' },
        group: { type: 'string', description: '限定分组 id' },
        limit: { type: 'integer', description: '返回条数，默认 5，最多 20' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } } } },
      render: (_a, v) => [{ type: 'text', text: v?.text ?? '' }],
      async execute(args) {
        const q = String(args?.query ?? '').trim().toLowerCase()
        const emotion = String(args?.emotion ?? '').trim()
        const group = String(args?.group ?? '').trim()
        const limit = Math.min(20, Math.max(1, Number(args?.limit) || 5))
        const allowGroups = (cfg.autoSend?.groups?.length ?? 0) > 0 ? new Set(cfg.autoSend.groups) : undefined
        const hits = store.itemsByState(STATE_LIBRARY)
          .filter((it) => it.enabled !== false)
          .filter((it) => (group ? it.group === group : allowGroups ? allowGroups.has(it.group) : true))
          .filter((it) => (emotion ? it.emotion === emotion : true))
          .filter((it) => {
            if (!q) return true
            const blob = `${it.displayName} ${it.originalName} ${it.emotion} ${(it.tags ?? []).join(' ')} ${it.use} ${it.desc}`.toLowerCase()
            return q.split(/\s+/u).every((w) => blob.includes(w))
          })
          .slice(0, limit)
        if (hits.length === 0) return { ok: false, text: '没有匹配的表情。换个情绪词，或到插件页确认「AI 可用组」是否勾选了这个组。' }
        const lines = hits.map((it, i) => `${i + 1}. ${it.displayName}｜${it.emotion}｜${(it.tags ?? []).join(',')}｜${it.use || it.desc || ''}\n   ![${it.displayName}](${ROUTE}/image/${encodeURIComponent(it.id)})`)
        return { ok: true, text: `找到 ${hits.length} 张：\n${lines.join('\n')}\n把 ]( 那行原样放进回复就能显示。` }
      },
    })), 'nekowhale-meme: meme_search')

    tctx.effect(() => tctx.tools.register(defineTool({
      name: 'meme_send',
      description: '发一张表情：给名字/情绪词/情境词任一种，挑一张返回 Markdown 图片行（含失效兜底：文件坏了就换下一张，最多 3 张）。',
      parameters: {
        name: { type: 'string', description: '显示名（可模糊）' },
        emotion: { type: 'string', description: '情绪词，随机挑一张' },
        query: { type: 'string', description: '情境词' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } } } },
      render: (_a, v) => [{ type: 'text', text: v?.text ?? '' }],
      async execute(args) {
        const name = String(args?.name ?? '').trim().toLowerCase()
        const emotion = String(args?.emotion ?? '').trim()
        const q = String(args?.query ?? '').trim().toLowerCase()
        const allowGroups = (cfg.autoSend?.groups?.length ?? 0) > 0 ? new Set(cfg.autoSend.groups) : undefined
        const pool = store.itemsByState(STATE_LIBRARY)
          .filter((it) => it.enabled !== false)
          .filter((it) => (allowGroups ? allowGroups.has(it.group) : true))
          .filter((it) => (emotion ? it.emotion === emotion : true))
          .filter((it) => (name ? it.displayName.toLowerCase().includes(name) : true))
          .filter((it) => {
            if (!q) return true
            const blob = `${it.displayName} ${(it.tags ?? []).join(' ')} ${it.use} ${it.desc}`.toLowerCase()
            return q.split(/\s+/u).every((w) => blob.includes(w))
          })
        if (pool.length === 0) return { ok: false, text: '没有匹配的表情，先用 meme_search 找一下。' }
        const tried = []
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const rest = pool.filter((it) => !tried.includes(it.id))
          if (rest.length === 0) break
          const pick = rest[Math.floor(Math.random() * rest.length)]
          tried.push(pick.id)
          const p = store.absPath(pick.file)
          let ok = false
          try { ok = existsSync(p) && statSync(p).size > 0 } catch { ok = false }
          if (ok) {
            return { ok: true, text: `![${pick.displayName}](${ROUTE}/image/${encodeURIComponent(pick.id)})\n把上面这行原样放进回复即可显示。` }
          }
          store.addMissing({
            id: pick.id, displayName: pick.displayName, originalName: pick.originalName,
            group: store.group(pick.group)?.name ?? pick.group, at: new Date().toISOString().slice(0, 19) + 'Z',
          })
          store.removeItem(pick.id)
        }
        return { ok: false, text: '该条件下可用图片已耗尽（文件都失效了，已从索引移除）' }
      },
    })), 'nekowhale-meme: meme_send')

    tctx.effect(() => tctx.tools.register(defineTool({
      name: 'meme_list',
      description: '列队列或库存：待识别 / 已标识待确认 / 已入库（可限分组），用于查看现状而不是检索。',
      parameters: {
        status: { type: 'string', enum: ['pending', 'tagged', 'library'], description: '看哪一栏，默认 library' },
        group: { type: 'string', description: '限定分组 id' },
        limit: { type: 'integer', description: '最多列几条，默认 30' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } } } },
      render: (_a, v) => [{ type: 'text', text: v?.text ?? '' }],
      async execute(args) {
        const status = ['pending', 'tagged', 'library'].includes(String(args?.status)) ? String(args.status) : STATE_LIBRARY
        const group = String(args?.group ?? '').trim()
        const limit = Math.min(80, Math.max(1, Number(args?.limit) || 30))
        const all = store.itemsByState(status).filter((it) => (group ? it.group === group : true))
        if (all.length === 0) return { ok: true, text: '这一栏是空的。' }
        const rows = all.slice(0, limit).map((it, i) => {
          const g = store.group(it.group)?.name ?? it.group
          return `${i + 1}. [${g}] ${it.displayName}${it.emotion ? `｜${it.emotion}` : ''}${it.failReason ? `｜失败：${it.failReason}` : ''}`
        })
        return { ok: true, text: `共 ${all.length} 条${all.length > limit ? `，列前 ${limit} 条` : ''}：\n${rows.join('\n')}` }
      },
    })), 'nekowhale-meme: meme_list')
  })

  // ---------------------------------------------------------------- HTTP 路由
  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const rest = url.pathname.slice(ROUTE.length) || '/'
        try {
          // ---- 图片（含缩略图原图直出）
          if (rest.startsWith('/image/')) {
            if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
            const id = decodeURIComponent(rest.slice('/image/'.length))
            const it = store.item(id)
            if (!it) { res.statusCode = 404; res.end(); return }
            const file = store.absPath(it.file)
            let info
            try { info = statSync(file) } catch { res.statusCode = 404; res.end(); return }
            if (!info.isFile() || info.size <= 0) { res.statusCode = 404; res.end(); return }
            res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
            res.setHeader('content-length', String(info.size))
            res.setHeader('cache-control', 'private, max-age=86400')
            if (req.method === 'HEAD') { res.end(); return }
            createReadStream(file).on('error', () => res.destroy()).pipe(res)
            return
          }

          // ---- 轮询状态
          if (rest === '/state' && req.method === 'GET') {
            json(res, 200, stateFor(url.searchParams))
            return
          }

          // ---- 状态 + 全量自检（「打开插件时」调用）
          if (rest === '/status' && req.method === 'GET') {
            const scan = url.searchParams.get('scan') === '1'
              ? store.scan()
              : { removed: [], missingCount: store.readHealth().missing.length }
            json(res, 200, { ok: true, scan, ...stateFor(url.searchParams) })
            return
          }

          // ---- 失效清单：整份清空（点「知道了」）
          if (rest === '/health/clear' && req.method === 'POST') {
            const body = await readJsonBody(req)
            if (body?.confirm !== true) { json(res, 400, { ok: false, error: '需要 confirm: true 才会整份清空（不支持单条清理）' }); return }
            store.clearMissing()
            json(res, 200, { ok: true })
            return
          }

          // ---- 配置读写
          if (rest === '/config' && req.method === 'GET') {
            json(res, 200, { ok: true, config: cfg, dataDir: store.dataDir })
            return
          }

          // ---- 调系统目录选择框（本机场景）
          // 浏览器没有权限弹系统对话框，但宿主进程跑在这台机器上，可以代劳：
          //   1) 首选 Electron 原生 dialog（宿主就是 Electron 时）
          //   2) 回退 PowerShell FolderBrowserDialog（Windows 系统原生选择框）
          //   3) 都不行 → ok:false + fallback:true，客户端改用自绘 /browse-dirs 浏览器
          if (rest === '/pick-dir' && req.method === 'POST') {
            const body = await readJsonBody(req).catch(() => ({}))
            const start = typeof body?.startPath === 'string' && isAbsolute(body.startPath) ? resolve(body.startPath) : store.dataDir
            try {
              const picked = await pickDirNative(start)
              if (picked === null) { json(res, 200, { ok: true, path: null }) } else { json(res, 200, { ok: true, path: picked }) }
            } catch (e) {
              if (e?.fallback === true) json(res, 200, { ok: false, fallback: true, error: String(e?.message ?? e) })
              else json(res, 500, { ok: false, error: `打开系统选择框失败：${e?.message ?? e}` })
            }
            return
          }
          if (rest === '/config' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const raw = body?.config ?? body ?? {}
            const wantsDir = typeof raw.dataDir === 'string' && raw.dataDir.trim() && isAbsolute(raw.dataDir.trim())
              ? resolve(raw.dataDir.trim()) : undefined
            const dirChanged = wantsDir !== undefined && wantsDir !== store.dataDir
            let migration = null
            if (dirChanged) {
              const oldStore = store
              const oldCfg = cfg
              const oldDir = oldStore.dataDir
              // 先搬数据（剪切），再切目录：这样新目录里已经有完整数据，
              // 切换后 store 立刻读到正确的索引，不会出现"切过去发现是空的"。
              try {
                migration = await migrateDataDir(oldDir, wantsDir)
              } catch (e) {
                json(res, 500, { ok: false, error: `迁移数据失败：${e?.message ?? e}` })
                return
              }
              if (migration.failed.length > 0) {
                // 有文件没搬成功：不继续切，免得数据半截
                json(res, 500, {
                  ok: false,
                  error: `迁移未完成（${migration.failed.length} 个文件失败），已保留原目录：${migration.failed[0].reason}`,
                  migration,
                })
                return
              }
              try {
                reload(wantsDir)
              } catch (e) {
                json(res, 500, { ok: false, error: `切换数据目录失败：${e?.message ?? e}` })
                return
              }
              // 旧目录已被搬空，留一份指针配置（只含 dataDir），方便人工辨认"搬家去了哪"。
              try {
                saveConfig(oldStore, { ...oldCfg, dataDir: wantsDir }, { ...defaults, dataDir: oldDir })
              } catch { /* 指针写失败不影响主流程 */ }
            }
            const nextRaw = { ...cfg, ...raw, dataDir: wantsDir ?? store.dataDir }
            cfg = saveConfig(store, nextRaw, defaults)
            json(res, 200, { ok: true, config: cfg, dataDir: store.dataDir, migration })
            return
          }

          // ---- 目录浏览（设置页的「选择…」按钮用）
          // 浏览器无法枚举本地盘符，只能由宿主这边列；只回目录、不碰文件内容。
          if (rest === '/browse-dirs' && req.method === 'GET') {
            const want = url.searchParams.get('path') || ''
            try {
              let root
              if (!want) {
                // 没给路径：Windows 列盘符，其他系统从 / 开始
                if (process.platform === 'win32') {
                  const drives = []
                  for (let code = 65; code <= 90; code += 1) {
                    const letter = String.fromCharCode(code)
                    const p = `${letter}:\\`
                    try { if (existsSync(p)) drives.push({ name: `${letter}:`, path: p }) } catch { /* 跳过 */ }
                  }
                  json(res, 200, { ok: true, path: '', parent: '', dirs: drives })
                  return
                }
                root = '/'
              } else {
                if (!isAbsolute(want)) { json(res, 400, { ok: false, error: '必须是绝对路径' }); return }
                root = resolve(want)
              }
              if (!existsSync(root)) { json(res, 404, { ok: false, error: '目录不存在' }); return }
              const entries = await readdir(root, { withFileTypes: true })
              const dirs = []
              for (const ent of entries) {
                if (!ent.isDirectory()) continue
                if (ent.name.startsWith('.')) continue
                // 跳过明显不该进的系统/噪音目录
                if (/^(Windows|Program Files \(x86\)|Recovery|System Volume Information|\$Recycle\.Bin|node_modules)$/iu.test(ent.name)) continue
                dirs.push({ name: ent.name, path: join(root, ent.name) })
              }
              dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
              const parent = process.platform === 'win32' && /^[A-Za-z]:\\?$/u.test(root) ? '' : dirname(root)
              json(res, 200, { ok: true, path: root, parent, dirs })
            } catch (e) {
              json(res, 500, { ok: false, error: `读目录失败：${e?.message ?? e}` })
            }
            return
          }

          // ---- 可选模型清单（队列页下拉用）
          if (rest === '/models' && req.method === 'GET') {
            const catalog = await listModelCatalog(ctx.get('llm'))
            const dflt = cfg.tagModel
            let suggested = null
            if (!dflt) {
              const r = await resolveTagModel(ctx, ctx.get('llm'), undefined)
              suggested = r ?? null
            }
            json(res, 200, { ok: true, models: catalog, configured: dflt, suggested })
            return
          }

          // ---- 导入：本地上传（base64，避免 multipart 解析）
          if (rest === '/import' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const files = Array.isArray(body?.files) ? body.files : []
            if (files.length === 0) { json(res, 400, { ok: false, error: '没有文件' }); return }
            const inbox = join(store.dataDir, 'inbox')
            await mkdir(inbox, { recursive: true })
            const results = []
            for (const f of files) {
              const name = String(f?.name ?? 'upload').slice(-60)
              if (typeof f?.dataBase64 !== 'string' || !f.dataBase64) { results.push({ name, skipped: '没有数据' }); continue }
              const buf = Buffer.from(f.dataBase64, 'base64')
              const tmp = join(inbox, `${Date.now()}-${Math.floor(Math.random() * 1000)}-${basename(name)}`)
              try { await writeFile(tmp, buf) } catch (e) { results.push({ name, skipped: `写入失败：${e?.message ?? e}` }); continue }
              try {
                const r = await store.addToPending(tmp, { group: body?.group, source: 'upload', originalName: name, displayName: basename(name, extname(name)) })
                if (r?.skipped) results.push({ name, skipped: r.skipped })
                else results.push({ name, id: r.id })
              } finally {
                // 中转副本用完即删：addToPending 已经把内容复制进 pending/，
                // 这里不删就会在 inbox/ 里越积越多（历史遗留缺陷）。
                await rm(tmp, { force: true }).catch(() => {})
              }
            }
            // 顺手清掉历史遗留的中转文件（只清本插件自己命名的那些，不碰用户手动放进来的）
            await cleanupInbox(inbox).catch(() => {})
            json(res, 200, { ok: true, results })
            return
          }

          // ---- 导入：从文件夹批量收（资源管理器放进 inbox 目录也行）
          if (rest === '/import-folder' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const dir = String(body?.dir ?? '').trim()
            if (!dir || !isAbsolute(dir)) { json(res, 400, { ok: false, error: '需要一个绝对路径' }); return }
            if (!existsSync(dir)) { json(res, 400, { ok: false, error: '目录不存在' }); return }
            const entries = await readdir(dir, { withFileTypes: true })
            const results = []
            for (const ent of entries) {
              if (!ent.isFile()) continue
              const r = await store.addToPending(join(dir, ent.name), { group: body?.group, source: 'folder', originalName: ent.name, displayName: basename(ent.name, extname(ent.name)) })
              results.push({ name: ent.name, ...(r?.skipped ? { skipped: r.skipped } : { id: r.id }) })
            }
            json(res, 200, { ok: true, results })
            return
          }

          // ---- 导入：直接从 kiriyuki.com 下载（不依赖任何其他插件）
          if (rest === '/import-nekowhale' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const packs = Array.isArray(body?.packs) && body.packs.length > 0
              ? body.packs.map(String)
              : [NEKO_PACK_MAIN]
            const r = await importFromSite(packs, { log, warn, store })
            json(res, r.ok ? 200 : 400, r)
            return
          }
          // 包清单（设置页选择器用）：包名 / 张数 / 体积 / 已下载几张
          if (rest === '/packs' && req.method === 'GET') {
            try {
              const list = await fetchPackList(store)
              json(res, 200, { ok: true, packs: list, defaults: [NEKO_PACK_MAIN] })
            } catch (e) {
              json(res, 500, { ok: false, error: `拉取包清单失败：${e?.message ?? e}` })
            }
            return
          }
          // 下载进度（客户端轮询）
          if (rest === '/import-progress' && req.method === 'GET') {
            json(res, 200, { ok: true, progress: importProgress })
            return
          }

          // ---- 识别 / 中止
          if (rest === '/tag' && req.method === 'POST') {
            if (tagger.running) { json(res, 409, { ok: false, error: '已经在识别中' }); return }
            const body = await readJsonBody(req)
            const model = body?.model && typeof body.model.provider === 'string' && typeof body.model.model === 'string'
              ? { provider: body.model.provider.trim(), model: body.model.model.trim() }
              : undefined
            const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
            if (model) {
              // 用户手动选过的模型固定下来
              cfg = saveConfig(store, { ...cfg, tagModel: model }, defaults)
            }
            const list = ids.length > 0 ? ids : store.itemsByState(STATE_PENDING).map((it) => it.id)
            const r = await tagger.run(list, model ?? cfg.tagModel ?? undefined)
            if (r?.error) { json(res, 400, { ok: false, error: r.error }); return }
            json(res, 200, { ok: true, ...r, state: tagger.state })
            return
          }
          if (rest === '/cancel' && req.method === 'POST') {
            json(res, 200, { ok: tagger.cancel(), state: tagger.state })
            return
          }

          // ---- 确认入库（可批量）
          if (rest === '/confirm' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
            if (ids.length === 0) { json(res, 400, { ok: false, error: '没有选中条目' }); return }
            const group = String(body?.group ?? '').trim() || undefined
            const done = []
            const errors = []
            for (const id of ids) {
              const r = await store.confirm(id, group)
              if (r?.error) errors.push({ id, reason: r.error })
              else done.push(id)
            }
            json(res, 200, { ok: errors.length === 0, done, errors })
            return
          }

          // ---- 已标识·待确认 → 待识别（「重新识别」用）
          if (rest === '/revert-to-pending' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
            const done = []
            const errors = []
            for (const id of ids) {
              const r = store.backToPending(id)
              if (r) done.push(id)
              else errors.push({ id, reason: '只有「已标识·待确认」的图可以退回待识别' })
            }
            json(res, 200, { ok: errors.length === 0, done, errors })
            return
          }

          // ---- 退回待确认（已入库 → 待确认，用于重新识别）
          if (rest === '/revert' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
            const done = []
            const errors = []
            for (const id of ids) {
              const it = store.item(id)
              if (!it) { errors.push({ id, reason: '条目不存在' }); continue }
              const g = store.group(it.group)
              if (g?.readonly) { errors.push({ id, reason: '只读组的图不能移出' }); continue }
              if (it.state !== STATE_LIBRARY) { errors.push({ id, reason: '只有已入库的图可以移出' }); continue }
              // 文件搬回 pending 并改名（保留原 id 段）
              const from = store.absPath(it.file)
              const ext = extname(from).toLowerCase()
              const seg = String(it.id).split('-').at(-1)
              const stamp = String(it.id).split('-').at(-2) || ''
              let name = `${stamp}-${seg}${ext}`
              let salt = 0
              while (existsSync(join(store.pendingDir, name))) {
                salt += 1
                name = `${stamp}-${salt}${seg.slice(0, 4)}${ext}`
              }
              const to = join(store.pendingDir, name)
              try {
                await rename(from, to)
              } catch {
                await copyFile(from, to)
                await rm(from, { force: true })
              }
              it.file = store.relPath(to)
              it.state = STATE_TAGGED
              done.push(id)
            }
            store.save()
            json(res, 200, { ok: errors.length === 0, done, errors })
            return
          }

          // ---- 删除（二次确认在客户端做；这里只要求 confirm:true）
          if (rest === '/delete' && req.method === 'POST') {
            const body = await readJsonBody(req)
            if (body?.confirm !== true) { json(res, 400, { ok: false, error: '删除需要 confirm: true' }); return }
            const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
            const done = []
            for (const id of ids) {
              const it = store.item(id)
              if (!it) continue
              const g = store.item(id) && store.group(it.group)
              if (g?.readonly) continue
              if (store.removeItem(id, { purge: body?.purgeFiles === true })) done.push(id)
            }
            json(res, 200, { ok: true, done })
            return
          }

          // ---- 改元数据（显示名/情绪/标签/描述/启用）
          if (rest === '/update' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const id = String(body?.id ?? '')
            const r = store.updateMeta(id, body?.patch ?? {})
            if (r?.error) { json(res, 400, { ok: false, error: r.error }); return }
            json(res, 200, { ok: true, item: publicItem(r.item) })
            return
          }

          // ---- 分组：建 / 改名 / 删 / 移图
          if (rest === '/group' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const action = String(body?.action ?? '')
            if (action === 'create') {
              const r = store.createGroup(body?.name)
              json(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, group: r.group })
              return
            }
            if (action === 'rename') {
              const r = store.renameGroup(String(body?.id ?? ''), body?.name)
              json(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, group: r.group })
              return
            }
            if (action === 'delete') {
              const r = await store.deleteGroup(String(body?.id ?? ''), { purgeFiles: body?.purgeFiles !== false })
              json(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r })
              return
            }
            if (action === 'move') {
              const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
              const r = await store.moveToGroup(ids, String(body?.to ?? ''))
              json(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r })
              return
            }
            json(res, 400, { ok: false, error: `未知 action: ${action}` })
            return
          }

          // ---- 斗图气泡（客户端轮询，8 秒内有效）
          if (rest === '/popup' && req.method === 'GET') {
            if (!latestPopup || Date.now() - latestPopup.at > 8000) { json(res, 200, { ok: true, popup: null }); return }
            json(res, 200, { ok: true, popup: latestPopup })
            return
          }

          json(res, 404, { ok: false, error: `未知路由：${rest}` })
        } catch (e) {
          const code = e?.code
          json(res, code === 'TOO_LARGE' ? 413 : code === 'METHOD' || code === 'BAD_JSON' ? 400 : 500,
            { ok: false, error: String(e?.message ?? e) })
        }
      },
    }), 'nekowhale-meme: routes')
  })

  // 启动时准备目录（已由 boot → store.init() 保证结构就位）
  try {
    store.init()
  } catch (e) {
    warn(`初始化数据目录失败：${e?.message ?? e}`)
  }
}
