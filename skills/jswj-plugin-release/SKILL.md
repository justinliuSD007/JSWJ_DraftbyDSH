---
name: jswj-plugin-release
description: 发布、打包、安装和更新「技术文件起草（JSWJ_DraftbyDSH）」插件时使用。覆盖：升版本与 Build 记录、打插件 zip、生成 Windows 一键安装器、创建 GitHub Release、更新公司插件市场索引、更新飞书图文安装指南、安装器故障排查。触发场景包括：发布插件、打包安装器、出安装包、更新 Release、更新市场索引、改安装指南、安装器弹解压框、版本号怎么写。不适用于技术文件起草/预审业务本身；业务流请用 jswj-draftbydsh。
---

# JSWJ_DraftbyDSH 插件发布与安装

这个 Skill 只负责“插件怎么发出去、怎么装上去”，不负责写技术文件。
业务流的执行规则在 `jswj-draftbydsh`，两者不要混用。

## 最高优先级规则

1. **Build 迭代 ≠ 发布。** 用户没有明确说“发布/出安装器/更新 Release”时，只改本地插件和 CHANGELOG，不生成安装器、不更新 zip、不更新 Release、不更新市场索引、不更新安装指南。
2. **版本号由用户决定。** 当前测试周期固定 `0.7.0-beta.1`，不要自行升 `beta.2`、`rc.1` 或 `0.7.0`。需要升版本时先确认，再统一改 package、安装器、zip、Release、市场索引、指南。
3. **安装器必须双击即安装。** 不能用普通 `7z.sfx`（只弹解压路径），必须用 `repo/tools/7zSD.sfx` + 配置文件 + 7z 包三段拼接。
4. **不泄露凭据。** `appId` / `appSecret` / GitHub PAT 不写进仓库、安装包、Release、文档、聊天记录。安装器只在用户本机提示输入。
5. **市场索引的 commit 必须是包含对应版本代码的 commit。** 不要指向只有文档改动的后续 commit。

## 路径与环境

| 名称 | 路径 |
|---|---|
| 工作根目录 | `D:\公司资料\Agent\业务流自动化` |
| 插件源码 | `D:\公司资料\Agent\业务流自动化\plugin\jswj-draft` |
| 打包脚本 | `D:\公司资料\Agent\业务流自动化\repo\pack-plugin.ps1` |
| 推送脚本 | `D:\公司资料\Agent\业务流自动化\repo\_push.ps1` |
| 产物目录 | `D:\公司资料\Agent\业务流自动化\repo\dist` |
| 安装器 SFX 模块 | `D:\公司资料\Agent\业务流自动化\repo\tools\7zSD.sfx` |
| 市场索引 | `D:\公司资料\Agent\业务流自动化\repo\market-index.json` |
| 变更记录 | `D:\公司资料\Agent\业务流自动化\repo\CHANGELOG.md` |
| GitHub 仓库 | `https://github.com/justinliuSD007/JSWJ_DraftbyDSH` |
| 飞书空间 | `技术资料起草库`，space_id `7698962670346636559` |
| 安装指南节点 | `Xi2JwTgwjinj8KkslupcbhTznWh` |
| 安装指南父节点 | `DiKCwz21ciRpkkkAMNoc4WyTnOf` |

当前安装指南地址：

```text
https://govy.feishu.cn/wiki/Xi2JwTgwjinj8KkslupcbhTznWh
```

## 一、判断当前任务

先问自己：用户要的是哪一种？

| 用户说 | 做什么 |
|---|---|
| “改一下界面/流程/逻辑” | 只改源码，`node --check`，重载插件，CHANGELOG 记 Build N；不打包 |
| “看看效果” | 重载插件，让用户刷新页面；不打包 |
| “发布/出安装器/更新市场/更新指南” | 走下面的完整发布流程 |
| “版本号改成 X” | 先确认，再统一改所有版本引用 |

不确定时，默认按“Build 迭代”处理，先不发布。

## 二、Build 迭代流程

1. 改 `plugin/jswj-draft` 源码。
2. 前端改动先检查语法：

```powershell
node --check "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft\lib\client.js"
```

3. 重载插件：

```text
plugin_manager action=set_bundle target=@govy/dsh-plugin-jswj-draft enabled=false
plugin_manager action=set_bundle target=@govy/dsh-plugin-jswj-draft enabled=true
```

4. 让用户刷新页面验证。
5. 在 `repo/CHANGELOG.md` 的迭代表追加：

```markdown
| Build N | 日期 | 变更摘要 | `commit` |
```

