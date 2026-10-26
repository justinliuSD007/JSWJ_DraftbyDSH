# 技术文件起草（JSWJ_DraftbyDSH）

技术文件起草（JSWJ_DraftbyDSH），以下简称本插件，是面向飞书知识库的**技术文件起草与 AI 预审**工具，以 DSH（DeepSeek Harness）插件 + Skill 形式交付。

## 能力

- **使用指南**：https://govy.feishu.cn/wiki/Arv4wKueCiTuS3kddZrcwGHvnOb
- **分步任务向导**：起草 D1–D7、预审 R1–R5，每步一个决策，门禁不过不能推进。
- **任务中心**：按待处理 / 进行中 / 已完成分组；预审意见逐条采纳、驳回或改写后才能存档。
- **环境自检**：任务列表检查 HarmonyOS Sans SC，缺失时一键安装（字体文件不随插件分发）。
- **资料留存**：D3 支持链接解析与 docx / md 上传，上传件自动归档到知识库 `参考资料库/{层级}/{板块}/`。
- 任务状态存 Host（`~/.dsh/jswj-tasks`），刷新、重开、换会话都不丢。
- 知识库读写：列节点、读正文、建节点、追加段落。
- Word 出稿：Markdown → 套用 GY-F003 模板的 `.docx`，封面、页眉、章节、表格自动处理。
- 发布：`.docx` 上传后作为文件节点移入知识库，返回节点链接。
- 生成与预审交给助手执行；生成的回合内自动完成自检与修订，页面只留成稿确认与出稿。

## 仓库结构

```
plugin/                      DSH bundle
├── lib/index.js             9 个工具 + /api/jswj 页面数据通道
├── lib/tasks.js             任务存储与门禁
├── lib/client.js            D1–D7 / R1–R5 分步向导
├── python/render_docx.py    Markdown → GY-F003 Word
├── template/                清理版模板
├── cordis.patch.yml         插入 jswj-draft 条目（不含凭据）
└── README.md
skills/jswj-draftbydsh/      Skill：业务流、门禁、出稿规范、任务写回
```

## 安装

前置：DSH 桌面端；Python 3 + `python-docx`（DSH 自带运行时已包含）；飞书应用「GO秘」的
`appId` / `appSecret`（向应用管理员获取）；当前知识库权限已统一开通。

1. **打包**

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\pack-plugin.ps1
   ```

   生成 `dist/jswj-draft-plugin-0.4.0.zip`，包内已包含插件、Skill、Word 模板和安装说明。

2. **安装 bundle**

   在 DSH 插件管理里选择「安装本地 bundle」，指向解压后的 `jswj-draft` 目录；或让 DSH 助手安装该目录。

3. **配置**

   复制 `plugin/config.example.yml` 到 `~/.dsh/profiles/desktop/cordis.patch.yml`，按实际环境填 `appId`、`appSecret`、`spaceId`、`draftRootToken`、`wikiBaseUrl`、`wikiHomeUrl` 等。`appSecret` 不随仓库分发。

4. **使用**

   左侧「技术文件起草」→ 新建技术文件 / 新建预审 → 按步骤推进。

完整的安装、权限、配置和常见问题见知识库「技术文件起草插件安装指南（图文）」：
https://govy.feishu.cn/wiki/VaWSwJDrGiElApkOLThcI1qGn8b

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
| `jswj_task_update` | 写回生成 / 预审 / 成稿修订结果 |

## 验证状态

- `node --check` 入口通过；11 个文件语法检查通过。
- 页面数据通道 `POST /api/jswj` 实测：任务创建、门禁拒绝、逐步推进、发布、清理全部通过。
- 起草 D1–D7 与预审 R1–R5 通过接口完整跑通，出稿节点生成后已删除。
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
