# 技术文件起草（JSWJ_DraftbyDSH）

技术文件起草（JSWJ_DraftbyDSH），以下简称本插件，是面向飞书知识库的起草与 AI 预审 DSH bundle。本插件提供 9 个工具、一个分步任务向导页面：

- 知识库读写：`jswj_ping` / `jswj_wiki_list` / `jswj_doc_read` / `jswj_wiki_create` / `jswj_doc_append`
- Word 出稿：`jswj_render_docx`（Markdown → GY-F003 .docx）
- 发布：`jswj_publish_docx`（上传 .docx → 移入知识库文件节点）
- 任务状态：`jswj_task_get` / `jswj_task_update`（页面与助手共用同一任务）

## 目录

```
plugin/
├── package.json
├── cordis.patch.yml
├── lib/index.js          工具注册 + /api/jswj 页面数据通道
├── lib/tasks.js          任务存储与门禁
├── lib/client.js         D1–D8 / R1–R5 分步向导 + 侧边栏入口
├── python/render_docx.py
├── template/GY-F003-cleaned.docx
├── locale/{zh,en}.json
├── icon.svg
├── selftest.mjs
└── README.md
```

## 安装

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

条目 id 为 `jswj-draft`，页面挂载在 `main`（key 同 id）与 `sidebar.panellist`（显示名「技术文件起草」）。

## 配置

在 profile 的 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中按 id 覆盖（config 整体替换）：

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

也支持环境变量 `JSWJ_APP_ID`、`JSWJ_APP_SECRET`、`JSWJ_SPACE_ID`、`JSWJ_ROOT_TOKEN`、
`JSWJ_DRAFT_ROOT_TOKEN`、`JSWJ_PYTHON`。

## 页面：分步任务向导

- **任务列表**：按待处理 / 进行中 / 已完成分组；新建入口按「创建技术资料 / 评审技术资料 × 技术文件」组织。
- **起草 D1–D8**：基本信息 → 文档属性 → 参考资料 → 大纲与纲要 → 生成 → 自检 → 修订 → 出稿。
- **预审 R1–R5**：确认开始 → 类型与评审单 → 文件与资料 → 预审 → 意见与修订；意见逐条采纳 / 驳回 / 改写，全部处置后才能存档。
- 每步一个决策，门禁不过不能推进；左侧步骤栏显示已完成 / 当前 / 未开始。
- 生成、自检、预审、修订四个需要模型的动作，通过「交给助手」新建会话并把任务号交给助手；
  助手完成后用 `jswj_task_update` 写回，页面点「刷新」继续。
- 出稿和预审存档由页面直接调用 Host 完成：渲染 GY-F003 Word → 上传 → 移入知识库 → 回显链接。

## 数据与接口

任务状态存放于 `~/.dsh/jswj-tasks/<任务号>.json`，不依赖对话。任务号形如
`DOC-20261022-001`、`REV-20261022-001`。

页面通过 `POST /api/jswj` 读写，要求同源且带 `x-jswj: 1` 头：

| action | 作用 |
|---|---|
| `tasks.list` / `tasks.get` / `tasks.create` / `tasks.patch` / `tasks.step` | 任务与门禁 |
| `doc.read` / `wiki.list` | 解析资料、列节点 |
| `publish` | 渲染并发布，可选写回任务 |

## 自测

```powershell
$env:JSWJ_APP_ID = "cli_xxx"
$env:JSWJ_APP_SECRET = "xxx"
$env:JSWJ_SPACE_ID = "7698962670346636559"
$env:JSWJ_DRAFT_ROOT_TOKEN = "K3Np..."
node selftest.mjs --cleanup
```

## 已知限制

- 单文件 ≤ 20 MB。
- 只读 docx 在线文档；`file` 节点不能读正文。
- 大纲模板内置两份（需求规范 / 技术方案），新增文档类型需同步 `client.js` 与注册表。
- 预审意见的分组统计、逐条处置按钮仍是简化版；当前提供存档与助手协助修订。
- 生成质量取决于助手与参考资料，页面只负责流程与门禁。