6. 提交并推送源码；**不要**生成安装器、zip、Release、市场索引。

## 三、正式发布流程

只有用户明确说“发布”才执行。

### 1. 确认版本

- 默认沿用 `0.7.0-beta.1`，只记 Build。
- 如果用户要求升版本，按 SemVer：
  - 测试版：`0.7.0-beta.2`
  - 候选版：`0.7.0-rc.1`
  - 正式版：`0.7.0`
- 统一修改：
  - `plugin/package.json` 的 `version`
  - `plugin/INSTALL.md` 的版本和安装器文件名
  - `repo/market-index.json` 的 `version`
  - Release 标题和 tag
  - 安装器、zip 文件名

### 2. 发布前检查

```powershell
node --check "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft\lib\client.js"
node --check "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft\lib\tasks.js"
node --check "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft\lib\index.js"
```

必要时运行：

```powershell
node "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft\selftest.mjs"
```

检查：

- 插件能重载
- 页面能打开
- `jswj_ping` 正常
- 模板存在
- 没有把 `appSecret` 写进仓库

### 3. 打插件 zip

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\公司资料\Agent\业务流自动化\repo\pack-plugin.ps1"
```

产物：

```text
repo\dist\jswj-draft-plugin-<version>.zip
```

检查 zip 里必须包含：

- `package.json`
- `lib/index.js`
- `lib/tasks.js`
- `lib/client.js`
- `python/render_docx.py`
- `template/GY-F003-cleaned.docx`
- `skills/jswj-draftbydsh/SKILL.md`
- `install.cmd`
- `install.ps1`
- `INSTALL.md` / `INSTALL.docx`
- `INSTALL.assets/install-oneclick.png`

### 4. 生成一键安装器（关键）

**不要**用：

```powershell
7z a -sfx7z.sfx setup.exe ...
```

普通 `7z.sfx` 只解压，会弹出“Extract to”路径选择，不是安装器。

正确做法：`7zSD.sfx` + 配置文件 + 7z 包，三段拼接。

```powershell
$plugin = "D:\公司资料\Agent\业务流自动化\plugin\jswj-draft"
$payload = Join-Path $env:TEMP "jswj-sfx-payload"
$archive = Join-Path $env:TEMP "jswj-setup.7z"
$config  = Join-Path $env:TEMP "jswj-setup-config.txt"
$out     = "D:\公司资料\Agent\业务流自动化\repo\dist\JSWJ-Draft-Setup-0.7.0-beta.1.exe"

Remove-Item $payload -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $payload | Out-Null
Copy-Item "$plugin\*" $payload -Recurse -Force

Remove-Item $archive -Force -ErrorAction SilentlyContinue
& "C:\Program Files\7-Zip\7z.exe" a -t7z -mx=9 $archive "$payload\*" | Out-Null

$cfg = @"
;!@Install@!UTF-8!
Title="技术文件起草插件 0.7.0 Beta 1 安装"
BeginPrompt="安装技术文件起草（JSWJ_DraftbyDSH）0.7.0 Beta 1？"
RunProgram="install.cmd"
;!@InstallEnd@!
"@
[IO.File]::WriteAllText($config, $cfg, (New-Object Text.UTF8Encoding($false)))

