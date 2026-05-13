# Pasty Awesome Decode 插件设计

> 一个 Pasty v2 插件：当用户复制的字符串是已编码内容（Base64 / URL / Escaped JSON / JWT），自动识别并以卡片形式展示解码结果，提供一键复制解码内容的按钮。

## 1. 背景与目标

开发与运维场景里，复制的字符串经常是某种编码包裹的内容（接口返回里的 JWT、URL 参数中的 percent-encoding、日志里的 Base64 序列化等）。当前 Pasty 列表里这类条目只能看到原文。

本插件目标：在 Pasty 列表里为这类条目自动挂一张解码预览卡片，让用户：

1. 一眼看到这是什么编码、解出来是什么内容
2. 一键复制解码后的内容到系统剪贴板
3. 当解码结果是 JSON 时，还能复制成 pretty-print 形式

非目标：

- 不做加密 / 哈希识别（MD5、SHA、AES 等本身不可逆，无展示价值）
- 不做用户配置（开关、阈值、编码白/黑名单）
- 不做多层递归解码（JWT 拆 header+payload 是唯一例外）
- 不做将解码内容写回 item（不修改 tags、不替换 attachment 主体）

## 2. 范围与决策汇总

| 维度 | 决策 |
|---|---|
| `plugin.id` | `plugin.pasty.awesome.decode` |
| `attachmentType` | `plugin.pasty.awesome.decode.preview` |
| `permissions` | `[]`（无 mutation 权限） |
| 支持编码 | JWT / Escaped JSON / URL encoding / Base64（含 Base64URL） |
| 检测策略 | 严格档（宁漏勿错） |
| 多层处理 | 单层，JWT 例外（拆 header + payload 同卡展示） |
| 优先级 | JWT > Escaped JSON > URL > Base64 |
| 预处理 | 整体 trim，空 / 超过 256 KB 直接 bail，Base64 内部 strip `\s+` |
| 产物 | 1 detector + 1 attachment renderer，无 action |
| 卡片高度 | `{ min: 100, max: 480 }` + `pasty.window.autoFit()` |
| 卡片元素 | 顶部编码徽章 → 主体 decoded 内容 → 底部两按钮 |
| 按钮 | Copy Decoded（始终启用）+ Copy as JSON（仅 JSON / JWT 启用） |
| Search projection | 写入，让 Pasty 全局搜索能搜到解码后内容 |
| 测试 | nice-to-have，写文件骨架但不阻塞实现完成 |

## 3. 架构

### 3.1 注册的产物

完全沿用 template 的 `definePlugin({ setup() })` 模式：

```js
module.exports = definePlugin({
  setup() {
    return {
      detectors: {
        "decode-detector": createDecodeDetector()
      },
      attachmentRenderers: {
        "decode-renderer": createDecodeRenderer()
      }
    };
  }
});
```

### 3.2 manifest.json

```json
{
  "schemaVersion": 2,
  "plugin": {
    "id": "plugin.pasty.awesome.decode",
    "title": "Pasty Awesome Decode",
    "version": "0.1.0"
  },
  "install": {
    "runtime": "node",
    "entry": "scripts/install.mjs"
  },
  "runtime": {
    "nodeEntry": "dist/runtime/index.cjs",
    "uiRoot": "dist/ui"
  },
  "permissions": [],
  "attachmentRenderers": [
    {
      "id": "decode-renderer",
      "title": "Decoded Preview",
      "attachmentType": "plugin.pasty.awesome.decode.preview",
      "height": { "min": 100, "max": 480 },
      "uiEntry": "renderers/decode-renderer/index.html"
    }
  ],
  "detectors": [
    {
      "id": "decode-detector",
      "title": "Decode Detector",
      "supportedInputKinds": ["text"],
      "attachmentTypes": ["plugin.pasty.awesome.decode.preview"]
    }
  ]
}
```

### 3.3 源文件 → dist 产物 → manifest 路径映射

源文件（`src/` 下，人编写）：

```
src/
├── runtime/
│   ├── index.js                              ← definePlugin 注册入口
│   ├── detectors/
│   │   └── decodeDetector.js                 ← detect(input)
│   ├── renderers/
│   │   └── decodeRenderer.js                 ← resolveAttachment / invokeOperation
│   └── shared/
│       ├── decoders.js                       ← 4 种 decode 的纯函数实现
│       ├── detection.js                      ← 预处理 + 优先级链
│       └── decodePayload.js                  ← create/decode/format payload
└── ui/
    ├── AttachmentDecodeApp.vue               ← 顶层 Vue 组件
    ├── composables/
    │   └── usePluginAttachmentSession.js     ← 复用 template 现有的 composable
    └── renderers/
        └── decode-renderer/
            ├── index.html                    ← Vite 入口 HTML，build 时 cp 到 dist
            └── main.js                       ← createApp + mount
```

