# Renderer 折叠/展开重设计

> 把现有的 `plugin.pasty.awesome.decode.preview` renderer 改成"折叠态单行 + 展开态代码区"风格：折叠时一行 chip + 预览 + inline 图标，点击或按下宿主 native 按钮展开下方代码块；按钮责任完全交给宿主，webview 只画 inline 图标。

## 1. 背景与目标

当前 renderer 直接铺开 decoded 内容，未折叠时也占用大量纵向空间，且 JWT 的 Header / Payload 拆段渲染和其它编码不统一。新设计目标：

1. 折叠态最小占位（约 50px），方便列表里多个 attachment 同屏扫读
2. 展开态把代码区独立成下方滑出的可滚动 pre，带 JSON 语法高亮
3. webview 不再绘制底部 action 按钮，全部交宿主 native 按钮
4. 不可用的按钮 runtime 直接不返回（而不是返回 `isEnabled: false`）
5. JWT 不再用特例两段渲染，统一为含 signature 的 pretty JSON

非目标：

- 不调整 detector 的检测策略、优先级链
- 不引入用户配置面板
- 不引入 prism / highlight.js 等第三方高亮库

## 2. 范围

只动三件事：
- `src/runtime/shared/decoders.js` + `src/runtime/shared/decodePayload.js`：扩 JWT signature
- `src/runtime/renderers/decodeRenderer.js`：按钮协议变更 + 文案
- `src/ui/AttachmentDecodeApp.vue`：UI 全部重写；新增 `src/ui/shared/jsonHighlight.js`

manifest、detector、composable、构建脚本、测试骨架不动。

## 3. 数据结构变更

### 3.1 JWT signature

`shared/decoders.js` 的 JWT 分支：

- 除原有 header / payload 之外，把 JWT 第三段（base64url 签名段）的**原文字符串**保留为 `signature`
- 不做签名字节解码（签名是任意字节序列，不能强转 UTF-8）

`shared/decodePayload.js`：

```js
// createDecodePayload 中 jwt 分支
jwt: {
  header: detectionResult.jwt.header,
  payload: detectionResult.jwt.payload,
  signature: String(detectionResult.jwt.signature ?? "")
}
// decoded 改为
decoded: JSON.stringify(
  { header, payload, signature },
  null,
  2
)
```

`decodedIsJSON` 仍恒 `true`。

`decodeDecodePayload` 读取时：`parsed.jwt.signature` 缺失 → 兜底空串，保持向前兼容（旧 attachment 不会因此报错）。

### 3.2 Search projection 不变

`buildSearchProjection` 用的是 `payload.decoded`，新结构下 search text 自动包含 signature——可接受，签名段是合法搜索目标。

## 4. Renderer 协议变更

`resolveAttachment` 的 `buttons` 数组规则：

| 情形 | buttons |
|---|---|
| payload 非法 | `[]` |
| 普通编码（base64 / url / decodedIsJSON=false 的 escaped_json） | `[copy, toggle-expand]` |
| JSON 类（`decodedIsJSON === true` 或 `encoding === "jwt"`） | `[copy, copy-json, toggle-expand]` |

每个 button object 形态（不再带 `isEnabled` 字段）：

```js
{ id: "copy-decoded",  title: "Copy" }
{ id: "copy-json",     title: "Copy as JSON" }
{ id: "toggle-expand", title: payload.expanded ? "Show Less" : "Show More" }
```

`invokeOperation` 行为不变（path: copy-decoded / copy-json / toggle-expand 三分支沿用）。删除"payload 非法时仍走 copy-decoded 兜底"的逻辑——既然此时不返回任何按钮，invokeOperation 不会被调到。

`displayName` 维持 `"Decoded Preview · ${label}"` 不动。`tintHex: null` 不动（让宿主用主题 accent）。

## 5. UI 重设计

### 5.1 视觉容器

webview 内部画**一个固定深色 panel**（独立于宿主主题），作为 chip + 预览 + 展开代码区的统一容器。外层"检测到的内容 N"那一层 chrome 是宿主提供的，webview 不重复。

固定深色（不响应 `--pasty-*` token）：约 `oklch(0.18 0.02 250)` 中性偏冷深灰，圆角 8px。

panel 外（webview 边界到 panel 边界）背景透明，吃透宿主主题。

### 5.2 折叠态

panel 内单行 row：

```
[chip]  [一行预览文本，flex:1，overflow:ellipsis]  [copy icon]  [chevron]
```

