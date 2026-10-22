# 技术文件起草（JSWJ_DraftbyDSH）插件安装指南

本指南面向第一次安装本插件的同事。插件以 DSH bundle 形式交付，安装包内已经包含页面、工具、Word 模板、Python 渲染脚本和配套 Skill。

## 一、前置条件

- DSH 桌面端已安装并能正常打开。
- 获取飞书应用「GO秘」的详细信息：appId、appSecret（向应用管理员获取）。
- 当前知识库的访问权限已统一开通，无需自行创建知识空间或调整节点权限。

## 二、安装包内容

解压后的 jswj-draft 目录包含：

- package.json：插件清单
- lib：页面、工具、任务存储
- python：Word 渲染与资料解析
- template：GY-F003 模板
- skills：配套 Skill（jswj-draftbydsh）
- locale：中英文资源
- icon.svg：插件图标
- cordis.patch.yml：插件默认配置
- config.example.yml：配置示例
- INSTALL.md：本说明

## 三、安装插件

1. 把 zip 解压到一个固定目录，例如 D:\DSH\plugins\jswj-draft。
2. 打开 DSH 的插件管理，选择「安装本地 bundle」。
3. 指向解压后的 jswj-draft 目录，该目录下必须有 package.json。
4. 安装完成后重载或重启 DSH。
5. 左侧出现「技术文件起草」入口，即安装完成。

如果使用终端里的 DSH 助手，可以直接说：安装本地 bundle，路径是 D:\DSH\plugins\jswj-draft。

不需要手工执行 npm install，也不需要单独复制 Skill 或改页面代码。

## 四、配置

把 config.example.yml 的内容复制到本机 profile：

- Windows 路径：%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml

需要填写的内容：

- appId / appSecret：填飞书应用「GO秘」的详细信息。
- spaceId、draftRootToken、wikiBaseUrl、wikiHomeUrl、summaryWikiToken：当前知识库已统一配置，通常无需修改。
- pythonPath / outputDir：留空即可。
- githubToken：不需要，仓库已公开，检查更新直接读取 GitHub release。

安全要求：appSecret 只放在本机 profile 配置里，不要写进安装包、仓库或聊天记录。

## 五、Skill

安装包已包含 skills/jswj-draftbydsh/SKILL.md。

插件启动时会自动把 Skill 写入本机技能目录，正常安装后不需要手工加载，也不需要再复制一次。

如果助手仍然没有识别到技能，重载 DSH 后再试；仍不行时，把安装包里的 skills/jswj-draftbydsh 目录复制到 %USERPROFILE%\.dsh\skills\ 下。

## 六、首次自检

首页右上角有「插件自检」按钮。如果 APP ID / Secret 未写入，首页顶部会直接显示红色提示。

也可以按下面的顺序确认：

1. 打开左侧「技术文件起草」。
2. 新建一个技术文件任务。
3. 让助手执行 jswj_ping，确认飞书凭据、知识空间、GY-F003 模板和 Python 运行时都可用。

自检通过后即可按 7 步流程起草：基本信息 → 文档属性 → 参考资料 → 大纲与纲要 → 生成 → 成稿确认 → 出稿。

## 七、目录约定

- 草稿与预览：技术资料草稿库 / 层级 / 板块 / 文件类型 /
- 正式出稿（飞书审批）：出稿库 / 飞书审批 / 层级 / 板块 /
- 正式出稿（Polarion）：出稿库 / Polarion / 项目空间 /
- 参考资料：资料库 / 层级 / 板块 /

## 八、检查更新

- 任务列表右上角有「检查更新」。
- 插件会读取 GitHub 仓库的最新 release 或 tag，并与本机版本比较。
- 有更新时，可以点「下载更新包」，更新包会下载到 ~/.dsh/jswj-updates。
- 下载后，用 DSH 插件管理把新包覆盖安装到原目录，再重载 DSH，任务数据不受影响。

仓库是公开的，检查更新不需要配置令牌；网络无法访问 GitHub 时会提示失败，不影响起草和出稿。

## 九、常见问题

- 页面没有「技术文件起草」：确认 bundle 已启用并重载 DSH。
- jswj_ping 报凭据错误：检查「GO秘」的 appId/appSecret，确认应用未停用。
- 上传报 20 MB 限制：压缩图片或拆分文件。
- 页面提示字体缺失：安装 HarmonyOS Sans SC；字体有授权限制，不随安装包分发。
- 出稿库没有文件：确认第 2 步归档位置选的是飞书审批或 Polarion。
- 任务总结没有写入多维表格：检查 summaryWikiToken 配置。
- 检查更新提示无法访问 GitHub：检查网络，或直接打开仓库 release 页面下载。

## 十、升级与卸载

- 升级：下载新版本 zip，用插件管理覆盖安装到原目录，重载 DSH；任务数据保存在 ~/.dsh/jswj-tasks，不会丢。
- 卸载：在插件管理中停用或移除 bundle；是否删除 ~/.dsh/skills/jswj-draftbydsh 和任务数据由你决定。