构建产物（`npm run build` 生成，`.gitignore`）：

```
dist/
├── runtime/
│   └── index.cjs                             ← esbuild 把 src/runtime/index.js 单文件打包
└── ui/
    └── renderers/
        └── decode-renderer/
            ├── index.html
            ├── index.js                      ← Vite lib build (iife)
            └── index.css
```

manifest 路径解析：

- `runtime.nodeEntry: "dist/runtime/index.cjs"` —— 相对插件根目录
- `runtime.uiRoot: "dist/ui"` —— 相对插件根目录
- `uiEntry: "renderers/decode-renderer/index.html"` —— 相对 `uiRoot`，最终解析为 `dist/ui/renderers/decode-renderer/index.html`

### 3.4 需要修改的构建脚本

- **`scripts/build-ui.mjs`**：`pages[]` 数组原来三条 template 入口替换为一条：
  ```js
  {
    name: "decode-renderer",
    kind: "renderers",
    globalName: "PastyAwesomeDecodeRenderer",
    entry: path.resolve(projectRoot, "src/ui/renderers/decode-renderer/main.js"),
    template: path.resolve(projectRoot, "src/ui/renderers/decode-renderer/index.html")
  }
  ```
- **`scripts/build-runtime.mjs`**：无需修改（自动 bundle `src/runtime/index.js` 的依赖树）。
- **`scripts/install.mjs`** / **`scripts/verify-build.mjs`**：实现阶段实际跑一遍 `npm run build`，按产物清单微调（预计只需替换产物文件名常量）。

## 4. Detector 检测逻辑

### 4.1 预处理（所有检测前）

1. 仅处理 `input.content.kind === "text"`；其他 kind 返回空 artifacts。
2. 读取 `input.content.payload.text`，做整体 trim（剥首尾 `\s+`）。
3. trim 后空字符串 → 返回空 artifacts。
4. trim 后长度 > 256 KB → 返回空 artifacts。
5. 所有后续判定基于 trim 后的字符串。

### 4.2 优先级链

按以下顺序尝试，**命中第一个就返回**，不再继续后续分支。

#### 4.2.1 JWT

匹配条件（全部满足）：

- 正则 `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$`
- 三段都能成功 Base64URL 解码
- 第一段 header decode 后是合法 JSON 对象，且含字段 `alg`

命中后输出：

- `encoding: "jwt"`
- `jwt: { header: <header JSON>, payload: <payload JSON> }`
- `decoded: JSON.stringify({ header, payload }, null, 2)`（即"Copy Decoded"复制内容）
- `decodedIsJSON: true`

#### 4.2.2 Escaped JSON 字符串

两条平行路径，任一命中即视为 escaped JSON。

**Path A —— 完整 JSON 字符串字面量**（外层带引号）：

- 字符串以 `"` 开头且以 `"` 结尾
- 整体 `JSON.parse(input)` 成功且返回值是 `string`
- 命中后 `decoded = <解出的 string>`

**Path B —— 外层引号被剥掉的 escaped JSON 内容**（典型场景：从 log 里复制的字符串）：

- 输入包含 `\"`（反斜杠+引号字面序列，作为转义信号）
- `JSON.parse('"' + input + '"')` 成功（用反转义把 `\n` / `\"` / `\\` 等还原）
- 反转义结果再用 `JSON.parse(...)` 一次，且结果是 **object 或 array**（拦截 `\"hello\"` 这类"解出来是字符串"的伪命中）
- 命中后 `decoded = <反转义后的字符串>`

Path A 先尝试；若 Path A 不命中再走 Path B。共同输出：

- `encoding: "escaped_json"`
- `decoded: <见上>`
- `decodedIsJSON`: 用 `JSON.parse(decoded)` 试一次，成功为 `true`（Path B 命中时此值恒为 `true`）

#### 4.2.3 URL encoding

匹配条件：

- 至少包含 1 个 `%XX` 序列（正则 `/%[0-9A-Fa-f]{2}/`）
- `decodeURIComponent(input)` 不抛错
- decode 后字符串与原文不同

命中后输出：

- `encoding: "url"`
- `decoded: decodeURIComponent(input)`
- `decodedIsJSON`: 用 `JSON.parse(decoded)` 试一次

#### 4.2.4 Base64 / Base64URL（严格档）