- 行高 36px；panel 总高约 50px（含 8px × 2 padding）
- chip：见 5.5
- 预览文本：把 `payload.decoded` 的所有 `\s+` 压成单空格，单行 ellipsis 截断；等宽字体；色用固定浅灰 `oklch(0.78 0.02 250)`
- copy icon：12-14px 复制图标按钮，hover 时 panel 内浅 overlay
- chevron：向下箭头（展开时向上），同尺寸、同 hover 行为
- 整行除 copy icon 区域外的空白都是点击展开热区；copy icon 自己有点击行为，`stopPropagation`

### 5.3 展开态

在折叠态 row 下方滑出一个 `<pre>` 区块：

- 折叠态 row 仍保留（不消失），整行仍可点击折叠
- pre 区：固定深色背景（同 panel），内部 padding 12px
- pre 内 max-height ≈ 360px，内部 `overflow: auto` 可滚
- 内容是 `payload.decoded` 经 5.4 的高亮 tokenizer 渲染（仅当 `decodedIsJSON === true || encoding === "jwt"`；否则纯白文本）
- 字体：等宽，12px，line-height 1.45

webview 最外层挂 `pasty.window.autoFit({ min: 60, max: 480, target: panel })`，让整张卡片高度跟着 panel 尺寸长/缩。manifest 的 `height: { min: 60, max: 480 }` 已经覆盖，不变。

### 5.4 JSON 语法高亮

新建 `src/ui/shared/jsonHighlight.js`，导出一个函数：

```js
export function highlightJson(text: string): string  // returns HTML
```

实现要点：

- 单文件，约 40-60 行
- 不引第三方依赖
- 把 JSON 文本扫一遍，切成 token 流：`key` / `string` / `number` / `bool` / `null` / `punct` / `whitespace`
- 每个 token 包成 `<span class="jh-${type}">...</span>`
- HTML 转义 `<` / `>` / `&` / `"`
- 如果输入不是合法 JSON（理论不该发生，因为调用前已 `decodedIsJSON || encoding === jwt` 门控），降级为纯文本输出（也做 HTML 转义）

CSS class 配色（双套，浅/深 scheme 切换；用 `@media (prefers-color-scheme: dark)`）：

| token | light scheme | dark scheme |
|---|---|---|
| `.jh-key` | `oklch(0.45 0.18 145)` 深绿 | `oklch(0.82 0.18 145)` 鲜绿 |
| `.jh-string` | `oklch(0.40 0.05 80)` 深棕 | `oklch(0.92 0.04 80)` 暖白 |
| `.jh-number` | `oklch(0.55 0.18 50)` 暗橙 | `oklch(0.78 0.15 50)` 亮橙 |
| `.jh-bool` | `oklch(0.45 0.20 230)` 深蓝 | `oklch(0.75 0.15 230)` 中蓝 |
| `.jh-null` | `oklch(0.50 0.18 25)` 深红 | `oklch(0.70 0.15 25)` 中红 |
| `.jh-punct` | `oklch(0.55 0.02 250)` 中灰 | `oklch(0.55 0.02 250)` 中灰 |

注：因为 panel 是固定深色，pre 内实际只会落到 dark scheme 一套；light scheme 那一列是为未来 panel 也跟主题预留，先一并写入但实际不激活。这一行可以等真要做浅 panel 时再加。**v1 实现仅深色一套**。

### 5.5 chip 颜色

oklch 同 L/C 家族，只换 hue：

```css
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: oklch(0.32 0.10 var(--chip-hue));
  color:      oklch(0.92 0.18 var(--chip-hue));
}
.chip--jwt          { --chip-hue: 290; }  /* 紫 */
.chip--escaped_json { --chip-hue: 145; }  /* 绿 */
.chip--url          { --chip-hue: 220; }  /* 蓝 */
.chip--base64       { --chip-hue: 30;  }  /* 橙 */
```

新增编码类型只要追加一个 hue。

### 5.6 配色总览

| 元素 | 来源 |
|---|---|
| panel 底色 | 固定 `oklch(0.18 0.02 250)`，独立于宿主主题 |
| 预览文本、pre 默认文字 | 固定浅灰 `oklch(0.78 0.02 250)` |
| chevron / copy icon 默认色 | 固定中灰 `oklch(0.62 0.02 250)` |
| icon hover overlay | 固定浅白透明 `oklch(1 0 0 / 0.08)` |
| JSON 高亮 | 固定（5.4 dark scheme 那一套） |
| chip | 固定 hue 家族（5.5） |
| **webview 边界外**（panel 之外的 padding 区） | 透明，吃透宿主 |

宿主 token 在本设计里不直接用到——所有 webview 内可见元素都在 panel 内，固定配色；panel 之外让宿主主题穿透。

## 6. UX 行为

