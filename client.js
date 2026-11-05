// nekowhale-meme —— 浏览器半（插件页 UI）
//
// 手写成 dsh 客户端加载器要的形状：交给 window.__ModuleLoader__ 的闭包，
// require 只回答共享模块。整段绝不能抛错 —— 客户端插件抛错会白掉整个页面。
//
// 页面结构（用户定版）：
//   默认进入「队列页」且全宽；右上角 ⚙ 整页跳转到「设置页」，设置页左上角 ← 返回。
//   队列页三 Tab 三等分：待识别 / 已标识·待确认 / 已入库·可用（分组管理只在这里）
//   设置页：基础（数据目录 / 导入初始表情包）+ 斗图 + AI 可用组
window.__ModuleLoader__.load({ id: 'nekowhale-meme', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')
  const h = React.createElement
  const { useState, useEffect, useMemo, useRef, useCallback } = React

  const PKG = 'nekowhale-meme'
  const API = '/nekowhale-meme'
  const POLL_MS = 4000
  const POLL_FAST_MS = 1200

  const EMOTIONS = ['开心', '大笑', '喜欢', '害羞', '得意', '兴奋', '惊讶', '疑惑', '思考', '无语',
    '难过', '哭', '生气', '害怕', '疲惫', '赞同', '拒绝', '打招呼', '感谢', '道歉',
    '卖萌', '搞怪', '嘲讽', '安慰', '其他']

  // ---------------------------------------------------------------- 样式
  // 主题自适应：文字继承宿主颜色；表面全部用 Canvas（系统明暗底色）做底、再用
  // currentColor 微调，**一律不透明**——皮肤可能是渐变/图片背景，半透明表面会透出
  // 底纹导致文字对比度不足。亮皮肤得到浅底深字，暗皮肤得到深底浅字，无需依赖皮肤变量。
  const C = {
    fg: 'inherit',
    mute: 'color-mix(in srgb, currentColor 62%, Canvas)',
    bg: 'color-mix(in srgb, Canvas 97%, currentColor)',
    surface: 'color-mix(in srgb, Canvas 94%, currentColor)',
    surface2: 'color-mix(in srgb, Canvas 88%, currentColor)',
    border: 'color-mix(in srgb, currentColor 22%, Canvas)',
    accent: 'var(--dsw-color-primary, #4d6bfe)',
    accentSoft: 'color-mix(in srgb, var(--dsw-color-primary, #4d6bfe) 18%, Canvas)',
    danger: '#b91c1c',
    dangerSoft: 'color-mix(in srgb, #dc2626 12%, Canvas)',
    dangerBorder: 'color-mix(in srgb, #dc2626 45%, Canvas)',
    warn: '#b45309',
    warnSoft: 'color-mix(in srgb, #d97706 12%, Canvas)',
    warnBorder: 'color-mix(in srgb, #d97706 45%, Canvas)',
    // 浮层（下拉面板、气泡）用更实的底，确保压在任何内容上都清楚
    raised: 'Canvas',
  }

  /**
   * 反色浮层（toast / 气泡）的配色。
   *
   * 不能用 `currentColor` 派生：同一个元素上 `color: X` +
   * `background: color-mix(… currentColor …)` 会让 currentColor 解析成 X 本身，
   * 底和字变成同一个颜色 → 白底白字纯色块。这里按明暗显式给两个不同色。
   */
  function invertColors(scheme) {
    return scheme === 'dark'
      ? { bg: '#f2f2f5', fg: '#1b1b20' }   // 暗主题 → 浅底深字
      : { bg: '#1b1b20', fg: '#f2f2f5' }   // 亮主题 → 深底浅字
  }
  const S = {
    // 页面整体铺不透明底：皮肤是渐变/图片背景时，半透明容器会让文字对比度不足
    page: { padding: '16px 20px 24px', font: 'inherit', color: C.fg, minHeight: 320, boxSizing: 'border-box', background: C.bg },
    pageFull: { padding: '16px 20px 24px', font: 'inherit', color: C.fg, minHeight: 320, boxSizing: 'border-box', width: '100%', maxWidth: '100%', background: C.bg },
    gear: {
      marginLeft: 'auto', width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`,
      background: C.surface, color: C.fg, cursor: 'pointer', fontSize: 16, lineHeight: 1,
    },
    card: { border: `1px solid ${C.border}`, background: C.surface, borderRadius: 12, padding: 14, marginBottom: 14 },
    cardTitle: { fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 },
    cardHint: { fontSize: 12, color: C.mute, marginBottom: 10 },
    tabs: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 },
    tab: {
      padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface,
      cursor: 'pointer', textAlign: 'left', color: C.fg, font: 'inherit', display: 'flex', alignItems: 'baseline', gap: 8,
    },
    tabOn: {
      padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.accent}`, background: C.accentSoft,
      cursor: 'pointer', textAlign: 'left', color: C.fg, font: 'inherit', display: 'flex', alignItems: 'baseline', gap: 8,
    },
    tabCount: { fontSize: 12, color: C.mute, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
    btn: {
      padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
      color: C.fg, cursor: 'pointer', font: 'inherit', fontSize: 13,
    },
    btnPrimary: {
      padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.accent}`,
      background: C.accentSoft, color: C.fg, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600,
    },
    btnDanger: {
      padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.dangerBorder}`, background: C.dangerSoft,
      color: C.danger, cursor: 'pointer', font: 'inherit', fontSize: 13,
    },
    btnOff: { padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.mute, cursor: 'not-allowed', font: 'inherit', fontSize: 13 },
    row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
    list: { display: 'flex', flexDirection: 'column', gap: 8 },
    item: {
      display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10,
      border: `1px solid ${C.border}`, background: 'color-mix(in srgb, currentColor 3%, transparent)',
    },
    thumb: { width: 56, height: 56, flex: 'none', borderRadius: 8, objectFit: 'cover', background: C.surface2, border: `1px solid ${C.border}` },
    itemMain: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 },
    itemName: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    itemMeta: { fontSize: 11, color: C.mute, fontVariantNumeric: 'tabular-nums' },
    field: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
    label: { width: 84, fontSize: 12, color: C.mute, flex: 'none' },
    input: {
      flex: 1, minWidth: 180, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`,
      background: C.surface2, color: C.fg, font: 'inherit', fontSize: 13, boxSizing: 'border-box',
    },
    select: {
      padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`,
      background: C.surface2, color: C.fg, font: 'inherit', fontSize: 13, minWidth: 220, maxWidth: 340,
    },
    stepper: { display: 'inline-flex', alignItems: 'center', gap: 2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' },
    stepBtn: { width: 26, height: 30, border: 'none', background: 'color-mix(in srgb, currentColor 6%, transparent)', color: C.fg, cursor: 'pointer', font: 'inherit', fontSize: 12 },
    stepVal: { minWidth: 34, textAlign: 'center', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
    red: { color: C.danger, fontSize: 12 },
    warnBox: {
      border: `1px solid ${C.dangerBorder}`, background: C.dangerSoft, borderRadius: 10,
      padding: '9px 12px', color: C.danger, fontSize: 12, marginTop: 8, lineHeight: 1.5,
    },
    notice: {
      border: `1px solid ${C.warnBorder}`, background: C.warnSoft, borderRadius: 10,
      padding: '10px 12px', marginBottom: 12, fontSize: 12, color: C.warn, lineHeight: 1.5,
    },
    progressOuter: { height: 6, borderRadius: 4, background: 'color-mix(in srgb, currentColor 12%, transparent)', overflow: 'hidden', flex: 1, minWidth: 120 },
    progressInner: { height: '100%', background: C.accent, transition: 'width .2s ease-out' },
    empty: { padding: '28px 8px', textAlign: 'center', color: C.mute, fontSize: 13 },
    chip: {
      display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11,
      border: `1px solid ${C.border}`, background: C.surface, marginRight: 4,
    },
    // 情绪筛选按钮（二级筛选条用）：普通 / 选中 / 该情绪下没图（置灰）
    chipBtn: {
      padding: '3px 10px', borderRadius: 999, fontSize: 12, font: 'inherit', cursor: 'pointer',
      border: `1px solid ${C.border}`, background: C.surface, color: C.fg,
    },
    chipOn: {
      padding: '3px 10px', borderRadius: 999, fontSize: 12, font: 'inherit', cursor: 'pointer',
      border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.fg, fontWeight: 600,
    },
    chipOff: {
      padding: '3px 10px', borderRadius: 999, fontSize: 12, font: 'inherit', cursor: 'not-allowed',
      border: `1px solid ${C.border}`, background: 'transparent', color: C.mute, opacity: 0.55,
    },
    dropdown: { position: 'relative', minWidth: 260, flex: 1, maxWidth: 420 },
    ddPanel: {
      position: 'absolute', zIndex: 40, left: 0, right: 0, top: 'calc(100% + 4px)', borderRadius: 10,
      border: `1px solid ${C.border}`, background: C.raised, color: C.fg, boxShadow: '0 12px 32px rgba(0,0,0,.25)',
      padding: 8, maxHeight: 280, overflow: 'auto',
    },
    ddRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 13 },
    ddFoot: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8, marginTop: 6, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.mute },
    toggle: (on) => ({
      width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
      background: on ? C.accent : 'color-mix(in srgb, currentColor 22%, transparent)', transition: 'background .15s',
    }),
    toggleDot: (on) => ({
      position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%',
      background: '#fff', transition: 'left .15s',
    }),
  }

  // ---------------------------------------------------------------- HTTP
  async function apiGet(path, params) {
    const q = params ? `?${new URLSearchParams(params).toString()}` : ''
    const r = await fetch(`${API}${path}${q}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }
  async function apiPost(path, body) {
    const r = await fetch(`${API}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body ?? {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }

  function fmtBytes(n) {
    const v = Number(n) || 0
    if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
    if (v >= 1024) return `${Math.round(v / 1024)} KB`
    return `${v} B`
  }
  function fmtMB(n) {
    const v = Number(n) || 0
    if (v >= 1024 * 1024 * 1024) return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
    return `${(v / 1024 / 1024).toFixed(1)} MB`
  }
  /** 浏览器端拼路径：按 base 的分隔符风格来（宿主返回的 path 已带正确风格）。 */
  function pathJoin(base, name) {
    const clean = String(name ?? '').replace(/^[/\\]+/u, '').replace(/[/\\]+$/u, '')
    if (!clean) return base
    const sep = base.includes('\\') ? '\\' : '/'
    return base.endsWith(sep) ? `${base}${clean}` : `${base}${sep}${clean}`
  }
  function fmtDate(s) {
    const t = String(s ?? '')
    return t ? t.slice(0, 10).replace(/-/gu, '/') : ''
  }

  const Btn = ({ on, children, kind, disabled, onClick, title }) => h('button', {
    type: 'button', title, disabled: !!disabled, onClick: disabled ? undefined : onClick,
    style: disabled ? S.btnOff : kind === 'primary' ? S.btnPrimary : kind === 'danger' ? S.btnDanger : S.btn,
  }, children)

  /** 下拉通用：展开后点组件外任意处 / 按 Esc 自动收起。 */
  function useCloseOnOutside(ref, open, onClose) {
    useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onDown = (e) => {
        const el = ref.current
        if (el && e.target && typeof el.contains === 'function' && !el.contains(e.target)) onClose()
      }
      const onKey = (e) => { if (e.key === 'Escape') onClose() }
      document.addEventListener('pointerdown', onDown, true)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('pointerdown', onDown, true)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])
  }

  // ---------------------------------------------------------------- 步骤器（用户偏好：不要裸数字框）
  function Stepper({ value, min, max, onChange, suffix }) {
    const v = Number.isFinite(Number(value)) ? Number(value) : min
    const set = (n) => onChange(Math.min(max, Math.max(min, Math.round(n))))
    return h('span', { style: S.row },
      h('span', { style: S.stepper },
        h('button', { type: 'button', style: S.stepBtn, onClick: () => set(v - 1), 'aria-label': '减少' }, '−'),
        h('span', { style: S.stepVal }, String(v)),
        h('button', { type: 'button', style: S.stepBtn, onClick: () => set(v + 1), 'aria-label': '增加' }, '+')),
      suffix ? h('span', { style: { fontSize: 12, color: C.mute } }, suffix) : null,
      h('span', { style: { fontSize: 11, color: C.mute } }, `范围 ${min}–${max}`),
    )
  }

  // ---------------------------------------------------------------- 分组下拉（多选·带搜索·全选清空）
  function GroupPicker({ groups, selected, onChange, disabled }) {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const box = useRef(null)
    useCloseOnOutside(box, open, () => setOpen(false))
    const sel = new Set(selected ?? [])
    const list = groups.filter((g) => !q || g.name.includes(q) || g.id.includes(q))
    const label = selected?.length ? groups.filter((g) => sel.has(g.id)).map((g) => g.name).join('、') : '未选择'
    return h('div', { style: S.dropdown, ref: box },
      h('button', {
        type: 'button', disabled: !!disabled, onClick: () => setOpen((o) => !o),
        style: { ...S.input, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' },
      },
        h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
        h('span', { style: { color: C.mute } }, '▾')),
      open ? h('div', { style: S.ddPanel },
        h('input', {
          style: { ...S.input, minWidth: 0, width: '100%', marginBottom: 6 },
          placeholder: '搜索分组…', value: q, onChange: (e) => setQ(e.target.value),
        }),
        list.length === 0 ? h('div', { style: { ...S.empty, padding: '10px 4px' } }, '没有匹配的分组') : null,
        list.map((g) => h('label', { key: g.id, style: S.ddRow },
          h('input', {
            type: 'checkbox', checked: sel.has(g.id),
            onChange: () => {
              const next = new Set(sel)
              if (next.has(g.id)) next.delete(g.id)
              else next.add(g.id)
              onChange([...next])
            },
          }),
          h('span', { style: { flex: 1 } }, g.name),
          h('span', { style: { fontSize: 11, color: C.mute } }, `${g.count} 张${g.readonly ? ' · 只读' : ''}`))),
        h('div', { style: S.ddFoot },
          h('button', { type: 'button', style: { ...S.btn, padding: '3px 8px' }, onClick: () => onChange(groups.map((g) => g.id)) }, '全选'),
          h('button', { type: 'button', style: { ...S.btn, padding: '3px 8px' }, onClick: () => onChange([]) }, '清空'),
          h('span', { style: { marginLeft: 'auto' } }, `已选 ${sel.size}/${groups.length}`)),
      ) : null,
    )
  }

  // ---------------------------------------------------------------- 包选择器（多选·带搜索·带体积）
  const BIG_WARN_BYTES = 500 * 1024 * 1024
  function PackPicker({ packs, selected, onChange, disabled }) {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const box = useRef(null)
    useCloseOnOutside(box, open, () => setOpen(false))
    const sel = new Set(selected ?? [])
    const list = packs.filter((p) => !q || p.name.includes(q))
    const picked = packs.filter((p) => sel.has(p.name))
    const totalCount = picked.reduce((s, p) => s + p.count, 0)
    const totalBytes = picked.reduce((s, p) => s + p.bytes, 0)
    const label = picked.length === 0 ? '未选择任何包' : picked.map((p) => p.name).join('、')
    return h('div', { style: S.dropdown, ref: box },
      h('button', {
        type: 'button', disabled: !!disabled, onClick: () => setOpen((o) => !o),
        style: { ...S.input, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' },
      },
        h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
        h('span', { style: { color: C.mute } }, '▾')),
      open ? h('div', { style: { ...S.ddPanel, maxHeight: 320 } },
        h('input', {
          style: { ...S.input, minWidth: 0, width: '100%', marginBottom: 6 },
          placeholder: '搜索包名…', value: q, onChange: (e) => setQ(e.target.value),
        }),
        list.length === 0 ? h('div', { style: { ...S.empty, padding: '10px 4px' } }, '没有匹配的包') : null,
        list.map((p) => {
          // 已全部下载的包：置灰不可勾选（后端本来就会跳过，这里让 UI 一眼可见）
          const full = p.have >= p.count && p.count > 0
          return h('label', {
            key: p.name,
            style: { ...S.ddRow, opacity: full ? .5 : 1, cursor: full ? 'not-allowed' : 'pointer' },
            title: full ? '这个包已经全部下载过了' : undefined,
          },
            h('input', {
              type: 'checkbox', checked: sel.has(p.name), disabled: full,
              onChange: () => {
                if (full) return
                const next = new Set(sel)
                if (next.has(p.name)) next.delete(p.name)
                else next.add(p.name)
                onChange([...next])
              },
            }),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
            h('span', { style: { fontSize: 11, color: C.mute, flex: 'none', marginLeft: 8 } },
              full ? `${p.count} 张 · 已全部下载`
                : `${p.count} 张 · ${fmtMB(p.bytes)}${p.have > 0 ? ` · 已下 ${p.have}` : ''}`))
        }),
        h('div', { style: S.ddFoot },
          h('button', {
            type: 'button', style: { ...S.btn, padding: '3px 8px' },
            // 全选只选「还能下载的」包
            onClick: () => onChange(packs.filter((p) => !(p.have >= p.count && p.count > 0)).map((p) => p.name)),
          }, '全选'),
          h('button', { type: 'button', style: { ...S.btn, padding: '3px 8px' }, onClick: () => onChange([]) }, '清空'),
          h('span', { style: { marginLeft: 'auto' } },
            `已选 ${sel.size}/${packs.filter((p) => !(p.have >= p.count && p.count > 0)).length} 个可下载`)),
        h('div', { style: { ...S.ddFoot, borderTop: 'none', paddingTop: 4 } },
          h('span', { style: { fontVariantNumeric: 'tabular-nums' } },
            picked.length > 0 ? `合计 ${totalCount} 张 · ${fmtMB(totalBytes)}` : '还没选包'))) : null,
      // 超过 500MB 的提示（选完就在下面显示，不用展开）
      totalBytes > BIG_WARN_BYTES ? h('div', { style: { ...S.warnBox, position: 'static', marginTop: 6 } },
        h('div', null, `⚠ 已选 ${fmtMB(totalBytes)}，超过 500MB`),
        h('div', { style: { opacity: .85 } }, '下载会持续较久并占用相应磁盘空间，建议先选 1–2 个包试。')) : null,
    )
  }

  // ---------------------------------------------------------------- 目录选择器（宿主列目录，浏览器只做选择）
  function DirPicker({ onPick, onClose }) {
    const [path, setPath] = useState('')
    const [parent, setParent] = useState('')
    const [dirs, setDirs] = useState([])
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const [nameDraft, setNameDraft] = useState('')

    const load = useCallback(async (p) => {
      setLoading(true); setErr('')
      try {
        const d = await apiGet('/browse-dirs', p ? { path: p } : {})
        setPath(d.path ?? '')
        setParent(d.parent ?? '')
        setDirs(d.dirs ?? [])
      } catch (e) {
        setErr(`读目录失败：${e.message}`)
      } finally { setLoading(false) }
    }, [])
    useEffect(() => { void load('') }, [load])

    return h('div', {
      style: { ...S.card, position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 460, maxWidth: '92vw', zIndex: 9999, background: C.raised, boxShadow: '0 18px 44px rgba(0,0,0,.35)' },
    },
      h('div', { style: S.cardTitle }, '选择数据目录',
        h('span', { style: { marginLeft: 'auto' } }, h(Btn, { onClick: onClose }, '关闭'))),
      // 当前路径 + 上级
      h('div', { style: { ...S.row, marginBottom: 8 } },
        parent !== undefined ? h(Btn, { disabled: !parent && !!path, onClick: () => void load(parent || '') }, '↩ 上级') : null,
        h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          path || '（选择盘符）')),
      err ? h('div', { style: S.warnBox }, err) : null,
      loading ? h('div', { style: { ...S.empty, padding: '16px' } }, '读取中…') : null,
      !loading ? h('div', { style: { maxHeight: 260, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, padding: 4 } },
        dirs.length === 0 ? h('div', { style: { ...S.empty, padding: '14px' } }, '没有子目录') : null,
        dirs.map((d) => h('button', {
          key: d.path, type: 'button',
          style: { ...S.ddRow, width: '100%', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit' },
          onClick: () => void load(d.path),
        }, h('span', { style: { flex: 1 } }, `📁 ${d.name}`), h('span', { style: { color: C.mute } }, '›')))) : null,
      // 在当前目录下新建子目录并选中
      h('div', { style: { ...S.row, marginTop: 10 } },
        h('input', {
          style: { ...S.input, minWidth: 120 }, placeholder: '在其内新建子目录（可选）',
          value: nameDraft, onChange: (e) => setNameDraft(e.target.value),
        }),
        h(Btn, {
          kind: 'primary', disabled: !path,
          onClick: () => onPick(nameDraft.trim() ? pathJoin(path, nameDraft.trim()) : path),
        }, '用这个目录'),
      ),
      path && !nameDraft.trim() ? h('div', { style: { fontSize: 11, color: C.mute, marginTop: 4 } },
        '提示：可以直接「用这个目录」，或先输入子目录名再选。') : null,
    )
  }

  // ---------------------------------------------------------------- 顶部栏（两页共用同一结构）
  // 固定布局：左边标题，右边 [未保存][放弃][保存]，最右一格是「导航键槽位」——
  // 队列页放齿轮 ⚙，设置页放返回 ←，两者占据**同一个位置**，切页时视觉不跳动。
  // 背景与卡片同用 S.card（不透明派生底），不单独设色。
  function TopBar({ title, sub, dirty, busy, onSave, onDiscard, nav }) {
    const off = busy || !dirty
    return h('div', {
      style: { ...S.card, marginBottom: 14, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 10 },
    },
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontSize: 17, fontWeight: 700, letterSpacing: '.2px' } }, title),
        h('div', { style: { fontSize: 12, color: C.mute } }, sub)),
      // 右侧：标记 + 两个按钮 + 导航键槽位（槽位固定宽度，保证两页最右完全重合）
      h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flex: 'none' } },
        dirty ? h('span', { style: { fontSize: 11, color: C.warn, whiteSpace: 'nowrap' } }, '● 未保存') : null,
        h('button', {
          type: 'button', disabled: off, onClick: onDiscard,
          style: { ...(off ? S.btnOff : S.btn), whiteSpace: 'nowrap' },
        }, '放弃'),
        h('button', {
          type: 'button', disabled: off, onClick: onSave,
          style: { ...(off ? S.btnOff : S.btnPrimary), whiteSpace: 'nowrap' },
        }, busy ? '保存中…' : '保存'),
        h('div', { style: { width: 34, flex: 'none', display: 'flex', justifyContent: 'flex-end' } }, nav),
      ),
    )
  }

  /** 放弃前统一二次确认（两页共用同一句文案） */
  function confirmDiscard() {
    return window.confirm('放弃本次未保存的修改，恢复成上次保存的状态？')
  }

  /**
   * 探测当前主题明暗，返回 'light' | 'dark'。
   *
   * 为什么需要：所有浮层/提示用了 CSS 系统色 `Canvas`。`Canvas` 是按
   * `color-scheme` 解析的——宿主页面若不声明 color-scheme，它**一律解析成白色**，
   * 于是暗色皮肤下会出现「白底白字」（toast 曾是白板）。
   *
   * 探测顺序：宿主 CSS 变量 → 祖先元素 computed background → prefers-color-scheme。
   */
  function detectScheme() {
    try {
      const root = document?.documentElement
      if (!root) return 'light'
      const cs = getComputedStyle(root)
      // 1) 宿主若显式声明了 color-scheme，直接采信
      const declared = (cs.colorScheme || '').trim()
      if (declared === 'dark' || declared === 'light') return declared
      // 2) 看宿主主色板变量（暗色主题通常给深底）
      const bgVar = cs.getPropertyValue('--dsw-color-background') ||
        cs.getPropertyValue('--dsw-color-bg') || ''
      const lum = luminance(bgVar)
      if (lum !== undefined) return lum < 0.5 ? 'dark' : 'light'
      // 3) 实测 body 的计算背景色（皮肤渐变会给出颜色，取第一个色标）
      const bodyBg = getComputedStyle(document.body || root).backgroundColor
      const lum2 = luminance(bodyBg)
      if (lum2 !== undefined) return lum2 < 0.5 ? 'dark' : 'light'
      // 4) 兜底：系统偏好
      if (typeof window?.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
    } catch { /* 拿不到就按亮色 */ }
    return 'light'
  }

  /** 从 CSS 颜色串估亮度（0 黑 – 1 白）；解析不了返回 undefined。 */
  function luminance(color) {
    const s = String(color ?? '').trim()
    if (!s) return undefined
    if (s === 'transparent') return undefined
    // rgb()/rgba()：取加权亮度
    const m = /rgba?\(([^)]+)\)/iu.exec(s)
    if (m) {
      const parts = m[1].split(/[,\s/]+/u).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x))
      if (parts.length >= 3) {
        const [r, g, b] = parts
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      }
    }
    // 十六进制
    const hex = /^#([0-9a-f]{3,8})$/iu.exec(s)
    if (hex) {
      const h = hex[1]
      const expand = (v) => (v.length === 1 ? v + v : v)
      const r = parseInt(expand(h.slice(0, 2)), 16)
      const g = parseInt(expand(h.slice(2, 4)), 16)
      const b = parseInt(expand(h.slice(4, 6)), 16)
      if ([r, g, b].every(Number.isFinite)) return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }
    return undefined
  }

  function QueuePage({ st, reload, busy, setBusy, toast, onOpenSettings, dirty, saveSettings, discardSettings }) {
    const [ids, setIds] = useState([])
    const [model, setModel] = useState(null)
    const [models, setModels] = useState(null)
    const [modelWarn, setModelWarn] = useState('')
    const [editing, setEditing] = useState(null)
    const [showHealth, setShowHealth] = useState(false)
    const [groupPick, setGroupPick] = useState('')
    const [showGroups, setShowGroups] = useState(false)
    const [newGroup, setNewGroup] = useState('')
    const [emotionPick, setEmotionPick] = useState('')
    const [zoom, setZoom] = useState(null)   // 点击缩略图放大的条目（Lightbox）
    const tab = st.tab
    const items = st.items ?? []
    // 二级筛选后的"看得见的图"：全选/计数都跟着它走，操作只作用于勾选的
    const shown = emotionPick ? items.filter((it) => it.emotion === emotionPick) : items

    useEffect(() => { setIds([]); setEditing(null); setEmotionPick('') }, [tab, st.group])

    // 模型清单（首次进入拉一次）
    useEffect(() => {
      let alive = true
      apiGet('/models').then((d) => {
        if (!alive) return
        setModels(d.models ?? [])
        setModel(d.configured ?? d.suggested ?? null)
      }).catch((e) => { if (alive) setModelWarn(`取模型清单失败：${e.message}`) })
      return () => { alive = false }
    }, [])

    const selSet = useMemo(() => new Set(ids), [ids])
    const toggleId = (id) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

    const tagging = st.tagging ?? { active: false, done: 0, total: 0 }

    async function act(fn) {
      setBusy(true)
      try { await fn(); await reload() } catch (e) { toast(`操作失败：${e.message}`) } finally { setBusy(false) }
    }

    return h('div', null,
      // ---- 顶部栏：标题 + 保存区 + 齿轮（齿轮在最右槽位）
      h(TopBar, {
        title: 'nekowhale-meme', sub: '大肥鱼表情库',
        dirty, busy,
        onSave: () => { void saveSettings() },
        onDiscard: () => { if (confirmDiscard()) discardSettings() },
        nav: h('button', { type: 'button', style: S.gear, title: '设置', onClick: onOpenSettings }, '⚙'),
      }),

      // ---- 失效提醒条
      st.missing?.count > 0 ? h('div', { style: S.notice },
        h('div', null, `⚠ ${st.missing.count} 张表情文件已失效，已从索引移除；如需继续使用请重新入库。`),
        h('div', { style: { ...S.row, marginTop: 8 } },
          h(Btn, { onClick: () => setShowHealth((v) => !v) }, showHealth ? '收起详情' : '查看详情'),
          h(Btn, { onClick: () => act(() => apiPost('/health/clear', { confirm: true })) }, '知道了')),
        showHealth ? h('div', { style: { marginTop: 8, maxHeight: 160, overflow: 'auto' } },
          (st.missing.items ?? []).map((m, i) => h('div', { key: `${m.id}-${i}`, style: { padding: '3px 0', fontSize: 11, color: C.mute } },
            `${m.displayName || m.id}｜原名 ${m.originalName || '—'}｜组 ${m.group || '—'}｜${fmtDate(m.at)}`))) : null,
      ) : null,

      // ---- 三 Tab
      h('div', { style: S.tabs },
        tabBtn('pending', '待识别', st.counts?.pending ?? 0),
        tabBtn('tagged', '已标识·待确认', st.counts?.tagged ?? 0),
        tabBtn('library', '已入库·可用', st.counts?.library ?? 0)),

      // ---- 待识别
      tab === 'pending' ? h('div', null,
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h(Btn, { onClick: () => setIds(ids.length === items.length ? [] : items.map((i) => i.id)) }, ids.length === items.length && items.length > 0 ? '取消全选' : '全选'),
            h(Btn, {
              kind: 'primary', disabled: ids.length === 0 || busy,
              onClick: () => act(async () => {
                const r = await apiPost('/tag', { ids, model: model ?? undefined })
                toast(`识别完成：成功 ${r.results.filter((x) => x.ok).length}，失败 ${r.results.filter((x) => !x.ok).length}`)
              }),
            }, '识别勾选'),
            h(Btn, {
              kind: 'danger', disabled: ids.length === 0 || busy,
              onClick: () => { if (!window.confirm(`删除选中的 ${ids.length} 张？`)) return; act(() => apiPost('/delete', { ids, confirm: true, purgeFiles: true })) },
            }, '删除勾选'),
            h('span', { style: { marginLeft: 'auto', fontSize: 12, color: C.mute } }, `已选 ${ids.length} 张`)),
          // 识别模型行
          h('div', { style: S.field },
            h('span', { style: S.label }, '识别模型'),
            h('select', {
              style: S.select, value: model ? `${model.provider}\u0000${model.model}` : '',
              onChange: (e) => {
                const [p, m] = e.target.value.split('\u0000')
                setModel(p && m ? { provider: p, model: m } : null)
              },
            },
              h('option', { value: '' }, models === null ? '正在读取可用模型…' : '（未选，自动挑支持图片的）'),
              (models ?? []).map((r) => h('option', {
                key: `${r.provider}/${r.model}`, value: `${r.provider}\u0000${r.model}`,
                disabled: !r.vision,
              }, `${r.providerName || r.provider} / ${r.modelName || r.model}${r.vision ? '' : '（不支持图片）'}`))),
            h('span', { style: S.red }, '识别需要消耗 token')),
          modelWarn ? h('div', { style: S.red }, modelWarn) : null,
          models !== null && (models ?? []).filter((r) => r.vision).length === 0
            ? h('div', { style: S.warnBox }, '没找到支持图片输入的模型。请先在 DSH 里配一个视觉模型，否则识别不能用。') : null,
          tagging.active ? h('div', { style: { ...S.row, marginTop: 10 } },
            h('span', { style: { fontSize: 12, color: C.mute, flex: 'none' } }, `识别中… ${tagging.done}/${tagging.total}`),
            h('div', { style: S.progressOuter }, h('div', { style: { ...S.progressInner, width: `${tagging.total ? (tagging.done / tagging.total) * 100 : 0}%` } })),
            h(Btn, { kind: 'danger', onClick: () => act(() => apiPost('/cancel')) }, '中止')) : null),

        h('div', { style: S.card },
          items.length === 0 ? h('div', { style: S.empty }, '队列是空的。到设置页导入，或用「上传」把图收进来。') : null,
          h('div', { style: S.list }, items.map((it) => h(QueueItem, {
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id), onZoom: () => setZoom(it),
          }))),
          h('div', { style: { ...S.row, marginTop: 10 } }, h(UploadButton, { toast, reload }))),
      ) : null,

      // ---- 已标识·待确认
      tab === 'tagged' ? h('div', null,
        h('div', { style: S.card },
          h(EmotionFilter, { emotions: st.emotions ?? [], items, value: emotionPick, onChange: setEmotionPick }),
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h(Btn, { onClick: () => setIds(ids.length === shown.length ? [] : shown.map((i) => i.id)) }, ids.length === shown.length && shown.length > 0 ? '取消全选' : '全选'),
            h('select', { style: { ...S.select, minWidth: 130, maxWidth: 160 }, value: groupPick, onChange: (e) => setGroupPick(e.target.value) },
              h('option', { value: '' }, '入库到…（默认收藏）'),
              (st.groups ?? []).filter((g) => !g.readonly && !g.virtual).map((g) => h('option', { key: g.id, value: g.id }, g.name))),
            h(Btn, {
              kind: 'primary', disabled: ids.length === 0 || busy,
              onClick: () => act(async () => {
                const r = await apiPost('/confirm', { ids, group: groupPick || undefined })
                toast(`入库 ${r.done.length} 张${r.errors.length ? `，${r.errors.length} 张失败（${r.errors[0]?.reason ?? '未知原因'}）` : ''}`)
              }),
            }, '确认入库'),
            h(Btn, {
              disabled: ids.length === 0 || busy,
              onClick: () => act(async () => {
                const r = await apiPost('/revert-to-pending', { ids })
                toast(r.done.length > 0
                  ? `已退回待识别 ${r.done.length} 张，请到第一栏重新识别`
                  : (r.errors?.[0]?.reason ?? '退回失败'))
              }),
            }, '重新识别'),
            h(Btn, {
              kind: 'danger', disabled: ids.length === 0 || busy,
              onClick: () => { if (!window.confirm(`删除选中的 ${ids.length} 张？`)) return; act(() => apiPost('/delete', { ids, confirm: true, purgeFiles: true })) },
            }, '删除勾选'),
            h('span', { style: { marginLeft: 'auto', fontSize: 12, color: C.mute } }, `已选 ${ids.length} 张`)),
          shown.length === 0 ? h('div', { style: S.empty }, items.length === 0 ? '没有待确认的图。' : `这个情绪下没有待确认的图（共 ${items.length} 张，切「全部」看）。`) : null,
          h('div', { style: S.list }, shown.map((it) => h(TaggedItem, {
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id),
            onEdit: () => setEditing(it), onZoom: () => setZoom(it),
          })))),
      ) : null,

      // ---- 已入库·可用
      tab === 'library' ? h('div', null,
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 10 } },
            h('select', { style: { ...S.select, minWidth: 170 }, value: st.group ?? '', onChange: (e) => reload({ group: e.target.value }) },
              h('option', { value: '' }, `全部分组（${st.counts?.library ?? 0}）`),
              (st.groups ?? []).map((g) => h('option', { key: g.id, value: g.id },
                g.virtual
                  ? `${g.name}（${g.count}）` + (g.count > 0 ? ' ⚠' : '')
                  : `${g.name}（${g.count}）${g.readonly ? ' 只读' : ''}`))),
            h(Btn, { onClick: () => setShowGroups((v) => !v) }, showGroups ? '收起分组管理' : '管理分组')),
          showGroups ? h('div', { style: { borderTop: `1px solid ${C.border}`, paddingTop: 10, marginBottom: 10 } },
            (st.groups ?? []).map((g) => h('div', { key: g.id, style: { ...S.row, padding: '4px 0' } },
              h('span', { style: { flex: 1, fontSize: 13 } }, `${g.name}`),
              h('span', { style: { fontSize: 11, color: g.virtual && g.count > 0 ? C.warn : C.mute, marginRight: 8 } },
                `${g.count} 张${g.virtual ? ' · 虚拟组' : g.readonly ? ' · 只读' : ''}`),
              // 虚拟组（未分组）不能改名/删除——它没有真实分组行
              g.virtual
                ? h('span', { style: { fontSize: 11, color: C.mute } }, '这些图没有归属分组')
                : g.readonly
                  // 只读的角色包组：不能改名、不能零散编辑，但可以整包移除（否则下载错了没退路）
                  ? h('span', { style: S.row },
                    h('span', { style: { fontSize: 11, color: C.mute, marginRight: 8 } }, '只读 · 包'),
                    h(Btn, {
                      kind: 'danger',
                      onClick: () => {
                        if (!window.confirm(`移除角色包「${g.name}」？组里 ${g.count} 张图和磁盘文件都会删掉。\n之后重新导入会重新下载。`)) return
                        act(() => apiPost('/group', { action: 'removePack', id: g.id, purgeFiles: true }))
                      },
                    }, '移除包'))
                  : h('span', { style: S.row },
                    h(Btn, {
                      onClick: () => {
                        const name = window.prompt('新的组名', g.name)
                        if (name && name.trim() && name.trim() !== g.name) act(() => apiPost('/group', { action: 'rename', id: g.id, name: name.trim() }))
                      },
                    }, '重命名'),
                    h(Btn, {
                      kind: 'danger',
                      onClick: () => {
                        if (!window.confirm(`删除分组「${g.name}」？组里 ${g.count} 张图也会一起删掉。`)) return
                        act(() => apiPost('/group', { action: 'delete', id: g.id, purgeFiles: true }))
                      },
                    }, '删除')))),
            h('div', { style: { ...S.row, marginTop: 8 } },
              h('input', { style: { ...S.input, minWidth: 140, maxWidth: 220 }, placeholder: '新分组名', value: newGroup, onChange: (e) => setNewGroup(e.target.value) }),
              h(Btn, {
                kind: 'primary', disabled: !newGroup.trim(),
                onClick: () => act(async () => { await apiPost('/group', { action: 'create', name: newGroup.trim() }); setNewGroup('') }),
              }, '+ 新建组'))) : null,
          h(EmotionFilter, { emotions: st.emotions ?? [], items, value: emotionPick, onChange: setEmotionPick }),
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h(Btn, { onClick: () => setIds(ids.length === shown.length ? [] : shown.map((i) => i.id)) }, ids.length === shown.length && shown.length > 0 ? '取消全选' : '全选'),
            h(Btn, {
              disabled: ids.length === 0 || busy,
              onClick: () => act(async () => {
                const r = await apiPost('/revert', { ids })
                toast(`已移出 ${r.done.length} 张到待确认`)
              }),
            }, '移出到待确认'),
            h('select', {
              style: { ...S.select, minWidth: 120, maxWidth: 150 }, value: '',
              onChange: (e) => {
                const to = e.target.value
                if (!to || ids.length === 0) { e.target.value = ''; return }
                act(async () => {
                  const r = await apiPost('/group', { action: 'move', ids, to })
                  const failN = r.failed?.length ?? 0
                  if (failN > 0 && r.moved.length === 0) {
                    // 全部失败时把具体原因说出来（典型：只读组不能移出）
                    toast(`没有移动：${r.failed[0]?.reason ?? '未知原因'}`)
                    return
                  }
                  toast(`移动 ${r.moved.length} 张${failN > 0 ? `，${failN} 张失败（${r.failed[0]?.reason ?? ''}）` : ''}`)
                })
                e.target.value = ''
              },
            }, h('option', { value: '' }, '改分组…'),
              (st.groups ?? []).filter((g) => !g.readonly && !g.virtual).map((g) => h('option', { key: g.id, value: g.id }, g.name)),
              h('option', { value: '__ungrouped__' }, '（移出分组）')),
            h(Btn, {
              kind: 'danger', disabled: ids.length === 0 || busy,
              onClick: () => { if (!window.confirm(`删除选中的 ${ids.length} 张？`)) return; act(() => apiPost('/delete', { ids, confirm: true, purgeFiles: true })) },
            }, '删除勾选'),
            h('span', { style: { marginLeft: 'auto', fontSize: 12, color: C.mute } }, `已选 ${ids.length} 张`)),
          shown.length === 0 ? h('div', { style: S.empty }, items.length === 0 ? '这一栏没有图。' : `这个情绪下没有图（共 ${items.length} 张，切「全部」看）。`) : null,
          h('div', { style: S.list }, shown.map((it) => h(LibraryItem, {
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id), onEdit: () => setEditing(it), onZoom: () => setZoom(it),
          })))),
      ) : null,

      // ---- 点击缩略图的放大预览（浮在所有东西上面）
      zoom ? h(Lightbox, { item: zoom, onClose: () => setZoom(null) }) : null,

      // ---- 编辑面板
      editing ? h(EditPanel, {        item: editing, groups: st.groups ?? [], busy,
        onClose: () => setEditing(null),
        onSave: (patch) => act(async () => {
          await apiPost('/update', { id: editing.id, patch })
          setEditing(null)
          toast('已保存')
        }),
      }) : null,
    )

    function tabBtn(key, label, count) {
      return h('button', {
        type: 'button', style: tab === key ? S.tabOn : S.tab,
        onClick: () => { setIds([]); reload({ tab: key, group: key === 'library' ? (st.group ?? '') : '' }) },
      },
        h('span', { style: { fontWeight: 600, fontSize: 13 } }, label),
        h('span', { style: S.tabCount }, String(count)))
    }
  }

  /**
   * 二级筛选：按情绪过滤当前栏目的图。
   * 「全部」+ 25 个情绪按钮；该情绪下没图的按钮置灰不可点（用户偏好：无意义选项置灰）。
   * 纯前端过滤——数据本来就按 tab/组整页拉回来了，不再多打一次请求。
   */
  function EmotionFilter({ emotions, items, value, onChange }) {
    const countOf = (e) => items.filter((it) => it.emotion === e).length
    return h('div', { style: { ...S.row, gap: 6, marginBottom: 10 } },
      h('span', { style: { fontSize: 12, color: C.mute, flex: 'none' } }, '按情绪'),
      h('button', {
        type: 'button', style: value === '' ? S.chipOn : S.chipBtn, onClick: () => onChange(''),
      }, `全部（${items.length}）`),
      emotions.map((e) => {
        const n = countOf(e)
        return h('button', {
          key: e, type: 'button', disabled: n === 0,
          style: value === e ? S.chipOn : (n === 0 ? S.chipOff : S.chipBtn),
          onClick: () => onChange(value === e ? '' : e),
        }, n === 0 ? e : `${e} ${n}`)
      }))
  }

  // ---------------------------------------------------------------- 列表项
  function QueueItem({ it, checked, onToggle, onZoom }) {
    const status = it.failReason ? `识别失败：${it.failReason}` : '待识别'
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: { ...S.thumb, cursor: 'zoom-in' }, loading: 'lazy', title: '点击放大', onClick: onZoom }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta },
          `${it.originalName}｜${fmtBytes(it.bytes)}${it.ext === '.gif' ? '｜动图' : ''}`)),
      h('span', { style: { fontSize: 12, color: it.failReason ? C.danger : C.warn, textAlign: 'right', maxWidth: 220 } }, status))
  }

  function TaggedItem({ it, checked, onToggle, onEdit, onZoom }) {
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: { ...S.thumb, cursor: 'zoom-in' }, loading: 'lazy', title: '点击放大', onClick: onZoom }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta }, `${it.emotion || '未定'}｜${(it.tags ?? []).join('、') || '无标签'}`),
        it.use ? h('div', { style: { fontSize: 11, color: C.mute } }, it.use) : null),
      h(Btn, { onClick: onEdit }, '编辑'))
  }

  function LibraryItem({ it, checked, onToggle, onEdit, onZoom }) {
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: { ...S.thumb, cursor: 'zoom-in' }, loading: 'lazy', title: '点击放大', onClick: onZoom }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta },
          `${it.originalName}｜${fmtDate(it.addedAt)}｜${it.emotion || '—'}`),
        (it.tags ?? []).length > 0 ? h('div', null, it.tags.map((t) => h('span', { key: t, style: S.chip }, t))) : null),
      it.readonly ? h('span', { style: { fontSize: 11, color: C.mute } }, '只读') : h(Btn, { onClick: onEdit }, '编辑'))
  }

  // ---------------------------------------------------------------- 双击放大预览
  /**
   * 灯箱：页面居中显示原图（点缩略图触发；宿主 GUI 不代理 dblclick，故用单击）。**只给 maxWidth/maxHeight 不给 min-width**——
   * img 不会放大超过原图自然尺寸，天然满足「不超过表情包原图大小」。
   * 关闭：右上角 ✕，或点图片外任意空白。
   */
  function Lightbox({ item, onClose }) {
    return h('div', {
      style: {
        position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
      },
      onClick: onClose,
    },
      h('div', { style: { position: 'relative', cursor: 'default' }, onClick: (e) => e.stopPropagation() },
        h('img', {
          src: item.url, alt: item.displayName || item.originalName,
          style: { maxWidth: '90vw', maxHeight: '84vh', display: 'block', borderRadius: 10, boxShadow: '0 18px 44px rgba(0,0,0,.5)' },
        }),
        h('button', {
          type: 'button', title: '关闭', onClick: onClose,
          style: {
            position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 999,
            border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer', fontSize: 15, lineHeight: '28px',
          },
        }, '✕')))
  }

  // ---------------------------------------------------------------- 编辑面板
  function EditPanel({ item, busy, onClose, onSave }) {
    const [name, setName] = useState(item.displayName ?? '')
    const [emotion, setEmotion] = useState(item.emotion ?? '其他')
    const [tags, setTags] = useState((item.tags ?? []).join('、'))
    const [use, setUse] = useState(item.use ?? '')
    const [desc, setDesc] = useState(item.desc ?? '')
    return h('div', { style: { ...S.card, position: 'fixed', right: 20, bottom: 20, width: 380, zIndex: 9998, boxShadow: '0 18px 44px rgba(0,0,0,.55)' } },
      h('div', { style: S.cardTitle }, '编辑', h('span', { style: { marginLeft: 'auto' } }, h(Btn, { onClick: onClose }, '关闭'))),
      h('div', { style: S.field }, h('span', { style: S.label }, '显示名'), h('input', { style: S.input, value: name, onChange: (e) => setName(e.target.value) })),
      h('div', { style: S.field }, h('span', { style: S.label }, '情绪'),
        h('select', { style: { ...S.select, minWidth: 140 }, value: emotion, onChange: (e) => setEmotion(e.target.value) },
          EMOTIONS.map((x) => h('option', { key: x, value: x }, x)))),
      h('div', { style: S.field }, h('span', { style: S.label }, '标签（顿号分隔）'),
        h('input', { style: S.input, value: tags, onChange: (e) => setTags(e.target.value) })),
      h('div', { style: S.field }, h('span', { style: S.label }, '适用场景'), h('input', { style: S.input, value: use, onChange: (e) => setUse(e.target.value) })),
      h('div', { style: S.field }, h('span', { style: S.label }, '描述'), h('input', { style: S.input, value: desc, onChange: (e) => setDesc(e.target.value) })),
      h('div', { style: { ...S.row, marginTop: 10 } },
        h(Btn, {
          kind: 'primary', disabled: busy,
          onClick: () => onSave({
            displayName: name.trim(), emotion,
            tags: tags.split(/[、,，\s]+/u).map((t) => t.trim()).filter(Boolean),
            use, desc,
          }),
        }, '保存'),
        h('span', { style: { fontSize: 11, color: C.mute } }, '改的是索引里的显示名，磁盘文件名不变')))
  }

  // ---------------------------------------------------------------- 上传
  function UploadButton({ toast, reload }) {
    const ref = useRef(null)
    const [busy, setBusy] = useState(false)
    const pick = () => ref.current?.click()
    const onFiles = async (e) => {
      const input = e.target
      const picked = Array.from(input.files ?? [])
      if (picked.length === 0) return
      setBusy(true)
      try {
        const payload = []
        for (const f of picked) {
          const buf = await f.arrayBuffer()
          let bin = ''
          const bytes = new Uint8Array(buf)
          const CH = 0x8000
          for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
          payload.push({ name: f.name, dataBase64: btoa(bin) })
        }
        // 注意：这里**不提前**清 input——统一在 finally（整个上传流程结束）后释放，
        // 语义 = 「上传结束后浏览器才停止占用原文件」，避免大批量时中途状态错乱。
        const r = await apiPost('/import', { files: payload })
        const okN = (r.results ?? []).filter((x) => x.id).length
        const skips = (r.results ?? []).filter((x) => x.skipped)
        toast(`上传 ${okN} 张${skips.length ? `，跳过 ${skips.length}（${skips[0].skipped}）` : ''}`)
        await reload()
      } catch (err) {
        toast(`上传失败：${err.message}`)
      } finally {
        setBusy(false)
        // 上传结束（含失败）→ 清空 input 与 File 引用，浏览器此刻起不再占用原文件，
        // 用户即可删除/移动原始图片。
        input.value = ''
        picked.length = 0
      }
    }
    return h('span', { style: S.row },
      h('input', { ref, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: onFiles }),
      h(Btn, { kind: 'primary', disabled: busy, onClick: pick }, busy ? '上传中…' : '上传图片'),
      h('span', { style: { fontSize: 11, color: C.mute } }, '只进队列，不会自动识别'))
  }

  // ---------------------------------------------------------------- 设置页
  function SettingsPage({ st, reload, busy, setBusy, toast, onBack, cfg, setCfg, dirDraft, setDirDraft, base, dirty, saveSettings, discardSettings }) {
    const [importing, setImporting] = useState(false)
    const [importMsg, setImportMsg] = useState('')
    const [progress, setProgress] = useState(null)
    const [dirPickerOpen, setDirPickerOpen] = useState(false)
    const [pickingDir, setPickingDir] = useState(false)
    // 包选择器（只属于本页，不跨页共享）
    const [packs, setPacks] = useState([])
    const [packsLoading, setPacksLoading] = useState(true)
    const [packsErr, setPacksErr] = useState('')
    const [selectedPacks, setSelectedPacks] = useState([])

    useEffect(() => {
      // 配置草稿由 App 统一读取；这里只管包清单
      loadPacks()
    }, [])

    const loadPacks = useCallback(async () => {
      setPacksLoading(true); setPacksErr('')
      try {
        const d = await apiGet('/packs')
        const list = d.packs ?? []
        setPacks(list)
        // 已全部下载的包不再可选（与 PackPicker 的置灰规则保持一致）
        const downloadable = (p) => !(p.have >= p.count && p.count > 0)
        const dflt = (d.defaults ?? []).filter((n) => list.some((p) => p.name === n && downloadable(p)))
        setSelectedPacks((cur) => {
          // 清掉已经下载完的（比如下载完一包后刷新，它不该仍留在已选里）
          const kept = cur.filter((n) => list.some((p) => p.name === n && downloadable(p)))
          if (kept.length > 0) return kept
          return dflt
        })
      } catch (e) {
        setPacksErr(`拿不到包清单：${e.message}`)
      } finally { setPacksLoading(false) }
    }, [])

    const patchCfg = (fn) => setCfg((cur) => fn({ ...(cur ?? {}) }))

    if (!cfg) {
      return h('div', { style: S.page }, h('div', { style: S.empty }, '正在读取设置…'))
    }
    const a = cfg.autoSend ?? { enabled: false, limitPer10: 2, trigger: 'keywords', groups: [] }
    const groups = st.groups ?? []
    const pickedPacks = packs.filter((p) => selectedPacks.includes(p.name))
    const pickedCount = pickedPacks.reduce((s, p) => s + p.count, 0)
    const pickedBytes = pickedPacks.reduce((s, p) => s + p.bytes, 0)
    // 所有包都已下载完（此时没有可勾选项，按钮要说明原因而不是干等着）
    const allPacksDone = packs.length > 0 && packs.every((p) => p.have >= p.count && p.count > 0)
    // dirty / saveSettings / discardSettings 均由 App 传入，两页共用同一份
    const save = saveSettings
    // 确认已由 SaveBar 调用方统一做（confirmDiscard），这里直接执行
    const discard = () => {
      if (!dirty) return
      discardSettings()
    }

    return h('div', null,
      // ---- 顶部栏：标题 + 保存区 + 返回（返回占据与队列页齿轮同一个最右槽位）
      h(TopBar, {
        title: '设置', sub: 'nekowhale-meme',
        dirty, busy,
        onSave: () => { void save() },
        onDiscard: () => { if (confirmDiscard()) discard() },
        nav: h('button', {
          type: 'button', style: { ...S.gear, fontSize: 15 }, title: '返回队列页',
          onClick: () => {
            if (dirty && !window.confirm('还有未保存的修改，直接返回将丢失。确定返回？')) return
            onBack()
          },
        }, '←'),
      }),

      // ---- 基础
      h('div', { style: S.card },
        h('div', { style: S.cardTitle }, '基础'),
        h('div', { style: S.field },
          h('span', { style: S.label }, '数据目录'),
          // 只读：路径只能通过「选择…」挑，不允许手打（手打会绕过校验与迁移逻辑）
          h('input', {
            style: { ...S.input, cursor: 'default', opacity: .95 },
            value: dirDraft, readOnly: true, tabIndex: -1,
            title: '路径只能通过「选择…」挑选',
            placeholder: '点右侧「选择…」挑一个目录',
          }),
          h(Btn, {
            disabled: pickingDir,
            title: '打开系统目录选择框；环境不支持时改用内置浏览器',
            onClick: async () => {
              setPickingDir(true)
              try {
                const r = await apiPost('/pick-dir', { startPath: dirDraft || cfg?.dataDir || undefined })
                if (r.ok && r.path) {
                  // 只填进输入框，**不自动保存**——保存按钮是唯一写入途径，
                  // 不点保存就退出（包括直接关掉插件页）一律视为放弃修改。
                  setDirDraft(r.path)
                  return
                }
                if (r.ok && !r.path) return // 用户取消
                // 系统框不可用（远程访问/非桌面环境）→ 回退自绘浏览器
                if (r.fallback) setDirPickerOpen(true)
                else toast(r.error ?? '打开系统选择框失败')
              } catch (e) {
                toast(`打开系统选择框失败：${e.message}`)
                setDirPickerOpen(true)
              } finally { setPickingDir(false) }
            },
          }, pickingDir ? '等待选择…' : '选择…')),
        dirPickerOpen ? h(DirPicker, {
          onPick: (p) => {
            // 同系统选择框：只填输入框，等用户点「保存设置」才写入。
            setDirPickerOpen(false)
            setDirDraft(p)
          },
          onClose: () => setDirPickerOpen(false),
        }) : null,
        h('div', { style: { fontSize: 11, color: C.mute, margin: '-4px 0 12px' } },
          '换目录时会把当前目录的图库与索引一并**搬迁**到新目录（旧目录随即清空）。点「保存」才生效。'),
        h('div', { style: S.field },
          h('span', { style: S.label }, '初始表情包'),
          h(Btn, {
            kind: 'primary', disabled: importing || selectedPacks.length === 0,
            onClick: async () => {
              setImporting(true); setImportMsg('')
              setProgress(null)
              const timer = window.setInterval(async () => {
                try {
                  const d = await apiGet('/import-progress')
                  if (d?.progress) setProgress(d.progress)
                } catch { /* 轮询失败忽略 */ }
              }, 800)
              try {
                const r = await apiPost('/import-nekowhale', { packs: selectedPacks })
                if (r.ok) {
                  const parts = [`新增 ${r.added} 张`]
                  if (r.tagged > 0) parts.push(`其中 ${r.tagged} 张带作者标注`)
                  if (r.untagged > 0) parts.push(`${r.untagged} 张无标注`)
                  if (r.skipped > 0) parts.push(`跳过 ${r.skipped} 张（已有）`)
                  if (r.failed?.length) parts.push(`失败 ${r.failed.length} 张`)
                  const gs = (r.groups ?? []).map((g) => `${g.name} ${g.count}`).join('、')
                  setImportMsg(`${parts.join('，')}（清单共 ${r.total} 张；分组：${gs}）`)
                  await loadPacks()   // 刷新「已下 N」
                } else {
                  setImportMsg(`导入失败：${r.error ?? '未知原因'}`)
                }
              } catch (e) {
                setImportMsg(`失败：${e.message}`)
              } finally {
                window.clearInterval(timer)
                setImporting(false)
                setProgress(null)
              }
            },
          }, importing ? '下载中…'
            : selectedPacks.length === 0
              ? (allPacksDone ? '所有包都已下载完成' : '先选要下载的包')
              : `下载初始表情包（${pickedCount} 张 · ${fmtMB(pickedBytes)}）`),
          h('span', { style: { fontSize: 11, color: C.mute } },
            '从 kiriyuki.com 直连下载，不用另装插件')),
        // 包选择器
        h('div', { style: { ...S.field, marginTop: 8 } },
          h('span', { style: S.label }, '选择要下载的包'),
          packsLoading
            ? h('span', { style: { fontSize: 12, color: C.mute } }, '正在读取包清单…')
            : packsErr
              ? h('span', { style: S.row },
                h('span', { style: { fontSize: 12, color: C.danger } }, packsErr),
                h(Btn, { onClick: loadPacks }, '重试'))
              : h(PackPicker, {
                packs, selected: selectedPacks, onChange: setSelectedPacks, disabled: importing,
              })),
        h('div', { style: { fontSize: 11, color: C.mute, marginTop: 2 } },
          '每个包会建成一个独立的只读组（组名＝包名），组里的图只能看不能改。'),
        // 下载进度
        importing && progress ? h('div', { style: { marginTop: 4, marginBottom: 8 } },
          h('div', { style: { ...S.row, fontSize: 11, color: C.mute, marginBottom: 4 } },
            h('span', null, progress.phase === 'manifest' ? '正在拉取清单…'
              : progress.phase === 'download' ? `下载中 ${progress.done}/${progress.total}（新增 ${progress.added}${progress.packCount > 0 ? `，包 ${progress.packDone}/${progress.packCount}` : ''}）`
              : progress.phase === 'done' ? '已完成'
              : progress.phase === 'error' ? `出错：${progress.error}` : '准备中…'),
            h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } },
              progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '')),
          h('div', { style: S.progressOuter },
            h('div', { style: { ...S.progressInner, width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` } }))) : null,
        importMsg ? h('div', { style: { fontSize: 12, color: C.mute, marginBottom: 6 } }, importMsg) : null,
        h('div', { style: { fontSize: 11, color: C.mute, marginTop: 6 } },
          '表情包作者：B站 可以叫我云大人（space.bilibili.com/103739），kiriyuki.com 制作')),

      // ---- 斗图
      h('div', { style: S.card },
        h('div', { style: S.cardTitle },
          '斗图',
          h('button', {
            type: 'button', style: S.toggle(a.enabled), onClick: () => patchCfg((c) => ({ ...c, autoSend: { ...a, enabled: !a.enabled } })),
          }, h('span', { style: S.toggleDot(a.enabled) })),
          h('span', { style: { fontSize: 11, color: C.mute, fontWeight: 'normal' } }, a.enabled ? '已开启' : '已关闭')),
        h('div', { style: S.field },
          h('span', { style: S.label }, '频率'),
          h(Stepper, {
            value: a.limitPer10, min: 1, max: 10,
            onChange: (n) => patchCfg((c) => ({ ...c, autoSend: { ...a, limitPer10: n } })),
            suffix: '每 10 轮最多发这么多张',
          })),
        h('div', { style: S.field },
          h('span', { style: S.label }, '触发方式'),
          h('label', { style: { ...S.row, gap: 6, fontSize: 13 } },
            h('input', {
              type: 'radio', checked: a.trigger !== 'model', onChange: () => patchCfg((c) => ({ ...c, autoSend: { ...a, trigger: 'keywords' } })),
            }),
            '情绪词匹配'),
          h('label', { style: { ...S.row, gap: 6, fontSize: 13, marginLeft: 16 } },
            h('input', {
              type: 'radio', checked: a.trigger === 'model', onChange: () => patchCfg((c) => ({ ...c, autoSend: { ...a, trigger: 'model' } })),
            }),
            '模型判断')),
        // 「真斗图」联动候选窗点击行为（用户 2026-11-05 要求放设置页）：
        // 开=图片模式（点图发真图片附件，双方可见，每条 ~170-400 token）；
        // 关=文字模式（点图插 Markdown 文本行，~40 token，但自己气泡显原始文本）。
        // AI 侧 meme_send 发图不受此开关影响（模型发的永远是图片）。
        h('div', { style: S.field },
          h('span', { style: S.label }, '真斗图'),
          h('button', {
            type: 'button', style: S.toggle(cfg.pickerMode !== 'text'),
            onClick: () => patchCfg((c) => ({ ...c, pickerMode: c.pickerMode === 'text' ? 'image' : 'text' })),
          }, h('span', { style: S.toggleDot(cfg.pickerMode !== 'text') })),
          h('span', { style: { fontSize: 11, color: C.mute } },
            cfg.pickerMode === 'text'
              ? '关：候选窗点图=文字发送（省 token，自己消息显文本）'
              : '开：候选窗点图=图片发送（双方可见，已缩小省 token）'))),
      // ---- AI 可用组
      h('div', { style: S.card },
        h('div', { style: S.cardTitle }, 'AI 可用组'),
        h('div', { style: S.cardHint }, '决定 AI 能从哪里检索表情；没勾的组 AI 完全看不到。'),
        h(GroupPicker, {
          groups, selected: a.groups ?? [],
          onChange: (next) => patchCfg((c) => ({ ...c, autoSend: { ...a, groups: next } })),
        }),
        h('div', { style: { fontSize: 11, color: C.mute, marginTop: 6 } }, '新建的组默认不勾选。')),
    )
  }

  // ---------------------------------------------------------------- 主组件
  function App(props) {
    const [page, setPage] = useState('queue')
    const [st, setSt] = useState({ tab: 'pending', group: '', items: [], counts: {}, groups: [], tagging: { active: false } })
    const [err, setErr] = useState('')
    const [busy, setBusy] = useState(false)
    const [toastMsg, setToastMsg] = useState('')
    const q = useRef({ tab: 'pending', group: '' })
    const alive = useRef(true)

    // ---- 设置草稿提升到 App 层：两个页面共享同一份，任一页都能保存
    const [cfg, setCfg] = useState(null)
    const [dirDraft, setDirDraft] = useState('')
    const [base, setBase] = useState(null)      // 最后一次保存/读取成功的基线
    const settingsLoaded = useRef(false)

    const toast = useCallback((m) => {
      setToastMsg(String(m ?? ''))
      window.setTimeout(() => setToastMsg(''), 4000)
    }, [])

    // 设置只在首次进入插件时读一次；之后两页共用这份草稿
    useEffect(() => {
      if (settingsLoaded.current) return
      settingsLoaded.current = true
      apiGet('/config').then((d) => {
        setCfg(d.config)
        const dir = d.dataDir ?? d.config?.dataDir ?? ''
        setDirDraft(dir)
        setBase({ cfg: d.config, dir })
      }).catch((e) => toast(`读配置失败：${e.message}`))
    }, [toast])

    /** 与基线比对：任一字段变了即视为有未保存修改 */
    const dirty = !base || (cfg !== null && JSON.stringify({ c: cfg, d: dirDraft }) !== JSON.stringify({ c: base.cfg, d: base.dir }))

    /** 保存设置（唯一写入途径）。队列页与设置页共用。 */
    const saveSettings = useCallback(async () => {
      if (!cfg) return
      setBusy(true)
      try {
        const body = { ...cfg, dataDir: dirDraft.trim() || cfg?.dataDir }
        const r = await apiPost('/config', { config: body })
        setCfg(r.config)
        const dir = r.dataDir ?? r.config?.dataDir ?? ''
        setDirDraft(dir)
        setBase({ cfg: r.config, dir })
        toast('设置已保存')
      } catch (e) {
        toast(`保存失败：${e.message}`)
      } finally { setBusy(false) }
    }, [cfg, dirDraft, toast])

    /** 放弃未保存的修改，回到基线 */
    const discardSettings = useCallback(() => {
      if (!base) return
      setCfg(base.cfg)
      setDirDraft(base.dir)
      toast('已放弃未保存的修改')
    }, [base, toast])

    const load = useCallback(async (next) => {
      if (next) q.current = { ...q.current, ...next }
      try {
        const d = await apiGet('/state', { tab: q.current.tab, group: q.current.group })
        if (!alive.current) return
        setSt(d)
        setErr('')
      } catch (e) {
        if (alive.current) setErr(`读状态失败：${e.message}`)
      }
    }, [])

    // 首次打开：做一次全量自检（「打开插件时」这个时机）
    useEffect(() => {
      alive.current = true
      ;(async () => {
        try {
          const d = await apiGet('/status', { tab: 'pending', group: '' })
          if (alive.current) setSt(d)
        } catch (e) {
          if (alive.current) setErr(`自检失败：${e.message}`)
        }
      })()
      return () => { alive.current = false }
    }, [])

    // 轮询（识别中走快轮询）
    useEffect(() => {
      const active = st.tagging?.active === true
      const ms = active ? POLL_FAST_MS : POLL_MS
      const t = window.setInterval(() => { void load() }, ms)
      return () => window.clearInterval(t)
    }, [load, st.tagging?.active])

    const reload = useCallback(async (next) => { await load(next) }, [load])

    const full = props?.view === 'page'
    const style = full ? S.pageFull : S.page
    // 探测主题明暗：供 colorScheme 声明 + 反色浮层配色
    const scheme = detectScheme()
    const inv = invertColors(scheme)

    const body = page === 'settings'
      ? h(SettingsPage, {
        st, reload, busy, setBusy, toast,
        cfg, setCfg, dirDraft, setDirDraft, dirty, saveSettings, discardSettings,
        dirty, saveSettings, discardSettings,
        onBack: () => { setPage('queue'); void load() },
      })
      : h(QueuePage, {
        st, reload, busy, setBusy, toast, dirty, saveSettings, discardSettings,
        onOpenSettings: () => setPage('settings'),
      })

    return h('div', { style: { ...style, colorScheme: scheme } },
      err ? h('div', { style: S.warnBox }, err) : null,
      body,
      toastMsg ? h('div', {
        style: { position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 10000, background: inv.bg, color: inv.fg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 14px', fontSize: 12, colorScheme: scheme },
      }, toastMsg) : null,
    )
  }

  // ------------------------------------------------------------ 输入框表情按钮
  // 位置确认阶段：只渲染按钮，不绑点击。槽位 conversation.input.right =
  // 「发送按钮之前的紧凑控件」，所以它会出现在工具行右端、紧邻发送键左侧。
  // 图标用表情库里的鲸鱼娘（用户 2026-11-05 指定「截取脸部，不露出身体」），
  // 走已有图片路由；那张图若被删/失效，onError 回退成 🐳 文字，不留破图。
  const PICKER_ICON_ID = '20261030T123213-ded7c9'   // 鲸鱼娘比心（fav 组，413×413）

  // 脸部特写靠 CSS 放大裁切实现，不生成新素材、不动打包白名单：
  // 把原图按 ICON_ZOOM 倍渲染，再用 24×24 的窗口只框住脸部。
  // 原图 413×413：取景框 ≈ (122,86)-(294,258)——呆毛/头饰/双眼/张嘴全进框，
  // 比心的手与围裙裁掉（用户 2026-11-05 要求「只取脸部，不露出身体」）。
  const ICON_BOX = 24
  const ICON_ZOOM = 2.4
  const ICON_FACE = { x: 0.501, y: 0.42 }

  const MemePickerButton = () => {
    const [iconBroken, setIconBroken] = useState(false)
    const [open, setOpen] = useState(false)
    const wrapRef = useRef(null)
    // 点外面收起（用户 UI 偏好⑧）：监听在按钮包装层之外（同样防无 DOM 环境）
    useEffect(() => {
      if (!open) return undefined
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
      const onDown = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
      }
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }, [open])
    const big = ICON_BOX * ICON_ZOOM
    const offset = (c) => Math.round(ICON_BOX / 2 - c * big)
    return h('span', { ref: wrapRef, style: { position: 'relative', display: 'inline-flex', flex: '0 0 auto' } },
      h('button', {
        type: 'button',
        title: '表情斗图',
        'aria-label': '表情斗图',
        onClick: () => setOpen((v) => !v),
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, padding: 0, flex: '0 0 auto',
          border: `1px solid ${C.border}`, borderRadius: 8,
          background: open ? C.accentSoft : C.surface, color: 'inherit',
          fontSize: 15, lineHeight: 1, cursor: 'pointer', opacity: 0.9,
        },
      }, iconBroken
        ? '🐳'
        : h('span', {
          // 裁切窗口：overflow hidden 把放大后的图只留脸部那一格
          style: {
            position: 'relative', display: 'block',
            width: ICON_BOX, height: ICON_BOX, overflow: 'hidden',
            borderRadius: 8, flex: '0 0 auto',
          },
        }, h('img', {
          src: `${API}/image/${encodeURIComponent(PICKER_ICON_ID)}`,
          alt: '',
          draggable: false,
          style: {
            position: 'absolute', display: 'block',
            width: big, height: big, objectFit: 'cover',
            left: offset(ICON_FACE.x), top: offset(ICON_FACE.y),
          },
          onError: () => setIconBroken(true),
        }))),
      open ? h(MemeGallery, { onClose: () => setOpen(false) }) : null,
    )
  }

  // ------------------------------------------------------------ 候选窗（分页）
  // 用户 2026-11-05 定：4×4 一页；第一页=常用（最近使用的 12 张），
  // 第二页=大肥鱼（只读包组），第三页起=其余自定义组依次排。
  // 点图 = 预览（放大 + 名字 + 组 + 情绪）；预览里「发送」才落到会话（下一轮接发送）。
  const PAGE_COLS = 4
  const PAGE_ROWS = 4
  const PAGE_SIZE = PAGE_COLS * PAGE_ROWS

  // 找到常驻 composer 的可编辑区：宿主是 Lexical 绑定的 contenteditable，
  // 全页可能不止一个（Univer 表格等也有），composer 永远在最下方，取可见
  // 且底边最低的那个。找不到返回 null，调用方走剪贴板兜底。
  function findComposerEditor() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return null
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 40 && r.height > 8
    })
    if (cands.length === 0) return null
    cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)
    return cands[0]
  }

  // 把 Markdown 图片行插进 composer：聚焦 → 光标挪到末尾 → execCommand。
  // execCommand('insertText') 会走 beforeinput，Lexical 认这条正规通道
  // （语音输入插件同款做法），直接改 DOM 反而会被编辑器状态覆盖。
  function insertIntoComposer(text) {
    const el = findComposerEditor()
    if (!el || typeof document === 'undefined' || !document.execCommand) return false
    el.focus()
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false) // 末尾
      if (sel) { sel.removeAllRanges(); sel.addRange(range) }
    } catch { /* 选区设不上也试着插 */ }
    try { return document.execCommand('insertText', false, text) } catch { return false }
  }

  // 把图片塞进 composer 的附件轨：向输入框派发合成 drop 事件。
  // 宿主的 drop 处理链（addFiles → createDrafts → draftAttachments）就是
  // 用户拖图的官方通道，会话上下文由 DOM 携带——绕开 input.right 槽 props={}
  // 拿不到 sessionId 的限制。DataTransfer/DragEvent 在 Chromium 可构造。
  function dropFilesIntoComposer(files) {
    if (typeof window === 'undefined' || typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return false
    const el = findComposerEditor()
    if (!el) return false
    try {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(f)
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dt, bubbles: true, cancelable: true,
        clientX: r.left + 8, clientY: r.top + 4,
      }))
      return true
    } catch { return false }
  }

  // 强制缩小（用户最初需求）：静态图在浏览器端 Canvas 压到 ≤360px 的 WebP，
  // 直接砍掉进上下文的视觉 token；GIF 原样传（Canvas 重编码会丢动画，
  // 大肥鱼包全是动图，宁可不缩也不变静态）。
  const STICKER_MAX_EDGE = 360
  async function buildStickerFile(it) {
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined' || typeof File === 'undefined') {
      throw new Error('环境不支持图片处理')
    }
    const r = await fetch(it.url)
    if (!r.ok || typeof r.blob !== 'function') throw new Error(`取图失败 ${r.status}`)
    const blob = await r.blob()
    const isGif = blob.type === 'image/gif' || /\.gif$/i.test(it.url)
    if (isGif) return new File([blob], `${it.displayName || it.id}.gif`, { type: 'image/gif' })
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(bmp.width, bmp.height))
    if (scale >= 1 && blob.size <= 300 * 1024) {
      // 已经够小，原样传，避免无谓重编码
      return new File([blob], `${it.displayName || it.id}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: blob.type })
    }
    const w = Math.max(1, Math.round(bmp.width * scale))
    const hh = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = hh
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, hh)
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
    if (!out) throw new Error('webp 编码失败')
    return new File([out], `${it.displayName || it.id}.webp`, { type: 'image/webp' })
  }

  // 候选窗点击模式：**唯一数据源=config.json 的 pickerMode**（设置页「真斗图」开关，
  // 用户 2026-11-05 要求放设置页并联动）。曾做过候选窗底部 localStorage 开关，
  // 两处都能改=双数据源假联动，已删——这里每次开面板/点图前读一次 /config。

  async function fetchPickerMode() {
    try {
      const r = await fetch(`${API}/config`)
      const j = await r.json()
      return j?.config?.pickerMode === 'text' ? 'text' : 'image'
    } catch { return 'image' }  // 读不到按默认（图片）走，onPick 里还有逐级兜底
  }

  const MemeGallery = ({ onClose }) => {
    const [st, setSt] = useState(null)
    const [tabKey, setTabKey] = useState('')   // '' = 未定，数据到了自动选第一个
    const [pageIdx, setPageIdx] = useState(0)  // 当前标签内的页码
    const [hover, setHover] = useState(null)   // { it, x, y }：悬停气泡预览
    const [tip, setTip] = useState('')
    const [mode, setMode] = useState('image')  // 打开面板时从 /config 同步（设置页「真斗图」）

    const load = useCallback(async () => {
      try {
        const r = await fetch(`${API}/state?tab=library`)
        const j = await r.json()
        if (j && j.ok) setSt(j)
      } catch { /* 拉不到就显示空页 */ }
      setMode(await fetchPickerMode())
    }, [])
    useEffect(() => { void load() }, [load])

    // Esc 收起（用户 UI 偏好⑧）。宿主可能在无 DOM 环境（测试/SSR）里加载本文件，
    // 所以 window/document 的监听都要先判断存在，缺了只是少个快捷键，不能抛错。
    useEffect(() => {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
      const onKey = (e) => { if (e.key === 'Escape') onClose() }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    // 标签序列：常用（有记录才出现）→ 各分组（包组在前、自定义组在后；
    // 「未分组」虚拟组不进）。每个标签带自己的分页数组，‹ › 只在标签内翻页
    // （用户 2026-11-05：26 页连翻太深，要按钮快速切换常用/大肥鱼/自定义组）。
    const tabs = useMemo(() => {
      if (!st) return []
      const out = []
      const recents = Array.isArray(st.recents) ? st.recents : []
      if (recents.length > 0) out.push({ key: '@recent', name: '常用', pages: [recents.slice(0, PAGE_SIZE)], count: recents.length })
      for (const g of (st.groups || [])) {
        if (g.virtual) continue
        const items = (st.items || []).filter((it) => it.group === g.id && it.enabled !== false && it.exists)
        const pages = []
        for (let i = 0; i < items.length; i += PAGE_SIZE) pages.push(items.slice(i, i + PAGE_SIZE))
        if (pages.length > 0) out.push({ key: g.id, name: g.name, pages, count: items.length, readonly: g.readonly === true })
      }
      return out
    }, [st])

    // 标签失效（常用清空/组删了）→ 回落第一个；首帧自动选第一个
    const active = tabs.find((t) => t.key === tabKey) || tabs[0]
    useEffect(() => {
      if (active && active.key !== tabKey) { setTabKey(active.key); setPageIdx(0) }
    }, [active, tabKey])
    const page = active ? active.pages[Math.min(pageIdx, active.pages.length - 1)] : null

    const switchTab = (t) => { if (t.key !== tabKey) { setTabKey(t.key); setPageIdx(0); setHover(null) } }

    // 点击格子 = 直接发送（用户 2026-11-05：「选中表情包后 不需要底下的预览 点击直接发送」）。
    // 模式由设置页「真斗图」开关决定（config.pickerMode，每次点击实时读，保存即生效）：
    //   开=图片模式：缩小后走 drop 附件通道进 composer 附件轨，双方都看得到图；
    //   关=文字模式：插 Markdown 行（省 token），用户气泡显原始文本但 AI 能渲染读取。
    // 记常用两种模式都做。附件失败→文本兜底→剪贴板兜底，每级都明说。
    const onPick = async (it) => {
      const md = `![${it.displayName}](${it.url})`
      const useImage = (await fetchPickerMode()) === 'image'
      setMode(useImage)
      try {
        await fetch(`${API}/recent`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: it.id }),
        })
        void load() // 常用页立刻刷新
      } catch { /* 记不上不影响发送 */ }
      if (useImage) {
        try {
          const file = await buildStickerFile(it)
          if (dropFilesIntoComposer([file])) {
            setTip(`已放入输入框：${it.displayName}（${Math.round(file.size / 1024)}KB），回车发送`)
            return
          }
          throw new Error('输入框不接受拖图')
        } catch (e) {
          // 附件路失败：退文本路，明说原因
          if (insertIntoComposer(md)) { setTip(`图片模式失败（${e.message}），已按文本插入：${it.displayName}`); return }
          setTip(`图片与文本都没送进去：${e.message}`)
          return
        }
      }
      if (insertIntoComposer(md)) {
        setTip(`已按文本插入：${it.displayName}，回车发送`)
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(md); setTip(`没找到输入框，已复制：${it.displayName}，粘贴后回车`) }
        catch { setTip(`没找到输入框且复制失败：${it.displayName}`) }
      } else {
        setTip(`没找到输入框：${it.displayName}`)
      }
    }

    // 悬停气泡：容器级 mouseover/mouseleave 统一管（移出候选窗一定清掉）
    const onGridMove = (e) => {
      const cell = e.target?.closest?.('[data-meme-id]')
      if (!cell) { if (hover) setHover(null); return }
      const id = cell.getAttribute('data-meme-id')
      const it = (page || []).find((x) => x.id === id)
      if (!it) return
      const r = cell.getBoundingClientRect()
      const host = e.currentTarget?.getBoundingClientRect?.()
      if (!hover || hover.it.id !== id || hover.x !== Math.round(r.left) || hover.y !== Math.round(r.top)) {
        setHover({ it, x: host ? r.left - host.left + r.width / 2 : r.left, y: host ? r.top - host.top : r.top })
      }
    }

    return h('div', {
      style: {
        position: 'absolute', right: 8, bottom: 44, zIndex: 9000,
        width: 4 * 64 + 5 * 6 + 20, boxSizing: 'border-box',
        background: C.raised, color: 'inherit', colorScheme: detectScheme(),
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)', padding: 10,
      },
    },
      // 标签条：常用 | 大肥鱼 | 我的收藏 | …（点一下整组切换）
      h('div', {
        style: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' },
      },
        tabs.map((t) => h('button', {
          key: t.key, type: 'button', onClick: () => switchTab(t),
          title: `${t.name}（${t.count} 张）`,
          style: galTabBtn(C, !!active && t.key === active.key),
        }, t.name)),
        h('span', { style: { flex: '1 1 auto' } }),
        active && active.pages.length > 1 ? h('span', { style: { fontSize: 11, color: C.mute, marginRight: 2 } },
          `${Math.min(pageIdx + 1, active.pages.length)}/${active.pages.length}`) : null,
        h('button', { type: 'button', disabled: !active || pageIdx <= 0, onClick: () => setPageIdx((i) => Math.max(0, i - 1)), style: galBtn(C), title: '上一页' }, '‹'),
        h('button', { type: 'button', disabled: !active || pageIdx >= active.pages.length - 1, onClick: () => setPageIdx((i) => Math.min(active.pages.length - 1, i + 1)), style: galBtn(C), title: '下一页' }, '›'),
        h('button', { type: 'button', onClick: onClose, style: galBtn(C), title: '关闭（Esc）' }, '×'),
      ),
      // 4×4 网格（悬停出气泡放大，点击=直接插入 composer）
      h('div', {
        onMouseMove: onGridMove,
        onMouseLeave: () => setHover(null),
        style: { position: 'relative' },
      },
        page ? h('div', {
          style: { display: 'grid', gridTemplateColumns: `repeat(${PAGE_COLS}, 64px)`, gap: 6 },
        }, page.map((it) => h('button', {
          key: it.id, type: 'button', 'data-meme-id': it.id, title: it.displayName,
          onClick: () => onPick(it),
          style: {
            width: 64, height: 64, padding: 2, border: `1px solid ${C.border}`,
            borderRadius: 8, background: C.bg, cursor: 'pointer', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        }, h('img', {
          src: it.url, alt: it.displayName, loading: 'lazy', draggable: false,
          style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' },
          onError: (e) => { e.target.style.opacity = 0.25 },
        })))) : h('div', { style: { fontSize: 12, color: C.mute, padding: '12px 0', textAlign: 'center' } },
          st ? '这个组没有可用的图' : '加载中…'),
        // 悬停气泡：盖在网格上方（zIndex 高于格子），跟随当前格
        hover ? h('div', {
          style: {
            position: 'absolute', left: hover.x, top: hover.y - 8, transform: 'translate(-50%, -100%)',
            zIndex: 10, pointerEvents: 'none', padding: 6, borderRadius: 10,
            background: C.raised, border: `1px solid ${C.border}`,
            boxShadow: '0 6px 20px rgba(0,0,0,0.3)', maxWidth: 220, textAlign: 'center',
          },
        },
          h('img', {
            src: hover.it.url, alt: hover.it.displayName, draggable: false,
            style: { display: 'block', maxWidth: 160, maxHeight: 160, objectFit: 'contain' },
          }),
          h('div', { style: { fontSize: 11, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 208 } },
            `${hover.it.displayName}｜${hover.it.emotion || '未标情绪'}`),
        ) : null,
      ),
      // 模式只读指示（切换在设置页「真斗图」；此处不放按钮，避免双数据源）
      h('div', {
        style: { marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.mute },
      }, mode === 'text'
        ? '文字模式（省 token）· 改此行为：设置 → 斗图 → 真斗图'
        : '图片模式（已缩小）· 改此行为：设置 → 斗图 → 真斗图'),
      tip ? h('div', { style: { marginTop: 6, fontSize: 11, color: C.mute } }, tip) : null,
    )
  }

  function galTabBtn(C, on) {
    return {
      height: 20, padding: '0 8px', fontSize: 11, lineHeight: 1, cursor: 'pointer',
      borderRadius: 6, color: 'inherit',
      border: `1px solid ${on ? C.accent : C.border}`,
      background: on ? C.accentSoft : C.surface,
      fontWeight: on ? 600 : 400,
    }
  }

  function galBtn(C) {
    return {
      width: 24, height: 24, padding: 0, border: `1px solid ${C.border}`,
      borderRadius: 6, background: C.surface, color: 'inherit',
      fontSize: 14, lineHeight: 1, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }
  }

  module.exports.name = 'nekowhale-meme-client'
  module.exports.inject = ['slots']
  module.exports.apply = function apply(ctx) {
    try {
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
        { name: 'plugins.bundle.config', key: PKG },
        App,
      ))
    } catch (e) {
      try { console.warn('[nekowhale-meme] plugin page disabled:', e) } catch {}
    }
    try {
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
        { name: 'conversation.input.right', id: 'nekowhale-meme.picker', order: 10, label: '表情斗图' },
        MemePickerButton,
      ))
    } catch (e) {
      try { console.warn('[nekowhale-meme] composer button disabled:', e) } catch {}
    }
  }
  return module.exports
} })