匹配条件（全部满足）：

- 先 `replace(/\s+/g, '')` 剥内部空白（容忍 MIME 风格 76 字符折行）
- 字符集合法：`/^[A-Za-z0-9+/]+={0,2}$/`（标准）或 `/^[A-Za-z0-9_-]+={0,2}$/`（URL-safe）
- 长度 ≥ 8（短 token 几乎都是误判）
- 标准 Base64 长度是 4 的倍数；URL-safe 允许 unpadded（按 RFC 4648 §5）
- Buffer.from(stripped, 'base64').toString('utf8') 反序列化无异常
- decode 后字节流经 UTF-8 解码无异常（验证：将 decode 后的 buffer 转 utf8 字符串，再 `Buffer.from(str, 'utf8')` 转回，与原 buffer 严格相等 → 说明是合法 UTF-8）
- decode 后字符串中可打印字符占比 ≥ 95%（可打印 = `\x20-\x7E` ∪ Unicode `L`/`N`/`P`/`Z` 类别，外加 `\t \n \r`）

命中后输出：

- `encoding: "base64"`
- `decoded: <UTF-8 string>`
- `decodedIsJSON`: 用 `JSON.parse(decoded)` 试一次

### 4.3 Artifact 输出

命中时产生**一个** artifact：

```js
{
  attachmentType: "plugin.pasty.awesome.decode.preview",
  attachmentKey: "primary",
  payloadJson: JSON.stringify({
    kind: "decode_preview",
    version: 1,
    encoding: "jwt" | "escaped_json" | "url" | "base64",
    original: <trim 后的输入>,        // 超过 4 KB 截断 + 置 truncated:true
    truncated: false,
    decoded: <decoded 字符串>,
    decodedIsJSON: <bool>,
    jwt: { header, payload } | null,  // 仅 encoding=jwt 时有
    originalLength: <number>,
    decodedLength: <number>,
    expanded: false                   // 新建 attachment 默认 compact;
                                      // toggle-expand 按钮翻转此布尔
  }),
  searchProjection: {
    scope: "pasty_awesome_decode",
    searchText: `${encodingLabel} ${decoded.slice(0, 4096)}`,
    label: encodingLabel              // "JWT" / "Escaped JSON" / "URL" / "Base64"
  },
  attachmentSyncScope: "syncable"
}
```

未命中时返回 `artifacts: []`，卡片不出现。

## 5. Renderer UI

### 5.1 布局（扁平化，无内嵌卡片）

宿主已经在 attachment 区域外层提供卡片容器和操作按钮条，**webview 内部不再绘制卡片框架，也不渲染按钮**，只负责呈现内容。

```
[encoding 徽章]                          originalLen → decodedLen

<decoded 文本，可滚动 / 折行>
- 等宽字体
- JWT 时分 Header / Payload 两段，各带 sub-header
- 高度由 autoFit 控制
```

不在顶部展示原文预览（decoded 主体本身就是预览）。背景透明、无 border、无 shadow —— 让宿主的卡片框架透过来。

### 5.2 JWT 特殊布局

主体区域分两段，浅色 sub-header 分别标 `Header` / `Payload`，各自展示 pretty-print 后的 JSON（等宽字体 + 语法高亮可选 v1.1 再做）。Signature 段不展示。

### 5.3 按钮（由宿主渲染，**不在 webview 里**）

按钮的呈现责任完全在宿主。runtime 通过 `resolveAttachment` 返回 buttons 数组告诉宿主要画什么；用户点击宿主的按钮后，宿主把 click 事件转回 runtime 的 `invokeOperation`。

| 按钮 ID | 显示 | enabled | 点击 |
|---|---|---|---|
| `copy-decoded` | Copy Decoded | 始终启用 | 复制 `payload.decoded`（JWT 即 `{header,payload}` 整段 JSON） |
| `copy-json` | Copy as JSON | 仅 `decodedIsJSON === true` 或 `encoding === "jwt"` | 对 `payload.decoded` 做 `JSON.parse` 后 `JSON.stringify(_, null, 2)` 复制 |
| `toggle-expand` | `Show More` / `Show Less` | 始终启用 | 翻转 `payload.expanded` 后通过 `ctx.host.item.setAttachments` 替换当前 attachment group，触发 UI 重渲染 |

`toggle-expand` 的 title 根据当前 `payload.expanded` 动态返回：`expanded === true` 显示 `Show Less`，否则显示 `Show More`。

runtime 处理点击时构造 `{ attachments: [{ attachmentType, attachmentKey, payloadJson, attachmentSyncScope: "syncable" }] }` 一份完整 group 传给 `setAttachments`，新 `payloadJson` 即翻转后的 payload 重新 stringify 结果。