### 6.1 inline copy

- 点击：`navigator.clipboard.writeText(payload.decoded)`
- 不调 `pasty.action.*`（renderer 不该 invoke action 命名空间）
- 不调宿主 toast
- 反馈：icon 切换为 checkmark 约 1.2s 后回弹
- 无障碍：旁挂一个 `aria-live="polite"` 隐藏元素，复制成功时 text 切到 `"Copied"`，1.2s 后清空

错误（极少见，比如剪贴板权限被拒）：catch 后不抛、不显示错误——降级为不变化（保守）。

### 6.2 inline chevron

- 点击：
  1. `localExpanded = !localExpanded`（即时翻转 UI）
  2. 读 `pasty.item.attachment.current()` 当前 payloadJson，parse，覆盖 `expanded` 字段
  3. `pasty.item.setAttachments({ attachments: [{ attachmentType, attachmentKey, payloadJson, attachmentSyncScope: "syncable" }] })`
- setAttachments 失败：UI 状态仍翻转完，不回滚——保证用户视觉响应；宿主 toggle-expand 按钮 title 可能短暂不同步，下一次 host fetch 会再对齐

### 6.3 双向同步

- host native button `toggle-expand` 点击 → runtime `invokeOperation` 走 setAttachments → topic 更新 → composable 推到 webview → `watch(payload.expanded, ...)` 把值同步给 `localExpanded`
- webview chevron 点击 → 见 6.2，最后也走 setAttachments，循环但安全（因为新值等于 localExpanded，`watch` 不会再次触发改变）

两条路径都收敛到 `payload.expanded`，没有竞态——后到者覆盖。

### 6.4 高度

- 折叠态：panel 总高约 50px，autoFit 把 webview 收到 ≥60px（manifest min）
- 展开态：panel = row + pre；pre 自身 max-height ≈ 360px，超出内滚；webview 高度 = panel 高度（autoFit），上限 480px（manifest max）
- 当 pre 内容很短：panel 自然变矮，autoFit 跟着收

## 7. 文件改动清单

| 文件 | 动作 |
|---|---|
| `src/runtime/shared/decoders.js` | JWT 分支增加返回 `signature` 字段 |
| `src/runtime/shared/decodePayload.js` | `payload.jwt.signature` 新字段；`decoded` 含 signature；decode 时容错读取 |
| `src/runtime/renderers/decodeRenderer.js` | `buttonsFor` 改为按情形 push；删除 `isEnabled` 字段；title `"Copy Decoded"` → `"Copy"`；空 payload 时 `buttons: []` |
| `src/ui/AttachmentDecodeApp.vue` | 全部重写：panel + row + 折叠/展开 + JSON 高亮 |
| `src/ui/shared/jsonHighlight.js` | 新建：JSON tokenizer + escape，导出 `highlightJson(text): string` |
| `src/ui/composables/usePluginAttachmentSession.js` | 不动 |
| `manifest.json` | 不动 |
| `scripts/*` | 不动 |
| `tests/*` | 现阶段不动；后续可加 `jsonHighlight.test.cjs` |

## 8. 兼容性

- 旧 attachment（pre-spec 写入的 payloadJson）：
  - 旧 `payload.decoded` 是 `JSON.stringify({header, payload})`（没有 signature 段），webview 直接读取这个字段渲染，所以旧 JWT attachment 展开后看到的就是无 signature 的两键对象——可接受
  - `payload.jwt.signature` 缺失 → `decodeDecodePayload` 兜底为空串，但 webview 用的是 `payload.decoded` 不是从 `payload.jwt` 再拼，所以这个兜底主要是防 NPE
  - 用户重新粘贴或 detector 再跑一次，新 payload 自动带上 signature 段
  - 无 `expanded` 字段 → 沿用现有默认 `false`
- detector 不变 → search projection、attachmentKey、attachmentType 都不变
- host 端 button 协议变化（不可用按钮不返回）：需要 host 实现能容忍 `buttons.length < 3`。template-plugin 的 SDK 文档里 `buttons` 是数组，没有强制三个的约束，理论兼容；实现时按当前宿主行为验证一次

## 9. 不做（YAGNI）

- panel 跟主题走的"浅模式"（5.4 light scheme 配色先写但不激活）
- JSON 之外的语法高亮（URL params、base64 inside hex 等）
- inline 双击复制、长按菜单等扩展手势
- pre 区的"展开全部 / 收回"二级按钮（直接靠 max-height + 内滚）
- 复制成功的 host toast 集成（renderer 不该跨命名空间调 action）
- ARIA 键盘导航 row（chevron 按钮自身可聚焦即可）