Remove-Item $out -Force -ErrorAction SilentlyContinue
cmd /c copy /b "D:\公司资料\Agent\业务流自动化\repo\tools\7zSD.sfx" + "$config" + "$archive" "$out" | Out-Null
```

注意：

- 配置文件必须是 UTF-8，无 BOM。
- 配置文件在 exe 外面拼接，不能只放进 7z 包里。
- 顺序必须是 `SFX + config + archive`。
- `RunProgram="install.cmd"`，不要写绝对路径。
- 用 `7zSD.sfx`，不要用 `7z.sfx` 或 `7zCon.sfx`。

### 5. 验证安装器

至少检查：

```powershell
& "C:\Program Files\7-Zip\7z.exe" l "repo\dist\JSWJ-Draft-Setup-<version>.exe"
```

能看到 7z 头和 offset。

更可靠的做法：做一个小 payload（`test.cmd` 写一个临时标记），用同样的 SFX 拼接方式生成测试 exe，双击运行，确认标记生成且**没有解压路径对话框**。验证完删除测试文件。

不要在没有关闭 DSH 的本机直接跑正式安装器；要测安装逻辑，用临时 profile：

```powershell
powershell -File install.ps1 -ProfileDir <临时目录> -InstallDir <临时目录>\plugin -SourceDir <插件目录> -AppId test -AppSecret test -SkipProcessCheck
```

### 6. 创建或更新 GitHub Release

- Release tag：`v<version>`
- 标题：`v<version>（第一版测试）` 或对应说明
- 测试版必须 `prerelease: true`
- 资产：
  - `jswj-draft-plugin-<version>.zip`
  - `JSWJ-Draft-Setup-<version>.exe`

如果替换同一版本资产：

- 先删除旧 asset，再上传新 asset。
- 记录 Build 号，避免用户分不清。

GitHub PAT 从本机文件读取，不要打印：

```text
C:\Users\LiuHanxuan\Downloads\Github_PAT for JSWJ_DraftbyDSH.txt
```

### 7. 更新市场索引

`repo/market-index.json` 最少改三处：

```json
"version": "<version>",
"publishTimestamp": <当前秒级时间戳>,
"source": {
  "commit": "<包含该版本代码的 40 位 commit>"
}
```

要求：

- `version` 必须等于 `package.json` 的版本。
- `commit` 必须是包含该版本代码的 commit，不是后续只改文档的 commit。
- 推送到仓库根目录的 `market-index.json`。
- 市场缓存默认 10 分钟；验证时可用 `plugin_market` 查询，必要时等缓存过期。

### 8. 更新 CHANGELOG

在 `repo/CHANGELOG.md` 记录：

- 版本
- Build
- 日期
- 变更
- commit

已发布版本不静默覆盖；如果覆盖同版本资产，必须记录 Build 差异。

### 9. 更新安装指南

本地：

- `plugin/jswj-draft/INSTALL.md`
- `plugin/jswj-draft/INSTALL.docx`
- `plugin/jswj-draft/INSTALL.assets/install-oneclick.png`

飞书：

- 安装指南节点：`Xi2JwTgwjinj8KkslupcbhTznWh`
- 父节点：`DiKCwz21ciRpkkkAMNoc4WyTnOf`

优先更新现有节点，不要每次新建重复文档。若要重新导入 docx：

1. 上传 docx 到云空间。
2. 导入为 docx。
3. 移动到安装指南父节点。
4. 用 `jswj_wiki_list` 确认新节点。
5. 删除旧节点，更新所有引用链接。

安装指南必须写清楚：

- 一键安装 6 步
- 安装前退出 DSH
- 输入 appId / appSecret
- 安装后重开 DSH
- 插件自检
- SmartScreen / 安全软件提示怎么处理
- 手动安装备用方案
- 常见问题
- 升级方式

### 10. 通知用户

给用户至少：

- 版本号
- Build 号
- 安装器文件名和大小
- Release 链接
- 市场索引是否已更新
- 本次变更摘要
- 已知问题

## 四、常见故障

### 安装器弹出 “7-Zip self-extracting archive / Extract to”

原因：用了普通 `7z.sfx`，或配置文件放进了 7z 包内而不是拼接在 exe 前面。

修复：

- 用 `repo/tools/7zSD.sfx`
- 用 `cmd /c copy /b 7zSD.sfx + config.txt + archive.7z setup.exe`
- 确认 config 是 UTF-8 无 BOM
- 确认 `RunProgram="install.cmd"` 存在

### 安装器双击没反应

- 检查 `install.cmd` 是否在 payload 根目录
- 检查 config 的 `RunProgram` 名称
- 检查杀软是否拦截
- 用测试 payload 验证 SFX 拼接

### 插件装上了但左侧没有入口

- 检查 profile `package.json` 的 `dsh.profile.bundles` 是否包含 `@govy/dsh-plugin-jswj-draft`
- 检查 `node_modules/@govy/dsh-plugin-jswj-draft` 链接
- 重启 DSH
- 检查 `cordis.patch.yml` 的 `jswj-draft` 配置

### 市场搜不到

- 检查索引 JSON 格式 `format: 1`
- 检查 `version` 是否与 package 一致
- 检查 `source.commit` 是否存在
- 检查索引 URL 是否返回 200
- 等缓存过期或刷新索引

## 五、发布检查清单

- [ ] 版本号统一
- [ ] `node --check` 通过
- [ ] 插件重载成功
- [ ] zip 内容完整
- [ ] 安装器双击直接安装，不弹解压路径
- [ ] 安装器能输入 appId/appSecret
- [ ] 安装后 DSH 能识别 bundle
- [ ] Release 是 Pre-release（测试版）
- [ ] 市场索引版本和 commit 正确
- [ ] CHANGELOG 已记录
- [ ] 安装指南已更新
- [ ] 没有泄露 appSecret / PAT
