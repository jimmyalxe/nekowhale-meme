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
    invertBg: 'color-mix(in srgb, currentColor 92%, Canvas)',
    invertFg: 'Canvas',
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
    bubble: {
      position: 'fixed', right: 20, bottom: 20, zIndex: 9999, padding: 10, borderRadius: 14,
      background: C.invertBg, color: C.invertFg, border: `1px solid ${C.border}`, boxShadow: '0 12px 32px rgba(0,0,0,.35)',
      maxWidth: 200,
    },
    bubbleImg: { width: 140, height: 'auto', borderRadius: 8, display: 'block', margin: '0 auto' },
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
    const tab = st.tab
    const items = st.items ?? []

    useEffect(() => { setIds([]); setEditing(null) }, [tab, st.group])

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
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id),
          }))),
          h('div', { style: { ...S.row, marginTop: 10 } }, h(UploadButton, { toast, reload }))),
      ) : null,

      // ---- 已标识·待确认
      tab === 'tagged' ? h('div', null,
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h(Btn, { onClick: () => setIds(ids.length === items.length ? [] : items.map((i) => i.id)) }, ids.length === items.length && items.length > 0 ? '取消全选' : '全选'),
            h('select', { style: { ...S.select, minWidth: 130, maxWidth: 160 }, value: groupPick, onChange: (e) => setGroupPick(e.target.value) },
              h('option', { value: '' }, '入库到…（默认收藏）'),
              (st.groups ?? []).filter((g) => !g.readonly).map((g) => h('option', { key: g.id, value: g.id }, g.name))),
            h(Btn, {
              kind: 'primary', disabled: ids.length === 0 || busy,
              onClick: () => act(async () => {
                const r = await apiPost('/confirm', { ids, group: groupPick || undefined })
                toast(`入库 ${r.done.length} 张${r.errors.length ? `，${r.errors.length} 张失败` : ''}`)
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
          items.length === 0 ? h('div', { style: S.empty }, '没有待确认的图。') : null,
          h('div', { style: S.list }, items.map((it) => h(TaggedItem, {
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id),
            onEdit: () => setEditing(it),
          })))),
      ) : null,

      // ---- 已入库·可用
      tab === 'library' ? h('div', null,
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 10 } },
            h('select', { style: { ...S.select, minWidth: 170 }, value: st.group ?? '', onChange: (e) => reload({ group: e.target.value }) },
              h('option', { value: '' }, `全部分组（${st.counts?.library ?? 0}）`),
              (st.groups ?? []).map((g) => h('option', { key: g.id, value: g.id }, `${g.name}（${g.count}）${g.readonly ? ' 只读' : ''}`))),
            h(Btn, { onClick: () => setShowGroups((v) => !v) }, showGroups ? '收起分组管理' : '管理分组')),
          showGroups ? h('div', { style: { borderTop: `1px solid ${C.border}`, paddingTop: 10, marginBottom: 10 } },
            (st.groups ?? []).map((g) => h('div', { key: g.id, style: { ...S.row, padding: '4px 0' } },
              h('span', { style: { flex: 1, fontSize: 13 } }, `${g.name}`),
              h('span', { style: { fontSize: 11, color: C.mute, marginRight: 8 } }, `${g.count} 张${g.readonly ? ' · 只读' : ''}`),
              g.readonly ? null : h('span', { style: S.row },
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
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h(Btn, { onClick: () => setIds(ids.length === items.length ? [] : items.map((i) => i.id)) }, ids.length === items.length && items.length > 0 ? '取消全选' : '全选'),
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
                  toast(`移动 ${r.moved.length} 张${r.failed?.length ? `，${r.failed.length} 张失败` : ''}`)
                })
                e.target.value = ''
              },
            }, h('option', { value: '' }, '改分组…'), (st.groups ?? []).filter((g) => !g.readonly).map((g) => h('option', { key: g.id, value: g.id }, g.name))),
            h(Btn, {
              kind: 'danger', disabled: ids.length === 0 || busy,
              onClick: () => { if (!window.confirm(`删除选中的 ${ids.length} 张？`)) return; act(() => apiPost('/delete', { ids, confirm: true, purgeFiles: true })) },
            }, '删除勾选'),
            h('span', { style: { marginLeft: 'auto', fontSize: 12, color: C.mute } }, `已选 ${ids.length} 张`)),
          items.length === 0 ? h('div', { style: S.empty }, '这一栏没有图。') : null,
          h('div', { style: S.list }, items.map((it) => h(LibraryItem, {
            key: it.id, it, checked: selSet.has(it.id), onToggle: () => toggleId(it.id), onEdit: () => setEditing(it),
          })))),
      ) : null,

      // ---- 编辑面板
      editing ? h(EditPanel, {
        item: editing, groups: st.groups ?? [], busy,
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

  // ---------------------------------------------------------------- 列表项
  function QueueItem({ it, checked, onToggle }) {
    const status = it.failReason ? `识别失败：${it.failReason}` : '待识别'
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: S.thumb, loading: 'lazy' }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta },
          `${it.originalName}｜${fmtBytes(it.bytes)}${it.ext === '.gif' ? '｜动图' : ''}`)),
      h('span', { style: { fontSize: 12, color: it.failReason ? C.danger : C.warn, textAlign: 'right', maxWidth: 220 } }, status))
  }

  function TaggedItem({ it, checked, onToggle, onEdit }) {
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: S.thumb, loading: 'lazy' }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta }, `${it.emotion || '未定'}｜${(it.tags ?? []).join('、') || '无标签'}`),
        it.use ? h('div', { style: { fontSize: 11, color: C.mute } }, it.use) : null),
      h(Btn, { onClick: onEdit }, '编辑'))
  }

  function LibraryItem({ it, checked, onToggle, onEdit }) {
    return h('div', { style: S.item },
      h('input', { type: 'checkbox', checked, onChange: onToggle }),
      h('img', { src: it.url, alt: it.displayName, style: S.thumb, loading: 'lazy' }),
      h('div', { style: S.itemMain },
        h('div', { style: S.itemName }, it.displayName || it.originalName),
        h('div', { style: S.itemMeta },
          `${it.originalName}｜${fmtDate(it.addedAt)}｜${it.emotion || '—'}`),
        (it.tags ?? []).length > 0 ? h('div', null, it.tags.map((t) => h('span', { key: t, style: S.chip }, t))) : null),
      it.readonly ? h('span', { style: { fontSize: 11, color: C.mute } }, '只读') : h(Btn, { onClick: onEdit }, '编辑'))
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
      const files = Array.from(e.target.files ?? [])
      if (files.length === 0) return
      setBusy(true)
      try {
        const payload = []
        for (const f of files) {
          const buf = await f.arrayBuffer()
          let bin = ''
          const bytes = new Uint8Array(buf)
          const CH = 0x8000
          for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
          payload.push({ name: f.name, dataBase64: btoa(bin) })
        }
        const r = await apiPost('/import', { files: payload })
        const okN = (r.results ?? []).filter((x) => x.id).length
        const skips = (r.results ?? []).filter((x) => x.skipped)
        toast(`上传 ${okN} 张${skips.length ? `，跳过 ${skips.length}（${skips[0].skipped}）` : ''}`)
        await reload()
      } catch (err) {
        toast(`上传失败：${err.message}`)
      } finally {
        setBusy(false)
        if (ref.current) ref.current.value = ''
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
    const a = cfg.autoSend ?? { enabled: false, channels: ['web', 'im'], limitPer10: 2, trigger: 'keywords', groups: [] }
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
            '从 kiriyuki.com 直连下载，不依赖任何其他插件')),
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
        h('div', { style: S.cardTitle }, '斗图'),
        h('div', { style: S.field },
          h('span', { style: S.label }, '应景自动发'),
          h('button', {
            type: 'button', style: S.toggle(a.enabled), onClick: () => patchCfg((c) => ({ ...c, autoSend: { ...a, enabled: !a.enabled } })),
          }, h('span', { style: S.toggleDot(a.enabled) })),
          h('span', { style: { fontSize: 11, color: C.mute } }, a.enabled ? '已开启' : '已关闭')),
        h('div', { style: S.field },
          h('span', { style: S.label }, '适用渠道'),
          ['web', 'im'].map((ch) => h('label', { key: ch, style: { ...S.row, gap: 6, fontSize: 13 } },
            h('input', {
              type: 'checkbox', checked: (a.channels ?? []).includes(ch),
              onChange: () => {
                const cur = new Set(a.channels ?? [])
                if (cur.has(ch)) cur.delete(ch); else cur.add(ch)
                patchCfg((c) => ({ ...c, autoSend: { ...a, channels: [...cur] } }))
              },
            }),
            ch === 'web' ? 'Web 聊天' : 'QQ / 微信'))),
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
            '情绪词匹配',
            h('span', { style: { fontSize: 11, color: C.mute } }, '插件内置词表，零 token')),
          h('label', { style: { ...S.row, gap: 6, fontSize: 13, marginLeft: 16 } },
            h('input', {
              type: 'radio', checked: a.trigger === 'model', onChange: () => patchCfg((c) => ({ ...c, autoSend: { ...a, trigger: 'model' } })),
            }),
            '模型判断',
            h('span', { style: { fontSize: 11, color: C.mute } }, '费 token'))),
        a.trigger === 'model' ? h('div', { style: S.warnBox },
          h('div', { style: { fontWeight: 700, marginBottom: 4 } }, '⚠ 模型判断模式'),
          h('div', null, '每轮额外调用模型判断情绪，持续消耗 token 与额度。')) : null),
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
    const [popup, setPopup] = useState(null)
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

    // 斗图气泡（Web 渠道）
    useEffect(() => {
      const t = window.setInterval(async () => {
        try {
          const d = await apiGet('/popup')
          if (d?.popup) setPopup(d.popup)
        } catch { /* 忽略 */ }
      }, 3000)
      return () => window.clearInterval(t)
    }, [])

    useEffect(() => {
      if (!popup) return
      const t = window.setTimeout(() => setPopup(null), 8000)
      return () => window.clearTimeout(t)
    }, [popup])

    const reload = useCallback(async (next) => { await load(next) }, [load])

    const full = props?.view === 'page'
    const style = full ? S.pageFull : S.page

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

    return h('div', { style },
      err ? h('div', { style: S.warnBox }, err) : null,
      body,
      toastMsg ? h('div', {
        style: { position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 10000, background: C.invertBg, color: C.invertFg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 14px', fontSize: 12 },
      }, toastMsg) : null,
      popup ? h('div', { style: S.bubble, onClick: () => setPopup(null) },
        h('img', { src: popup.url, alt: popup.name, style: S.bubbleImg }),
        h('div', { style: { fontSize: 11, color: C.mute, textAlign: 'center', marginTop: 6 } }, popup.name || '')) : null,
    )
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
  }
  return module.exports
} })
