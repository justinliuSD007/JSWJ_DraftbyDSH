# JSWJ_DraftbyDSH

面向飞书知识库的**技术文件起草与 AI 预审**工具，以 DSH（DeepSeek Harness）插件 + Skill 形式交付。

## 能力

- 两条业务流：起草 8 步、预审 5 步，每步有门禁，不跳步。
- 知识库读写：列节点、读正文、建节点、追加段落。
- Word 出稿：Markdown → 套用 GY-F003 模板的 `.docx`，封面、页眉、章节、表格自动处理。
- 发布：`.docx` 上传后作为**文件节点**移入知识库，保留 Word 原文件，返回节点链接。
- 可交互页面：填表 → 新建会话 → 投递结构化指令 → 自动切到对话，另有「复制指令」「打开知识库」。

## 仓库结构

```
plugin/                      DSH bundle（服务端工具 + 客户端页面）
├── lib/index.js             7 个工具
├── lib/client.js            整页视图 + 侧边栏入口
├── python/render_docx.py    Markdown → GY-F003 Word
├── template/                清理版模板
├── cordis.patch.yml         插入 jswj-draft 条目（不含凭据）
└── README.md                安装、配置、权限、限制
skills/jswj-draftbydsh/      Skill：两条业务流、门禁、出稿规范、失败降级
```

## 安装

前置条件：DSH 桌面端；Python 3 + `python-docx`（DSH 自带运行时已包含）；飞书自建应用具备
`wiki:wiki`、`drive:file:upload`、`wiki:node:move`，并已加入知识空间成为成员。

1. **安装插件**

   ```
   plugin_manager action=install_bundle target=<本仓库>/plugin
   ```

2. **配置**（`~/.dsh/profiles/desktop/cordis.patch.yml`，config 为整体替换）

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

   也可用环境变量 `JSWJ_APP_ID`、`JSWJ_APP_SECRET`、`JSWJ_SPACE_ID`、
   `JSWJ_ROOT_TOKEN`、`JSWJ_DRAFT_ROOT_TOKEN`、`JSWJ_PYTHON`。

3. **安装 Skill**

   把 `skills/jswj-draftbydsh/` 复制到 `~/.dsh/skills/`。目录被监听，无需重启。

4. **自检**

   调用 `jswj_ping`，确认空间名、根节点、Python 与模板均正常。

## 工具

| 工具 | 作用 |
|---|---|
| `jswj_ping` | 凭据、知识空间、Python、模板自检 |
| `jswj_wiki_list` | 列出节点下的子节点 |
| `jswj_doc_read` | 读取在线文档正文 |
| `jswj_wiki_create` | 新建 docx 节点 |
| `jswj_doc_append` | 向文档追加文本段落 |
| `jswj_render_docx` | Markdown → GY-F003 Word |
| `jswj_publish_docx` | .docx 上传并移入知识库 |

## 验证状态

- `node --check` 两个入口通过。
- 自测覆盖 ping → 列节点 → 读模板 → 渲染 176 KB Word → 上传 → 移入知识库 → 返回链接，测试节点已清理。
- `main`（key `jswj-draft`）与 `sidebar.panellist`（id `jswj-draft`）槽位注册为 `active`。
- 页面交互通过 `ctx.remote.session.create/prompt` + `ctx.uiWorkspace.openSession` 实现；
  模块加载与槽位注册已验证，按钮点击链路待人工点一次确认。
- 实机工具通道调用 `jswj_ping` 成功：空间名「技术资料起草库」、三个根节点、出稿父节点、
  Python 与模板状态均正确，证明凭据由 profile 覆盖层生效。
- 浏览器中的实际视觉呈现未做自动化截图验证。

## 安全

- 仓库不保存 `appSecret`；`plugin/cordis.patch.yml` 只留空占位。
- 自测脚本从环境变量读取凭据，不硬编码。
- PAT 不入库；GitHub 凭据仅在本机注入。

## 已知限制

- 单文件 ≤ 20 MB（飞书 `upload_all` 上限）。
- 只读取 docx 在线文档；`file` 类型节点无法读正文。
- 模板结构变化会导致渲染器报「模板结构不符」，需同步更新 `template/` 与 `trim_front_matter`。
