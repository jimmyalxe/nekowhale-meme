# nekowhale-meme

> 大肥鱼表情库 —— 自包含的 DSH 表情库插件

把散落的表情图收进一个**可检索、可分组、可被 AI 调用**的本地库。

**完全不依赖任何其他插件。** 初始表情包直接连公开站点 [kiriyuki.com](https://kiriyuki.com)
（清单 `/api/manifest`、图 `/media/gif`、作者标注 `/meme/kit/nekowhale.json`），
不需要装 `dsh-nekowhale-stickers`([https://kiriyuki.com](https://github.com/Loping151/dsh-nekowhale-stickers))，也不需要它提供任何服务。

---

## 功能

- **收集**：页面上传 / 文件夹导入 / `meme_import` 工具，都只进队列，不自动识别
- **识别打标签**：串行、可中止，25 个中文情绪单选 + 自由标签；识别模型在队列页选，选定后固定不跟随全局默认
- **分组管理**：多分组、只读组（角色包）、移图、重命名、删除
- **AI 检索发图**：`meme_search` / `meme_send` 工具，只搜「AI 可用组」里已入库且启用的图
- **应景斗图**：回合结束后按情绪词匹配，命中自动发图；也可切「模型判断」（费 token，默认关）
- **一键下载初始表情包**：从 kiriyuki.com 直连，可自选包，自动套用作者的人工标注

## 页面

**默认进入队列页（全宽）**，右上角 ⚙ 整页跳转到设置页，设置页左上角 ← 返回。

### 队列页（三 Tab 三等分）

| Tab | 能做什么 |
|---|---|
| **待识别** | 全选 / 识别勾选 / 删除勾选；识别模型下拉（红字「识别需要消耗 token」）；识别进度条 + 中止；失败项红字显示原因 |
| **已标识·待确认** | 确认入库（可选目标组）/ 重新识别 / 删除勾选；每项「情绪｜描述｜关键词」+ 编辑面板 |
| **已入库·可用** | 分组选择器 + `管理分组`（新建/重命名/删除都在这里）；移出到待确认 / 改分组 / 删除勾选 |

> **三个状态的图都能编辑**（显示名 / 情绪 / 标签 / 适用场景 / 描述）：待识别可先填标注，
> 待确认正好用来核对模型输出，库内日常修正。**唯一例外是只读组**（从站点下载的角色包），组里的图不可编辑。

### 设置页

- **基础**
  - 数据目录（可改，不写死 C 盘）
    - **路径只能通过「选择…」挑选，输入框只读**（不允许手打，避免绕过校验与迁移逻辑）
    - 「选择…」**优先调系统原生目录选择框**（Electron dialog / Windows FolderBrowserDialog / Linux zenity），
      远程访问时自动回退到内置目录浏览器
    - 换目录时**把图库与索引整体搬迁**到新目录（剪切，旧目录随即清空），不占双份磁盘
    - 新目录已有同名文件时**跳过不覆盖**；有文件搬失败则中止切换并保留原目录，不会出现半截数据
    - 换到新目录会**记住**：旧目录留指针，重启后沿链跟随
  - **下载初始表情包**：从 kiriyuki.com 直连，带进度条与包维度进度
  - **包选择器**：下拉多选，带搜索 / 全选 / 清空 / 每包张数与体积 / 「已下 N 张」标记
    - 已选合计超过 **500MB** 显示红色提示
    - **每个包建成一个独立只读组**（组名＝包名），组里的图只能看不能改
    - **双人包不支持**（本项目不处理双人方向），会从选择器剔除且接口拒绝下载
- **斗图**：应景自动发开关、适用渠道（Web / QQ·微信）、频率步进器（每 10 轮最多 1–10 张）、
  触发方式（情绪词匹配 / 模型判断——**只有后者会出红色警告**，因为它每轮都额外消耗 token）
- **AI 可用组**：下拉多选（带张数、搜索、全选、清空）。没勾的组 AI 完全看不到；新建组默认不勾

### 保存规则

**保存按钮是唯一的写入途径。** 队列页与设置页顶部栏结构完全一致：

```
nekowhale-meme        ● 未保存  [放弃]  [保存]  [⚙]     ← 队列页
设置                  ● 未保存  [放弃]  [保存]  [←]     ← 设置页
```

- 改任何设置后出现「● 未保存」，`放弃`/`保存` 才可点
- **不点保存就离开**（返回队列页、关掉插件页）一律视为放弃，磁盘不会有任何写入
- 从系统选择框选目录**只填进输入框**，同样要点保存才生效
- 悬停/切换皮肤时配色自动适配（所有表面色用系统底色混出不透明实色，不叠在皮肤背景上）

## 安装

```bash
dsh plugin --profile desktop add github:jimmyalxe/nekowhale-meme
```

装完**刷新插件页**即可（工具/接口在插件装载后即生效）。
**换版本必须先 remove 再 add，不能覆盖安装**：

```bash
dsh plugin --profile desktop remove nekowhale-meme
dsh plugin --profile desktop add github:jimmyalxe/nekowhale-meme
```

### 本地开发

开发目录用 `link:` 装，改完代码热重载即可，不用碰 GitHub：

```bash
dsh plugin --profile desktop add "link:<开发目录绝对路径>"
```

两个前提：
1. 开发目录里要能解析 peer 依赖 `@deepseek-ai/schemastery`，否则宿主加载失败会**静默留在旧版本**。
   本机做法是把 profile 的依赖链进来：
   `New-Item -ItemType Junction -Path node_modules\@deepseek-ai -Target <profile>\node_modules\@deepseek-ai`
2. **CLI 的 add/remove 只改依赖，不触发宿主重载**。要让新代码真正生效，走插件管理器接口：
   `POST /api/plugin-manager/remove {"id":"nekowhale-meme"}` → `POST /api/plugin-manager/install {"spec":"link:..."}`
   → 轮询 `GET /api/plugin-manager/status?job=<jobId>` 到 `phase=done`。

## 数据目录

默认 **`$DSH_HOME/nekowhale-meme`**（与其他 DSH 插件的约定一致，不会写死某个盘符）。
设置页里可以改成任意位置（包括别的盘）。

换目录时会**把图库与索引整体搬迁**到新目录（剪切，旧目录随即清空），不占双份磁盘；
新目录已有同名文件时跳过不覆盖；有文件搬失败则中止切换并保留原目录，不会出现半截数据。

```
<dataDir>
├── config.json                配置（数据目录、识别模型、斗图、AI 可用组）
├── index.json                 索引：分组 + 条目（写前留 index.json.bak）
├── health.json                失效清单（只增不减，点「知道了」整体清空）
├── inbox/                     上传/下载中转（不参与索引）
├── pending/                   待识别队列
│   └── 20261029T014312-a3f9c1.jpg
└── library/
    ├── 大肥鱼/                从 kiriyuki 下载的只读组（保留原名）
    └── 我的收藏/              默认自定义组
```

## 命名与去重

| 阶段 | 文件名 |
|---|---|
| 进队列 | `<YYYYMMDDTHHMMSS>-<6位哈希>.<ext>` |
| 入库后 | `<组id>-<时间戳>-<6位哈希>.<ext>` |
| 从站点下载 | **保留原名**（只读组，不参与重命名规则） |

**磁盘文件名永不重命名**；用户改名只改索引里的 `displayName`
（界面主标题＝显示名，副标题＝原文件名 + 日期）。
进队列时算 SHA-1，库里已有就跳过并提示「这张已经在库里（组 X 下）」。

## 情绪与标签

沿用 25 个中文情绪（**与作者标注表完全一致，含顺序**），单选：

```
开心 大笑 喜欢 害羞 得意 兴奋 惊讶 疑惑 思考 无语 难过 哭
生气 害怕 疲惫 赞同 拒绝 打招呼 感谢 道歉 卖萌 搞怪 嘲讽 安慰 其他
```

**标签从两个渠道来：**

1. **作者的标注表**（下载时自动套用）
   站点公开的 `/meme/kit/nekowhale.json` 有 322 条人工标注。站点是**模板化**的
   （同一 stem 在不同包里是同一动作换角色重渲染），所以按 stem 匹配后
   可选包命中率约 **97%**。`desc` 含角色名，只有「大肥鱼」包保留。
2. **AI 识别**（要花 token）：套不上标注的走队列识别。
   输出尺度对齐作者标注实测分布：`tags` 4–7 个、`use` 10–20 字、`desc` 40–70 字。

## 状态机

```
pending ──识别成功──▶ tagged ──确认入库──▶ library
   ▲                    │                    │
   └──识别失败──────────┘                    │
                        └──移出──────────────┘
任意状态 ──勾选删除──▶ 移除（二次确认）
```

**AI 只检索 `library` 中 `enabled:true` 的条目**；pending / tagged 一律不参与。

## 识别

- **串行**逐张，绝不并发；点中止后当前这张跑完就停，其余保持待识别
- 模型：队列页所选；首次自动取「DSH 原生默认 + 支持视觉」的模型并**固定**，
  之后改全局默认**不跟随**；所选模型消失则回落，仍无则提示手动选
- 失败退回待识别并记原因，可重试
- >8MB、空文件、非图片后缀在进队列时就被拒（给出具体原因）

## 斗图

回合结束后按情绪词表匹配，命中就从「AI 可用组」里随机挑一张该情绪的图。
频率限制＝每 10 轮最多 N 张。发送前验证文件存在；失效则删索引 + 记清单 + 换下一张，
最多验证 3 张，**全程静默**；3 张都失效才报错。

## 工具（模型侧）

| 工具 | 作用 |
|---|---|
| `meme_import` | 收进待识别队列。可给 `path` / `url`；**都留空 = 取本会话最近一张聊天附件** |
| `meme_search` | 搜已入库图，返回标签与图片地址（绝对 URL，聊天界面可直接显示） |
| `meme_send` | 发图（含失效兜底：坏了就换下一张，最多 3 张） |
| `meme_list` | 列队列或库 |

> **识别不提供给模型（没有 `meme_tag`）。** 图片只能进「待识别」区，
> 必须由你**在插件页当面点「识别勾选」**才会调用模型打标签——识别消耗 token，
> 这个决定权不交给模型。
>
> 收图格式**按文件头判**，不看扩展名——聊天附件是内容寻址的（`attachments/v1/objects/<sha256>`，没有后缀），
> 所以留空取附件能直接用；同时改了后缀的假图片也会被挡住。

## HTTP 路由

```
GET  /nekowhale-meme/state?tab=&group=
GET  /nekowhale-meme/status?scan=1        全量自检：删失效索引 + 记清单
GET  /nekowhale-meme/image/<id>            图片直出（Markdown 用它显示）
GET  /nekowhale-meme/models                可选模型 + 是否支持图片
GET  /nekowhale-meme/config   | POST /config
GET  /nekowhale-meme/packs                 包清单：包名/张数/体积/已下几张（已剔除双人包）
POST /nekowhale-meme/import                base64 上传
POST /nekowhale-meme/import-folder
POST /nekowhale-meme/import-nekowhale      body 可给 packs 数组；每包一个只读组
GET  /nekowhale-meme/import-progress       下载进度轮询
POST /nekowhale-meme/tag   | POST /cancel
POST /nekowhale-meme/confirm | /revert | /revert-to-pending
POST /nekowhale-meme/delete                需 confirm:true
POST /nekowhale-meme/update                改显示名/情绪/标签
POST /nekowhale-meme/group                 create / rename / delete / move
GET  /nekowhale-meme/popup                 斗图气泡（8 秒内有效）
POST /nekowhale-meme/health/clear          需 confirm:true，整份清空
```


## 👥 角色

<table>
<tr>
<td width="140" align="center"><img src="https://kiriyuki.com/meme/kit/nekowhale/id-photo-blue.png" width="120" alt="大肥鱼"></td>
<td><b>大肥鱼形象</b>基于 <a href="https://space.bilibili.com/4168597">ZipZipPipe</a> 与 <a href="https://space.bilibili.com/4456176">上善无形</a> 提供的形象；<b>GPT娘形象</b>基于 <a href="https://space.bilibili.com/4168597">ZipZipPipe</a>。<br>
<b>大肥鱼</b>：拟人化的 DeepSeek 鲸鱼娘。深蓝长发、呆毛、女仆头饰。<br>
<b>GPT娘</b>：拟人化的 ChatGPT，双人套组里的白色角色，白发龙娘，有龙角和 OpenAI 发饰。<br>
<sub>双人表情的 <code>dir</code> 字段记录方向，例如 <code>大肥鱼→GPT娘</code>。<b>本插件不支持双人包</b>，因此不涉及方向字段。</sub></td>
</tr>
</table>

## 素材与致谢

表情包作者：B站 [可以叫我云大人 / 雾雪](https://space.bilibili.com/103739) · [kiriyuki.com](https://kiriyuki.com) 制作 · 欢迎约原稿同款表情包！

本插件**不包含任何表情素材**，图都在使用者点「下载初始表情包」时从 kiriyuki.com 按需下载，
不作为本仓库的一部分分发。

| 数据 | 来源 | 许可 |
|---|---|---|
| 插件源代码 | 本仓库 | [Apache-2.0](./LICENSE)（见 [NOTICE](./NOTICE)） |
| 表情包的作者标注数据（emotion/tags/use/desc） | kiriyuki.com 的 `/meme/kit/nekowhale.json` | [CC BY-NC 4.0](./LICENSE-ASSETS)：可二次分发，**必须保留原作者链接与网址**，禁止付费或商用 |
| 表情 GIF、角色立绘、模板 | kiriyuki.com 运行时提供 | 归原作者所有，非商业分享须保留作者链接，禁止付费或商用 |

参考实现：[dsh-nekowhale-stickers](https://github.com/Loping151/dsh-nekowhale-stickers)——
本插件在功能设计上参考了它（队列/识别/分组的思路），并沿用它的 25 情绪词表与标注文件格式，
但**代码为本鱼（骄傲）独立编写，不复制其源码**。

## 📄 许可

代码采用 [Apache-2.0](./LICENSE)：
允许对代码进行二次修改，修改或重新发布同类功能**必须保留 [NOTICE](./NOTICE)**，即标明本仓库地址与表情包作者链接。

表情包标注数据（见 [LICENSE-ASSETS](./LICENSE-ASSETS)）采用 **CC BY-NC 4.0**：
允许对资源进行二次分发，但**必须保留原作者链接和网址**，且禁止付费提供或用于其他商业用途。

表情包基础形象和模板由 **可以叫我云大人 / 雾雪** 制作。

## 已知限制

- 识别依赖宿主提供 `attachments` 服务；拿不到就判失败并提示，不会假成功
- 斗图气泡只在 Web 渠道显示；IM 渠道需桥接插件把图作为原生图片消息发出（本插件只负责「挑哪张」）
- 大图不做降采样（>8MB 直接拒收）
- 双人包不支持