调用 `setAttachments` 需要 manifest `permissions` 包含 `"setAttachment"`。

webview UI 组件不订阅按钮、不渲染按钮、不处理 click，避免与宿主重复。它只读 `payload.expanded`：`false` 时主体加 `max-height: 120px` + 底部 fade-out 遮罩做 compact；`true` 时移除限制让内容自然展开。Compact 模式下 `tintHex` 返回 `null`，让宿主自己的卡片徽章用主题 accent 着色，不再按 encoding 上色。

### 5.4 反馈

- 成功：`rendererResult.success({ userMessage: 'Decoded copied' })` / `'JSON copied'`
- Copy as JSON 时 `JSON.parse` 失败（理论不该发生，因 `decodedIsJSON` 已门控）：兜底复制 `payload.decoded` 原文 + `userMessage: 'JSON parse failed, copied raw'`

### 5.5 主题适配

- 12 个 `--pasty-*` CSS token 全部使用，覆盖文字、徽章 tint 等（背景留透明走宿主）
- 不订阅 `pasty.theme.on()`（不画 canvas）
- 依赖宿主注入的 `color-scheme: light dark`，自动跟随主题

### 5.6 高度策略

- manifest `height: { min: 60, max: 480 }`（按钮已下移到宿主，最小可更低）
- UI 启动后调 `await pasty.window.autoFit({ min: 60, max: 480 })`，dispose 在 Vue `onBeforeUnmount` 调用
- 主体内容自然撑高，autoFit 调整整张卡片高度

## 6. 边界与失败处理

| 情形 | 行为 |
|---|---|
| `input.content.kind !== "text"` | detector 返回空 artifacts |
| `input.content.payload.text` 为 null / undefined | detector 返回空 artifacts |
| trim 后为空字符串 | detector 返回空 artifacts |
| trim 后长度 > 256 KB | detector 返回空 artifacts |
| 优先级链全部 miss | detector 返回空 artifacts，卡片不出现 |
| renderer 收到非法 `payloadJson` | `rendererResult.failure("Invalid decode payload")`，按钮全置 disabled |
| Copy as JSON 时 `JSON.parse` 异常 | fallback 复制 `payload.decoded` 原文，提示 "JSON parse failed, copied raw" |
| Base64 decode 后非 UTF-8 字节流 | 该分支判定为 miss（不会出现到 renderer） |

## 7. 测试（nice-to-have）

文件骨架（沿用 template 的 Node test runner）：

- **`tests/runtime/decodeDetector.test.cjs`**
  - 各 encoding 各 ≥ 2 fixture：命中 + 解码内容正确
  - 优先级冲突 fixture：同时合法 Base64 + URL → 必须走 URL
  - 漏判 fixture：纯 hex / UUID / 短随机串 / 纯中文 → 不识别为 Base64
  - 预处理 fixture：前后空白、Base64 MIME 折行、空串、超长
  - 非 `text` kind 输入 → 空 artifacts
- **`tests/runtime/decodeRenderer.test.cjs`**
  - `resolveAttachment` 在 4 种 encoding 下返回正确的 buttons 数组与 enabled 状态
  - `invokeOperation` 两个 buttonID 分发 + clipboard mock 断言文本
  - 非法 payloadJson 走 failure 分支

测试不阻塞实现完成；如果实现期间发现测试基建不顺，可降级为仅保留 fixture 数据 + 1 个 smoke test。

## 8. 不做（YAGNI 边界）

- 多层递归解码（除 JWT 已有的 header/payload 拆分）
- 用户配置面板（编码开关、长度阈值、忽略列表、严格度调节）
- 写回 item 的 mutation（tag、pin、attachment 替换）
- compact / expanded 双 attachment（单 renderer + autoFit 已覆盖需求）
- 加密 / 哈希识别
- 中文以外的多语言 i18n（v1 直接英文 + 中文混用即可，遵循 template 现状）
- 设置面板 settings 读写

## 9. 实现工作量预估

- runtime：`detectors/decodeDetector.js` + `shared/{decoders,detection,decodePayload}.js` ≈ 250-350 行
- renderer：`renderers/decodeRenderer.js` ≈ 80-120 行
- UI：1 个顶层 Vue + 复用 template 现有 composable ≈ 150-250 行
- 构建脚本：`scripts/build-ui.mjs` 改 pages 数组（≈ 10 行）
- manifest：替换全文
- 测试：fixture + 两个 test 文件 ≈ 200-400 行
