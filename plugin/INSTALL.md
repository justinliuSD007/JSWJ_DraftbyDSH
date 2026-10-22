# 技术文件起草（JSWJ_DraftbyDSH）插件安装指南

本指南面向第一次安装本插件的同事。插件以 DSH bundle 形式交付，安装包内已经包含页面、工具、Word 模板、Python 渲染脚本和配套 Skill。

## 一、前置条件

- DSH 桌面端已安装并能正常打开。
- 获取飞书应用「GO秘」的详细信息：`appId`、`appSecret`（向应用管理员获取）。
- 当前知识库的访问权限已统一开通，无需自行创建知识空间或调整节点权限。

## 二、安装包内容

解压后目录结构：

```
jswj-draft/
├── package.json
├── lib/                页面、工具、任务存储
├── python/             Word 渲染与资料解析
├── template/           GY-F003 模板
├── skills/             配套 Skill（jswj-draftbydsh）
├── locale/
├── icon.svg
├── cordis.patch.yml    插件默认配置
├── config.example.yml  配置示例
└── INSTALL.md
```

## 三、安装插件

1. 把 zip 解压到一个固定目录，例如 `D:\DSH\plugins\jswj-draft`。
2. 打开 DSH 的插件管理，选择「安装本地 bundle」，指向解压后的 `jswj-draft` 目录（该目录下必须有 `package.json`）。
3. 安装完成后重载或重启 DSH。
4. 左侧应出现「技术文件起草」入口。

如果使用终端里的 DSH 助手，可以直接说：

> 安装本地 bundle：`D:\DSH\plugins\jswj-draft`

安装入口以你所用 DSH 版本的插件管理/本地 bundle 安装能力为准，不需要手工执行 `npm install`。

## 四、配置

把 `config.example.yml` 的内容复制到：

```
%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
```

- `appId` / `appSecret`：填飞书应用「GO秘」的详细信息。
- `spaceId`、`draftRootToken`、`wikiBaseUrl`、`wikiHomeUrl`、`summaryWikiToken`：当前知识库已统一配置，通常无需修改。
- `pythonPath` / `outputDir`：留空即可。

> 安全要求：`appSecret` 只放在本机 profile 配置里，不要写进安装包、仓库或聊天记录。

## 五、Skill

安装包已包含 `skills/jswj-draftbydsh/SKILL.md`，正常安装后 DSH 会自动加载。

如果安装后助手没有识别到技能，可手工复制：

```
skills\jswj-draftbydsh  →  %USERPROFILE%\.dsh\skills\jswj-draftbydsh
```

然后重载 DSH。

## 六、首次自检

1. 打开左侧「技术文件起草」。
2. 新建一个技术文件任务。
3. 让助手执行 `jswj_ping`，确认：
   - 飞书凭据有效
   - 知识空间可访问
   - GY-F003 模板存在
   - Python 运行时可用

自检通过后即可按 7 步流程起草：基本信息 → 文档属性 → 参考资料 → 大纲与纲要 → 生成 → 成稿确认 → 出稿。

## 七、目录约定

- 草稿 / 预览：`技术资料草稿库 / {层级} / {板块} / {文件类型} /`
- 正式出稿（飞书审批）：`出稿库 / 飞书审批 / {层级} / {板块} /`
- 正式出稿（Polarion）：`出稿库 / Polarion / {项目空间} /`
- 参考资料：`资料库 / {层级} / {板块} /`

## 八、常见问题

| 现象 | 处理 |
|---|---|
| 页面没有「技术文件起草」 | 确认 bundle 已启用并重载 DSH |
| `jswj_ping` 报凭据错误 | 检查「GO秘」的 appId/appSecret，确认应用未停用 |
| 上传报 20 MB 限制 | 压缩图片或拆分文件 |
| 页面提示字体缺失 | 安装 HarmonyOS Sans SC；字体有授权限制，不随安装包分发 |
| 出稿库没有文件 | 确认第 2 步归档位置选的是飞书审批或 Polarion |
| 任务总结没有写入多维表格 | 检查 `summaryWikiToken` 配置 |

## 九、升级与卸载

- 升级：用新版本目录替换旧目录，在插件管理中重载 bundle；任务数据保存在 `~/.dsh/jswj-tasks`，不会丢。
- 卸载：在插件管理中停用/移除 bundle；是否删除 `~/.dsh/skills/jswj-draftbydsh` 和任务数据由你决定。
