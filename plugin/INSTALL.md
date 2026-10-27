# 技术文件起草（JSWJ_DraftbyDSH）安装指南

适用版本：`0.7.0-beta.6` ｜ 约 2 分钟 ｜ 全程图形界面，无需命令行

## 先看结论

三件事都满足才算装好：

1. 安装窗口显示「安装完成」。
2. 重开 DSH 后左侧出现「技术文件起草」。
3. 插件自检全部为绿色。

---

## 一、安装前准备

| 项 | 说明 |
|---|---|
| 系统 | Windows 10 或 11，自带 .NET Framework 4.8，无需另装 |
| DSH | 已安装，且**至少启动过一次**（要先生成 profile 目录） |
| 飞书应用 | 「GO秘」的 `appId` 与 `appSecret`，由管理员提供 |
| 安装包 | `JSWJ-Draft-Setup-0.7.0-beta.6.exe`，约 1 MB |

不需要 Node、不需要 Python、不需要 7-Zip、不需要管理员权限。

---

## 二、安装步骤

### 第 1 步：退出 DSH

关闭主窗口后，再检查右下角托盘图标，确保进程已退出。安装器会检查，未退出时直接提示。

### 第 2 步：双击安装器

Windows 提示「未知发布者」时，点「更多信息」→「仍要运行」。安装器未做代码签名，这个提示是正常的。

### 第 3 步：填写凭据

窗口中有两个输入框：

- `feishu appId`：以 `cli_` 开头
- `appSecret`：输入时显示为圆点

两项都从管理员处获取，**只保存在本机配置文件**，不会上传。

### 第 4 步：点「开始安装」

窗口下方会依次显示四步进度：

```text
检查安装包完整性
检查运行环境
复制插件文件到 %LOCALAPPDATA%\JSWJ-Draft\plugin
已登记 bundle：@govy/dsh-plugin-jswj-draft
已建立目录联接
已写入凭据配置
```

全部完成会弹出「安装完成」提示。

### 第 5 步：重新打开 DSH

左侧出现「技术文件起草」图标，点开即可使用。

### 第 6 步：插件自检

进入页面后，若顶部提示自检未通过，点「插件自检」。全部为绿色即配置正确；红色项按提示补齐凭据。

---

## 三、卸载

再次运行安装器，点右下角「卸载」。会移除插件文件、目录联接与凭据配置，**知识库中的文档不受影响**。

---

## 四、升级

直接运行新版本安装器即可，无需先卸载。安装器会自动：

- 覆盖插件文件
- 保留原有凭据配置并覆盖为新填写的值
- 备份 `package.json` 与 `cordis.patch.yml`（同目录 `.bak-setup-<时间戳>`）

---

## 五、常见问题

**双击没反应**

- 检查是否被杀毒软件拦截，加入信任后重试。
- 确认下载的是 `.exe` 安装器，且文件大小约 1 MB。

**提示「未找到 DSH profile」**

DSH 还没启动过。先打开一次 DSH，任意建一个会话，再退出重试。

**提示「检测到 DSH 正在运行」**

从托盘完全退出后再试。任务管理器里若还有 `DeepSeek Harness` 进程，结束它。

**装完了左侧没有入口**

1. 确认 DSH 是重开过的。
2. 打开 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，确认有 `- id: jswj-draft` 与 `appId`。
3. 仍不行时，查看同目录下 `package.json.bak-setup-<时间戳>`，与当前文件比对 `dsh.profile.bundles` 是否包含 `@govy/dsh-plugin-jswj-draft`。

**自检报凭据错误**

重新运行安装器，重新填写 `appId` / `appSecret`。安装器会覆盖旧配置。

---

## 六、安装器做了什么

| 步骤 | 动作 | 位置 |
|---|---|---|
| 1 | 复制插件文件 | `%LOCALAPPDATA%\JSWJ-Draft\plugin` |
| 2 | 登记依赖与 bundle | `%USERPROFILE%\.dsh\profiles\desktop\package.json` |
| 3 | 建立目录联接 | `...\profiles\desktop\node_modules\@govy\dsh-plugin-jswj-draft` |
| 4 | 写入凭据配置 | `...\profiles\desktop\cordis.patch.yml` |

修改前会备份原文件；任一步失败会回滚到安装前状态。
