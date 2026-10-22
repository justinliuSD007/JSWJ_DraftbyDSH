# 技术文件起草（JSWJ_DraftbyDSH）

技术文件起草（JSWJ_DraftbyDSH），以下简称本插件，是面向飞书知识库的**技术文件起草与 AI 预审**工具，以 DSH（DeepSeek Harness）插件 + Skill 形式交付。

## 能力

- **使用指南**：https://govy.feishu.cn/wiki/Arv4wKueCiTuS3kddZrcwGHvnOb
- **分步任务向导**：起草 D1–D8、预审 R1–R5，每步一个决策，门禁不过不能推进。
- **任务中心**：按待处理 / 进行中 / 已完成分组；预审意见逐条采纳、驳回或改写后才能存档。
- **环境自检**：任务列表检查 HarmonyOS Sans SC，缺失时一键安装（字体文件不随插件分发）。
- 任务状态存 Host（`~/.dsh/jswj-tasks`），刷新、重开、换会话都不丢。
- 知识库读写：列节点、读正文、建节点、追加段落。
- Word 出稿：Markdown → 套用 GY-F003 模板的 `.docx`，封面、页眉、章节、表格自动处理。
- 发布：`.docx` 上传后作为文件节点移入知识库，返回节点链接。
- 生成 / 自检 / 预审 / 修订交给助手执行，助手用任务工具写回结果，页面继续推进。

## 仓库结构

```
plugin/                      DSH bundle
├── lib/index.js             9 个工具 + /api/jswj 页面数据通道
├── lib/tasks.js             任务存储与门禁
├── lib/client.js            D1–D8 / R1–R5 分步向导
├── python/render_docx.py    Markdown → GY-F003 Word
├── template/                清理版模板
├── cordis.patch.yml         插入 jswj-draft 条目（不含凭据）
└── README.md
skills/jswj-draftbydsh/      Skill：业务流、门禁、出稿规范、任务写回
```

## 安装

前置：DSH 桌面端；Python 3 + `python-docx`（DSH 自带运行时已包含）；飞书自建应用具备
`wiki:wiki`、`drive:file:upload`、`wiki:node:move`，并已加入知识空间。

1. **安装插件**

   ```
   plugin_manager action=install_bundle target=<本仓库>/plugin
   ```

2. **配置**（`~/.dsh/profiles/desktop/cordis.patch.yml`）

   ```yaml
   - id: jswj-draft
     config:
       appId: cli_xxxxxxxxxxxx
       appSecret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
       spaceId: "7698962670346636559"
       rootToken: ""
       draftRootToken: "<技术资料草稿库 node_token>"
       pythonPath: ""
       outputDir: ""
   ```

3. **安装 Skill**

   把 `skills/jswj-draftbydsh/` 复制到 `~/.dsh/skills/`。

4. **使用**

   左侧「技术文件起草」→ 新建技术文件 / 新建预审 → 按步骤推进。

## 工具

| 工具 | 作用 |
|---|---|
| `jswj_ping` | 凭据、空间、Python、模板自检 |
| `jswj_wiki_list` | 列出子节点 |
| `jswj_doc_read` | 读取在线文档正文 |
| `jswj_wiki_create` | 新建 docx 节点 |
| `jswj_doc_append` | 追加文本段落 |
| `jswj_render_docx` | Markdown → GY-F003 Word |
| `jswj_publish_docx` | 上传并移入知识库 |
| `jswj_task_get` | 读取任务状态 |
| `jswj_task_update` | 写回生成 / 自检 / 预审 / 修订结果 |

## 验证状态

- `node --check` 入口通过；11 个文件语法检查通过。
- 页面数据通道 `POST /api/jswj` 实测：任务创建、门禁拒绝、逐步推进、发布、清理全部通过。
- 起草 D1–D8 与预审 R1–R5 通过接口完整跑通，出稿节点生成后已删除。
- 插件工具通道调用 `jswj_ping` 成功，凭据由 profile 覆盖层生效。
- 页面按钮的真实点击链路尚未在浏览器中自动化验证。

## 安全

- 仓库不保存 `appSecret`；`plugin/cordis.patch.yml` 只留空占位。
- 页面接口仅接受同源 `POST`，要求 `x-jswj: 1` 头。
- 任务文件只存业务数据，不含凭据。

## 已知限制

- 单文件 ≤ 20 MB。
- 只读 docx 在线文档。
- 大纲模板内置两份，新增文档类型需同步注册表与 `client.js`。
- 预审意见的逐条处置按钮仍是简化版（当前提供存档与助手协助修订）。
