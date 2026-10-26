# 技术文件起草（JSWJ_DraftbyDSH）安装指南

适用版本：`0.7.0-beta.1` ｜ 一键安装 ｜ 约 2 分钟

![一键安装流程](INSTALL.assets/install-oneclick.png)

安装包已经包含页面、工具、Word 模板、Python 渲染脚本和配套 Skill。不需要执行 `npm install`，也不需要手工复制 Skill。

## 一键安装（推荐）

1. 下载 `JSWJ-Draft-Setup-0.7.0-beta.1.exe`。
2. 完全退出 DSH（不是最小化）。
3. 双击安装器，按提示输入飞书应用「GO秘」的 `appId` 和 `appSecret`。
4. 安装器自动完成：
   - 解压插件到本机固定目录
   - 登记 DSH bundle
   - 建立本地依赖
   - 写入 GO秘 配置
5. 安装完成后重新打开 DSH。
6. 左侧打开「技术文件起草」，点「插件自检」，绿色通过即可使用。

> 安装器不会上传 `appSecret`，只写入本机 DSH profile。首次安装需要输入一次，后续升级不需要重新输入。

## 手动安装（备用）

如果安装器被安全软件拦截，或需要装到自定义目录，按下面手动步骤操作。

## 一、安装前准备

需要准备两样东西：

- 一台已安装 DSH 桌面端的电脑，DSH 能正常打开。
- 飞书应用「GO秘」的 `appId` 和 `appSecret`，向应用管理员获取。

知识空间、草稿库、出稿库和总结表已经统一配置，通常不需要改动。

> `appSecret` 只放在本机配置文件里。不要写进安装包、仓库、聊天记录或群文件。

## 二、获取并解压安装包

1. 打开 GitHub Release 页面：

   https://github.com/justinliuSD007/JSWJ_DraftbyDSH/releases

2. 下载最新安装包，文件名类似：

   `jswj-draft-plugin-0.6.9.zip`

3. 解压到一个固定目录，例如：

   `D:\DSH\plugins\jswj-draft`

4. 打开该目录，必须能看到 `package.json`。

![解压后的目录](INSTALL.assets/install-folder.png)

注意：

- 不要直接在 zip 压缩包里运行。
- 不要把解压出来的文件夹再套一层，`package.json` 必须在 `jswj-draft` 这一层。
- 不要放在系统临时目录，后续升级会找不到原目录。

## 三、安装 Bundle

1. 打开 DSH。
2. 进入「插件管理」。
3. 选择「安装本地 bundle」。
4. 选择刚才解压的 `jswj-draft` 目录，也就是包含 `package.json` 的那一层。
5. 安装完成后启用插件，并重载 DSH。

安装成功后，左侧导航会出现「技术文件起草」。

如果使用终端里的 DSH 助手，也可以直接说：

```text
安装本地 bundle，路径是 D:\DSH\plugins\jswj-draft
```

## 四、配置 GO秘 凭据

1. 先关闭 DSH，避免配置被覆盖。
2. 打开本机 profile 配置文件：

   `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`

3. 在文件末尾追加下面的配置块：

```yaml
- id: jswj-draft
  config:
    appId: "cli_xxxxxxxxxxxxxxxx"
    appSecret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    spaceId: "7698962670346636559"
    draftRootToken: "K3NpwxFzribxgOkzFxaczeH7nXf"
    wikiBaseUrl: "https://govy.feishu.cn"
    summaryWikiToken: "P77ZwJyDIiIfoJkmUVccrk7mnfc"
```

4. 只改 `appId` 和 `appSecret`，其他项保持预置值。
5. 保存文件，重新打开 DSH。

![配置凭据](INSTALL.assets/install-config.png)

注意：

- 如果 profile 里已经有 `- id: jswj-draft` 段，只改其中的 `appId` / `appSecret`，不要重复追加。
- `appId` / `appSecret` 不要带多余空格，也不要填 DSH 账号密码。
- 如果应用管理员重置过 Secret，需要同步更新这里。

## 五、插件自检

1. 打开左侧「技术文件起草」。
2. 首页顶部应显示绿色「插件自检通过」。
3. 如果显示红色，按提示补 `appId` / `appSecret`，或重载 DSH 后再试。

![安装完成后的自检](INSTALL.assets/install-check.png)

自检会检查：

- 飞书应用 GO秘
- 知识空间与草稿库
- GY-F003 模板
- Python 运行时
- 配套 Skill `jswj-draftbydsh`

自检通过后，就可以新建任务，按 7 步流程起草：

`基本信息 → 文档属性 → 参考资料 → 大纲与纲要 → 生成 → 成稿确认 → 出稿`

## 六、目录约定

- 草稿与预览：`技术资料草稿库 / 层级 / 板块 / 文件类型 /`
- 正式出稿（飞书审批）：`技术资料出稿库 / 飞书审批 / 层级 / 板块 /`
- 正式出稿（Polarion）：`技术资料出稿库 / Polarion / 项目空间 /`
- 参考资料：`参考资料库 / 层级 / 板块 /`

## 七、升级与卸载

升级：

1. 下载新版本 zip。
2. 用插件管理覆盖安装到原目录。
3. 重载 DSH。

任务数据保存在 `~/.dsh/jswj-tasks`，升级不会丢失。

卸载：

- 在插件管理中停用或移除 bundle。
- 是否删除 `~/.dsh/skills/jswj-draftbydsh` 和任务数据由你决定。

## 八、常见问题

- 左侧没有「技术文件起草」：确认 bundle 已启用，并重载 DSH。
- 自检报凭据错误：检查「GO秘」的 `appId` / `appSecret`，确认应用未停用。
- 检查更新失败：仓库已公开，通常为网络无法访问 GitHub；不影响起草和出稿。
- 上传提示 20 MB 限制：压缩图片或拆分文件。
- 页面提示字体缺失：安装 HarmonyOS Sans SC；字体有授权限制，不随安装包分发。
- 出稿库没有文件：确认第 2 步归档位置选的是飞书审批或 Polarion。
- 任务总结没有写入多维表格：检查 `summaryWikiToken` 配置。

## 九、安全要求

- `appSecret` 只放在本机 profile 配置里。
- 不要把 profile 文件、安装包或截图中的 Secret 发到群里。
- 安装包和仓库里不保存任何真实凭据。
