# @govy/dsh-plugin-jswj-draft

**JSWJ_DraftbyDSH**：技术文件起草与 AI 预审的 DSH bundle。提供 7 个工具与一个独立页面：

- 飞书知识库读写：`jswj_ping` / `jswj_wiki_list` / `jswj_doc_read` / `jswj_wiki_create` / `jswj_doc_append`
- Word 出稿：`jswj_render_docx`（Markdown → 套用 GY-F003 模板的 .docx）
- 知识库发布：`jswj_publish_docx`（上传 .docx → 移入知识库文件节点）

## 目录

```
plugin/
├── package.json          # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 插入 jswj-draft 条目（不含凭据）
├── lib/index.js          # 服务端：7 个工具
├── lib/client.js         # 客户端：整页视图 + 侧边栏入口
├── python/render_docx.py # 参数化 Word 渲染器
├── template/GY-F003-cleaned.docx
├── locale/{zh,en}.json
├── icon.svg
├── selftest.mjs          # 不经过 DSH 通道的端到端自测
└── README.md
```

## 安装

本包是 bundle，用 `plugin_manager` 的 `install_bundle` 以绝对路径安装，不要手工写 profile 的
`package.json` 或 `cordis.patch.yml`：

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

条目 id 为 `jswj-draft`，页面挂载在 `main`（key 同为 `jswj-draft`）与 `sidebar.panellist`。

## 配置

面板配置在 profile 的 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中按 id 覆盖
（config 是整体替换，不是深合并）：

```yaml
- id: jswj-draft
  config:
    appId: cli_xxxxxxxxxxxx
    appSecret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    spaceId: "7698962670346636559"
    rootToken: ""
    draftRootToken: "K3NpwxFzribxgOkzFxaczeH7nXf"
    pythonPath: ""
    outputDir: ""
```

| 键 | 必填 | 说明 |
|---|---|---|
| `appId` | 是 | 飞书自建应用 App ID |
| `appSecret` | 是 | 飞书自建应用 App Secret |
| `spaceId` | 是 | 知识空间 ID |
| `rootToken` | 否 | 默认父节点；为空表示根级 |
| `draftRootToken` | 否 | 出稿默认父节点，建议指向「技术资料草稿库」的 node_token |
| `pythonPath` | 否 | 渲染用 Python；留空时自动探测 DSH 运行时自带的 Python |
| `outputDir` | 否 | 本地出稿目录；留空为 `~/.dsh/jswj-out` |

也可用环境变量：`JSWJ_APP_ID`、`JSWJ_APP_SECRET`、`JSWJ_SPACE_ID`、`JSWJ_ROOT_TOKEN`、
`JSWJ_DRAFT_ROOT_TOKEN`、`JSWJ_PYTHON`。

## 飞书权限

应用需要：`wiki:wiki`（知识库读写）、`drive:file:upload` / `drive:drive`（云空间上传）、
`wiki:node:move`（移入知识库），并把应用添加为知识空间成员，否则 `move_docs_to_wiki`
返回 `131006`。

## 发布链路

1. `upload_all` 上传到云空间根目录（飞书不允许直接上传到知识库）。
2. `move_docs_to_wiki` 带 `obj_type: "file"` 移入目标父节点，轮询
   `/wiki/v2/tasks/{id}?task_type=move`。
3. 返回 `wikiToken` 与 `https://<租户域>/wiki/<node>` 链接。

上传失败或移动失败会保留 `file_token` 与预览地址，便于手动补救。

## 自测

```powershell
$env:JSWJ_APP_ID = "cli_xxx"
$env:JSWJ_APP_SECRET = "xxx"
$env:JSWJ_SPACE_ID = "7698962670346636559"
$env:JSWJ_DRAFT_ROOT_TOKEN = "K3Np..."
node selftest.mjs --cleanup
```

自测会依次执行 ping、列节点、读模板、渲染 Word、发布并删除测试节点。

## 页面交互

页面不是只读说明页。首屏「快速开始」提供：

- 文件名称、文件类型、密级、层级、板块五个字段；
- 「开始起草」：新建会话并向助手投递结构化指令，随后自动切到对话；
- 「开始预审」：同上，进入预审流程；
- 「复制指令」：剪贴板兜底，权限受限或 Remote 不可用时仍可继续；
- 「打开知识库」：跳到草稿库节点。

交互实现走 DSH 的 Remote 通道，不在页面里重复业务逻辑：

```js
const created = await ctx.remote.session.create({});
await ctx.remote.session.prompt({
  requestId, sessionId: created.sessionId, mode: "queue",
  content: [{ type: "text", text: command }],
  clientTimeZone,
});
ctx.uiWorkspace.openSession(created.sessionId);
```

页面只负责「收集意图 + 展示状态」，真正的读写、渲染、发布仍由助手调用 7 个工具完成。

## 已知限制

- 单文件 ≤ 20 MB（飞书 `upload_all` 上限）。
- 渲染器依赖 `python-docx` 与 GY-F003 清理版模板；模板结构变化会导致
  `trim_front_matter` 报"模板结构不符"。
- 知识库只支持 docx 在线文档读取；file 类型节点不可读取正文。
- 渲染器的中文路径输出固定为 UTF-8，Windows 管道下不要改回本地代码页。
