/**
 * @govy/dsh-plugin-jswj-draft（JSWJ_DraftbyDSH）
 *
 * 服务端入口：7 个工具，覆盖「知识库读写 → Word 套版出稿 → 发布回知识库」整条链路。
 *
 * 设计约束：
 * 1. 全部为出站调用，不订阅飞书事件，因此无需公网回调地址。
 * 2. 配置来自 profile 的 cordis.patch.yml（见 cordis.patch.yml 与本包 README）。
 * 3. 宿主包 @deepseek-ai/dsh-tools 用动态 import 并兜底，脱离宿主时仍可加载。
 */

const name = "jswj-draft";
const inject = ["tools"];

const API = "https://open.feishu.cn/open-apis";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

let defineTool;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {
  // 独立测试环境没有宿主包：defineTool 只是类型辅助，退化为恒等函数。
  defineTool = (spec) => spec;
}

const { stat, mkdir, writeFile, unlink, readFile, readdir, copyFile } = await import("node:fs/promises");
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { fileURLToPath } = await import("node:url");
const { join, basename, isAbsolute, extname, dirname } = await import("node:path");
const { homedir, tmpdir } = await import("node:os");

import { createTask, deleteTask, getTask, listTasks, patchTask, stepsOf, submitStep } from "./tasks.js";

const execFileAsync = promisify(execFile);

/** 租户令牌缓存：提前 5 分钟过期，避免边界失效。 */
const tokenCache = { value: "", expiresAt: 0 };

function fail(message) {
  throw new Error(message);
}

function requireConfig(cfg, keys) {
  const missing = keys.filter((k) => !String(cfg[k] ?? "").trim());
  if (missing.length) {
    fail(`缺少配置 ${missing.join("、")}。请在 cordis.patch.yml 的 jswj-draft 条目 config 中填写，或设置对应环境变量。`);
  }
}

async function request(url, init = {}, retry = true) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(`飞书返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`);
  }
  // 99991663 = tenant_access_token invalid，换一次令牌即可
  if (data.code === 99991663 && retry) {
    tokenCache.expiresAt = 0;
    return request(url, init, false);
  }
  if (data.code !== 0) {
    const detail = raw.includes("error") ? `（log_id: ${data.error?.log_id ?? "n/a"}）` : "";
    fail(`飞书接口错误 ${data.code}：${data.msg}${detail}`);
  }
  return data.data;
}

async function getToken(cfg) {
  requireConfig(cfg, ["appId", "appSecret"]);
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const res = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (data.code !== 0) fail(`换取 tenant_access_token 失败 ${data.code}：${data.msg}`);
  tokenCache.value = data.tenant_access_token;
  tokenCache.expiresAt = now + Math.max(60, (data.expire ?? 7200) - 300) * 1000;
  return tokenCache.value;
}

async function api(cfg, path, init = {}) {
  const token = await getToken(cfg);
  const headers = { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) };
  if (init.body !== undefined && typeof init.body === "string") {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }
  return request(`${API}${path}`, { ...init, headers });
}

/** 从完整链接或纯 token 中取出 wiki 节点 token / 文档 token。 */
function pickToken(input) {
  const s = String(input ?? "").trim();
  const wiki = s.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wiki) return wiki[1];
  const docx = s.match(/\/docx\/([A-Za-z0-9]+)/);
  if (docx) return docx[1];
  const file = s.match(/\/file\/([A-Za-z0-9]+)/);
  if (file) return file[1];
  return s;
}

const text = (value) => [
  { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
];

/** 工具输出 schema 的最小构造器：必须显式声明 additionalProperties。 */
const objectSchema = (properties) => ({ type: "object", additionalProperties: false, properties });
const str = (description, required = false) => ({
  type: "string",
  description,
  ...(required ? { required: true } : {}),
});
const nullableStr = (description) => ({ type: "string", description });

function spaceRoot(cfg) {
  if (!cfg.spaceId) fail("缺少配置 spaceId（知识空间 ID）");
  return cfg.spaceId;
}

function resolvePython(cfg) {
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  const candidates = [];
  if (process.env.JSWJ_PYTHON) candidates.push(process.env.JSWJ_PYTHON);
  if (cfg.pythonPath) candidates.push(cfg.pythonPath);
  candidates.push(
    join(dshHome, "dsh-runtimes", "dsh-primary-runtime", "dependencies", "python", process.platform === "win32" ? "python.exe" : "python"),
  );
  candidates.push(process.platform === "win32" ? "python.exe" : "python3", "python");
  return candidates;
}

async function pickPython(cfg) {
  for (const candidate of resolvePython(cfg)) {
    if (!isAbsolute(candidate)) return candidate; // PATH 上的 python，交给执行时判断
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  fail("找不到可用的 Python。请安装 Python 3 与 python-docx，或在配置中填写 pythonPath。");
}

function packageFile(relative) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function safeName(input, fallback) {
  const cleaned = String(input ?? "")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

async function pollMoveTask(cfg, taskId, attempts = 12, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const data = await api(cfg, `/wiki/v2/tasks/${encodeURIComponent(taskId)}?task_type=move`);
    const task = data.task;
    const results = task?.move_result ?? [];
    const node = results.find((r) => r?.node)?.node;
    if (node) return node;
    const simple = task?.simple_task_result;
    if (simple?.status && simple.status !== "success" && simple.status !== "processing") {
      fail(`移动任务失败：${simple.status}${simple.status_msg ? `（${simple.status_msg}）` : ""}`);
    }
  }
  return null;
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

/**
 * 页面唯一的数据入口：任务读写、门禁推进、文档解析、发布。
 * 只接受同源页面发起的 POST，并要求 x-jswj 头，避免其它本地页面顺手调用。
 */
const FONT_FAMILY = "HarmonyOS Sans SC";
const FONT_REG_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const FONT_FILES = [
  ["HarmonyOS_Sans_SC_Thin.ttf", "HarmonyOS Sans SC Thin (TrueType)"],
  ["HarmonyOS_Sans_SC_Light.ttf", "HarmonyOS Sans SC Light (TrueType)"],
  ["HarmonyOS_Sans_SC_Regular.ttf", "HarmonyOS Sans SC (TrueType)"],
  ["HarmonyOS_Sans_SC_Medium.ttf", "HarmonyOS Sans SC Medium (TrueType)"],
  ["HarmonyOS_Sans_SC_Bold.ttf", "HarmonyOS Sans SC Bold (TrueType)"],
  ["HarmonyOS_Sans_SC_Black.ttf", "HarmonyOS Sans SC Black (TrueType)"],
];

async function findFontSource(cfg) {
  const candidates = [
    cfg.fontDir,
    join(homedir(), "Desktop", "高域VIS（可外发）", "03-鸿蒙字体（对外仅可用该字体）"),
    join(homedir(), "Desktop", "鸿蒙字体（对外仅可用该字体）"),
    join(homedir(), "Downloads", "鸿蒙字体（对外仅可用该字体）"),
    packageFile("fonts"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      const names = await readdir(dir);
      if (names.some((name) => name === "HarmonyOS_Sans_SC_Regular.ttf")) return dir;
    } catch {
      /* 继续找下一个候选目录 */
    }
  }
  return "";
}

async function fontStatus(cfg) {
  if (process.platform !== "win32") {
    return { supported: false, installed: false, family: FONT_FAMILY, sourceDir: "", note: "非 Windows 系统请手动安装字体" };
  }
  let registry = false;
  try {
    const { stdout } = await execFileAsync("reg", ["query", FONT_REG_KEY]);
    registry = stdout.includes("HarmonyOS Sans SC");
  } catch {
    registry = false;
  }
  const dirs = [
    join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Microsoft", "Windows", "Fonts"),
    join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
  ];
  let files = 0;
  for (const dir of dirs) {
    try {
      files += (await readdir(dir)).filter((name) => /^HarmonyOS_Sans_SC_.*\.ttf$/i.test(name)).length;
    } catch {
      /* 目录不存在时跳过 */
    }
  }
  const sourceDir = await findFontSource(cfg);
  return {
    supported: true,
    installed: registry && files > 0,
    family: FONT_FAMILY,
    registry,
    files,
    sourceDir,
    sourceAvailable: Boolean(sourceDir),
  };
}

async function installHarmonyFont(cfg) {
  if (process.platform !== "win32") fail("当前只支持 Windows 自动安装；macOS 请双击 ttf 安装到字体册。");
  const status = await fontStatus(cfg);
  if (status.installed) {
    return { installed: true, alreadyInstalled: true, copied: 0, family: FONT_FAMILY, restartRequired: false };
  }
  const sourceDir = await findFontSource(cfg);
  if (!sourceDir) {
    fail(
      "找不到鸿蒙字体目录。可在配置里填写 fontDir，或把 HarmonyOS_Sans_SC_*.ttf 放到桌面「鸿蒙字体（对外仅可用该字体）」目录后重试。",
    );
  }
  const dest = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Microsoft", "Windows", "Fonts");
  await mkdir(dest, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const [file, regName] of FONT_FILES) {
    const src = join(sourceDir, file);
    try {
      await stat(src);
    } catch {
      continue;
    }
    const dst = join(dest, file);
    try {
      await copyFile(src, dst);
      copied += 1;
    } catch (err) {
      // 字体已存在且被系统占用时无法覆盖，只要注册表登记成功就算可用。
      if (err && (err.code === "EBUSY" || err.code === "EPERM")) skipped += 1;
      else throw err;
    }
    await execFileAsync("reg", ["add", FONT_REG_KEY, "/v", regName, "/t", "REG_SZ", "/d", dst, "/f"]);
  }
  if (copied === 0 && skipped === 0) fail(`字体目录里没有可安装的 ttf：${sourceDir}`);
  return { installed: true, copied, skipped, sourceDir, family: FONT_FAMILY, restartRequired: copied > 0 || skipped > 0 };
}

async function extractSourceText(cfg, filePath, ext) {
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    return await readFile(filePath, "utf8");
  }
  if (ext === ".docx") {
    const python = await pickPython(cfg);
    const script = packageFile("python/extract_text.py");
    const { stdout } = await execFileAsync(python, [script, "--file", filePath], {
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    const line = stdout
      .split(/\r?\n/)
      .reverse()
      .find((item) => item.startsWith("JSWJ_TEXT "));
    if (!line) fail("docx 解析失败：解析器没有返回文本");
    try {
      return JSON.parse(line.slice("JSWJ_TEXT ".length)).text ?? "";
    } catch {
      fail("docx 解析失败：返回结果无法解析");
    }
  }
  fail(`暂不支持 ${ext}，请上传 .docx、.md、.markdown 或 .txt`);
}

async function ensureWikiChild(cfg, parent, title) {
  const space = spaceRoot(cfg);
  const query = parent ? `&parent_node_token=${encodeURIComponent(parent)}` : "";
  const listed = await api(cfg, `/wiki/v2/spaces/${space}/nodes?page_size=50${query}`);
  const found = (listed.items ?? []).find((item) => item.title === title);
  if (found) return found.node_token;
  const body = { obj_type: "docx", node_type: "origin", title };
  if (parent) body.parent_node_token = parent;
  const made = await api(cfg, `/wiki/v2/spaces/${space}/nodes`, { method: "POST", body: JSON.stringify(body) });
  const token = made.node?.node_token;
  if (!token) fail(`创建知识库目录失败：${title}`);
  return token;
}

async function uploadFileToWiki(cfg, filePath, parent, name) {
  const info = await stat(filePath);
  if (info.size === 0) fail("文件为空，无法上传。");
  if (info.size > MAX_UPLOAD_BYTES) fail(`文件 ${(info.size / 1024 / 1024).toFixed(1)} MB，超过飞书 20 MB 上限。`);
  const buffer = await readFile(filePath);
  const token = await getToken(cfg);
  const form = new FormData();
  form.append("file_name", name);
  form.append("parent_type", "explorer");
  form.append("parent_node", "");
  form.append("size", String(info.size));
  form.append("file", new Blob([buffer]), name);
  const uploaded = await request(
    `${API}/drive/v1/files/upload_all`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    true,
  );
  const fileToken = uploaded.file_token;
  if (!fileToken) fail("上传成功但没有返回 file_token。");
  const moveBody = { obj_type: "file", obj_token: fileToken };
  if (parent) moveBody.parent_wiki_token = parent;
  const moved = await api(cfg, `/wiki/v2/spaces/${spaceRoot(cfg)}/nodes/move_docs_to_wiki`, {
    method: "POST",
    body: JSON.stringify(moveBody),
  });
  let wikiToken = moved.wiki_token;
  if (!wikiToken && moved.task_id) {
    const node = await pollMoveTask(cfg, moved.task_id);
    wikiToken = node?.node_token;
  }
  if (!wikiToken) fail("文件已上传但移入知识库超时，请稍后在知识库中确认。");
  const host = String(uploaded.url ?? "").match(/^https:\/\/([^/]+)/)?.[1] ?? "feishu.cn";
  return { wikiToken, objToken: fileToken, url: `https://${host}/wiki/${wikiToken}`, size: info.size, title: name };
}

async function handleJswjRequest(req, res, { ctx, webServer, cfg }) {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "只支持 POST" });
      return;
    }
    if (req.headers["x-jswj"] !== "1") {
      sendJson(res, 403, { ok: false, error: "缺少 x-jswj 头" });
      return;
    }
    const origin = webServer.getOrigin();
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      const sameHost = reqOrigin === origin || reqOrigin.replace("://localhost", "://127.0.0.1") === origin;
      if (!sameHost) {
        sendJson(res, 403, { ok: false, error: "跨源请求被拒绝" });
        return;
      }
    }

    const body = JSON.parse(await readJsonBody(req, 30 * 1024 * 1024));
    const tool = (toolName) => {
      const found = ctx.tools.get(toolName);
      if (!found) throw new Error(`工具不可用：${toolName}`);
      return found;
    };

    let value;
    switch (String(body.action ?? "")) {
      case "ping":
        value = await tool("jswj_ping").execute({}, {});
        break;
      case "tasks.list":
        value = await listTasks();
        break;
      case "tasks.get":
        value = await getTask(String(body.id ?? ""));
        break;
      case "tasks.create":
        value = await createTask(String(body.flow ?? "draft"));
        break;
      case "tasks.patch":
        value = await patchTask(String(body.id ?? ""), body.patch ?? {});
        break;
      case "tasks.step": {
        const updated = await submitStep(String(body.id ?? ""), Number(body.step), body.data ?? {});
        let archivedSessions = 0;
        if (updated.status === "completed") {
          const registry = ctx.get("workspaceRegistry");
          const sessions = updated.data?.sessions || {};
          if (registry) {
            for (const entry of Object.values(sessions)) {
              const sessionId = entry && entry.sessionId;
              if (!sessionId) continue;
              try {
                await registry.archiveSession(sessionId, { stopActivity: true });
                archivedSessions += 1;
              } catch {
                /* 单个会话归档失败不阻塞任务完成 */
              }
            }
          }
        }
        if (updated.status === "completed") {
          await patchTask(updated.id, { archivedSessions });
          updated.archivedSessions = archivedSessions;
        }
        value = { ...updated, archivedSessions };
        break;
      }
      case "session.start": {
        const controller = ctx.get("sessionController");
        if (!controller) throw new Error("sessionController 不可用，无法新建会话");
        const text = String(body.text ?? "").trim();
        if (!text) throw new Error("text 不能为空");

        // 固定使用「技术文件起草」工作区：不存在则创建，所有任务会话都归到这里。
        let workspaceId;
        const registry = ctx.get("workspaceRegistry");
        if (registry) {
          const existing = registry.list().find((workspace) => workspace.title === "技术文件起草");
          if (existing) {
            workspaceId = existing.id;
          } else {
            const dir = join(homedir(), "技术文件起草");
            await mkdir(dir, { recursive: true });
            const workspace = await registry.create(dir, "技术文件起草");
            workspaceId = workspace.id;
          }
        }

        const created = await controller.create(workspaceId ? { workspaceId } : {});
        const sessionId = created && created.sessionId;
        if (!sessionId) throw new Error("创建会话失败：未返回 sessionId");

        let renamed = false;
        if (body.title) {
          try {
            await controller.rename({ sessionId, title: String(body.title).trim().slice(0, 120) });
            renamed = true;
          } catch {
            renamed = false;
          }
        }

        // 记录任务与步骤的会话映射，页面可回到已有会话继续。
        if (body.taskId && body.step) {
          const task = await getTask(String(body.taskId));
          const sessions = {
            ...(task.data.sessions || {}),
            [String(body.step)]: {
              sessionId,
              title: String(body.title || ""),
              at: new Date().toISOString(),
            },
          };
          await patchTask(String(body.taskId), { data: { sessions } });
        }

        await controller.prompt(
          {
            requestId: crypto.randomUUID(),
            sessionId,
            mode: "queue",
            content: [{ type: "text", text }],
            clientTimeZone: body.timeZone ? String(body.timeZone) : undefined,
          },
          AbortSignal.timeout(30000),
        );
        value = { sessionId, workspaceId: workspaceId ?? null, workspaceTitle: "技术文件起草", renamed };
        break;
      }
      case "session.prompt": {
        const controller = ctx.get("sessionController");
        if (!controller) throw new Error("sessionController 不可用，无法投递指令");
        const sessionId = String(body.sessionId ?? "");
        const text = String(body.text ?? "").trim();
        if (!sessionId) throw new Error("sessionId 不能为空");
        if (!text) throw new Error("text 不能为空");
        await controller.prompt(
          {
            requestId: crypto.randomUUID(),
            sessionId,
            mode: "queue",
            content: [{ type: "text", text }],
            clientTimeZone: body.timeZone ? String(body.timeZone) : undefined,
          },
          AbortSignal.timeout(30000),
        );
        value = { sessionId };
        break;
      }
      case "session.archive": {
        const registry = ctx.get("workspaceRegistry");
        if (!registry) throw new Error("workspaceRegistry 不可用，无法归档会话");
        await registry.archiveSession(String(body.sessionId ?? ""), { stopActivity: true });
        value = { sessionId: String(body.sessionId ?? ""), archived: true };
        break;
      }
      case "draft.preview": {
        const task = await getTask(String(body.id ?? ""));
        const draft = task.data.draft || {};
        const markdown = String(body.markdown ?? draft.markdown ?? "");
        if (!markdown.trim()) throw new Error("成稿正文为空，先生成成稿再出预览");
        const version = Number(body.version ?? draft.version ?? 1);
        const baseName = task.data.basic?.name || "技术文件";
        const fileName = `${baseName}-草稿-v${version}.docx`;

        const library = cfg.draftRootToken || (await ensureWikiChild(cfg, cfg.rootToken || "", "技术资料草稿库"));
        const tierNode = await ensureWikiChild(cfg, library, String(task.data.attrs?.tier || "未分级"));
        const boardNode = await ensureWikiChild(cfg, tierNode, String(task.data.attrs?.board || "未分类"));
        const typeNode = await ensureWikiChild(cfg, boardNode, String(task.data.basic?.type || "未分类"));

        const renderArgs = { markdown, title: `${baseName}-草稿-v${version}` };
        if (task.data.basic?.classification) renderArgs.classification = task.data.basic.classification;
        const render = await tool("jswj_render_docx").execute(renderArgs, {});
        const published = await tool("jswj_publish_docx").execute({ filePath: render.path, parent: typeNode, name: fileName }, {});

        await patchTask(task.id, { data: { draft: { ...draft, markdown, version, previewVersion: version, url: published.url, nodeToken: published.wikiToken } } });
        value = {
          url: published.url,
          nodeToken: published.wikiToken,
          title: fileName,
          path: `技术资料起草库 / 技术资料草稿库 / ${task.data.attrs?.tier || "未分级"} / ${task.data.attrs?.board || "未分类"} / ${task.data.basic?.type || "未分类"} /`,
        };
        break;
      }
      case "draft.publish": {
        const task = await getTask(String(body.id ?? ""));
        const draft = task.data.draft || {};
        const markdown = String(draft.markdown ?? "");
        if (!markdown.trim()) throw new Error("成稿正文为空，先生成并确认成稿");
        const baseName = String(task.data.basic?.name || "技术文件");
        const number = String(task.data.basic?.number || "").trim();
        const fileName = `${number ? `${number}-` : ""}${baseName}.docx`;

        const library = cfg.draftRootToken || (await ensureWikiChild(cfg, cfg.rootToken || "", "技术资料草稿库"));
        const tierNode = await ensureWikiChild(cfg, library, String(task.data.attrs?.tier || "未分级"));
        const boardNode = await ensureWikiChild(cfg, tierNode, String(task.data.attrs?.board || "未分类"));
        const typeNode = await ensureWikiChild(cfg, boardNode, String(task.data.basic?.type || "未分类"));

        const oldToken = draft.nodeToken || (draft.url ? String(draft.url).split("/").filter(Boolean).pop() : "");
        const canRename =
          Boolean(oldToken) && Number(draft.previewVersion) === Number(draft.version) && Boolean(draft.url);

        let published = null;
        if (canRename) {
          try {
            await api(cfg, `/wiki/v2/spaces/${cfg.spaceId}/nodes/${oldToken}/update_title`, {
              method: "POST",
              body: JSON.stringify({ title: fileName }),
            });
            published = { url: draft.url, wikiToken: oldToken, path: "" };
          } catch {
            published = null;
          }
        }

        if (!published) {
          const renderArgs = { markdown, title: baseName };
          if (task.data.basic?.classification) renderArgs.classification = task.data.basic.classification;
          const render = await tool("jswj_render_docx").execute(renderArgs, {});
          published = await tool("jswj_publish_docx").execute({ filePath: render.path, parent: typeNode, name: fileName }, {});

          if (oldToken && oldToken !== published.wikiToken) {
            try {
              const old = await api(cfg, `/wiki/v2/spaces/get_node?token=${encodeURIComponent(oldToken)}`);
              const obj = old?.node?.obj_token;
              if (obj) {
                await api(cfg, `/wiki/v2/spaces/${cfg.spaceId}/nodes/${obj}`, {
                  method: "DELETE",
                  body: JSON.stringify({ obj_type: "file", include_children: true }),
                });
              }
            } catch {
              /* 旧草稿清理失败不影响正式出稿 */
            }
          }
        }

        await patchTask(task.id, {
          data: {
            publish: {
              url: published.url,
              nodeToken: published.wikiToken,
              filePath: published.path,
              title: fileName,
              at: new Date().toISOString(),
            },
            draft: { ...draft, url: published.url, nodeToken: published.wikiToken },
          },
        });
        value = {
          url: published.url,
          nodeToken: published.wikiToken,
          title: fileName,
          path: `技术资料起草库 / 技术资料草稿库 / ${task.data.attrs?.tier || "未分级"} / ${task.data.attrs?.board || "未分类"} / ${task.data.basic?.type || "未分类"} /`,
        };
        break;
      }
      case "tasks.delete":
        value = await deleteTask(String(body.id ?? ""));
        break;
      case "doc.read": {
        const doc = await tool("jswj_doc_read").execute({ target: String(body.target ?? "") }, {});
        const content = String(doc.content ?? "");
        value = {
          ok: true,
          title: doc.title ?? "",
          objToken: doc.objToken ?? "",
          chars: content.length,
          preview: content.slice(0, 240),
        };
        break;
      }
      case "source.upload": {
        const name = String(body.name ?? "上传资料").trim();
        const ext = extname(name).toLowerCase();
        if (![".docx", ".md", ".markdown", ".txt"].includes(ext)) {
          throw new Error("只支持 .docx / .md / .markdown / .txt");
        }
        const raw = String(body.dataBase64 ?? "");
        if (!raw) throw new Error("缺少文件内容");
        const buffer = Buffer.from(raw, "base64");
        if (buffer.length === 0) throw new Error("文件内容为空");
        if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("文件超过 20 MB，请压缩或拆分");

        const tmp = join(tmpdir(), `jswj-src-${Date.now()}${ext}`);
        await writeFile(tmp, buffer);
        try {
          const text = await extractSourceText(cfg, tmp, ext);
          const taskId = String(body.taskId ?? "common");
          const dir = join(homedir(), ".dsh", "jswj-sources", taskId);
          await mkdir(dir, { recursive: true });
          const textPath = join(dir, `${safeName(name, "资料")}.txt`);
          await writeFile(textPath, text, "utf8");

          const library = await ensureWikiChild(cfg, cfg.rootToken || "", "资料库");
          const tierNode = await ensureWikiChild(cfg, library, String(body.tier || "未分级"));
          const boardNode = await ensureWikiChild(cfg, tierNode, String(body.board || "未分类"));
          const published = await uploadFileToWiki(cfg, tmp, boardNode, name);

          value = {
            ok: true,
            title: name,
            chars: text.length,
            textPath,
            preview: text.slice(0, 240),
            url: published.url,
            nodeToken: published.wikiToken,
            library: "资料库",
          };
        } finally {
          await unlink(tmp).catch(() => {});
        }
        break;
      }
      case "font.status":
        value = await fontStatus(cfg);
        break;
      case "font.install":
        value = await installHarmonyFont(cfg);
        break;
      case "wiki.list": {
        const listArgs = {};
        if (body.parent !== undefined && body.parent !== null && body.parent !== "") listArgs.parent = String(body.parent);
        value = await tool("jswj_wiki_list").execute(listArgs, {});
        break;
      }
      case "publish": {
        const markdown = String(body.markdown ?? "");
        const title = String(body.title ?? "").trim();
        if (!markdown.trim()) throw new Error("markdown 不能为空");
        if (!title) throw new Error("title 不能为空");
        const renderArgs = { markdown, title };
        if (body.classification) renderArgs.classification = String(body.classification);
        if (body.outPath) renderArgs.outPath = String(body.outPath);
        const render = await tool("jswj_render_docx").execute(renderArgs, {});
        const publishArgs = { filePath: render.path };
        if (body.parent) publishArgs.parent = String(body.parent);
        if (body.name) publishArgs.name = String(body.name);
        const published = await tool("jswj_publish_docx").execute(publishArgs, {});
        if (body.id) {
          await patchTask(String(body.id), {
            data: {
              publish: {
                url: published.url,
                nodeToken: published.wikiToken,
                filePath: render.path,
                size: published.size,
                title: published.title,
                at: new Date().toISOString(),
              },
            },
          });
        }
        value = { ...published, path: render.path };
        break;
      }
      default:
        throw new Error(`未知 action：${String(body.action ?? "(空)")}`);
    }
    sendJson(res, 200, { ok: true, value });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: String((err && err.message) || err) });
  }
}

function apply(ctx, config = {}) {
  const cfg = {
    appId: process.env.JSWJ_APP_ID ?? "",
    appSecret: process.env.JSWJ_APP_SECRET ?? "",
    spaceId: process.env.JSWJ_SPACE_ID ?? "",
    rootToken: process.env.JSWJ_ROOT_TOKEN ?? "",
    draftRootToken: process.env.JSWJ_DRAFT_ROOT_TOKEN ?? "",
    pythonPath: process.env.JSWJ_PYTHON ?? "",
    outputDir: "",
    ...config,
  };

  // ---------------------------------------------------------------- 配置自检

  ctx.tools.register(
    defineTool({
      name: "jswj_ping",
      description:
        "检查 JSWJ_DraftbyDSH 的配置是否可用：飞书凭据、知识空间、根节点、Python 运行时与 GY-F003 模板。任何出稿或读写操作前先调用它。",
      parameters: {},
      async execute() {
        const space = cfg.spaceId ? await api(cfg, `/wiki/v2/spaces/${cfg.spaceId}`) : null;
        const roots = cfg.spaceId
          ? await api(cfg, `/wiki/v2/spaces/${cfg.spaceId}/nodes?page_size=50`)
          : { items: [] };

        const python = await pickPython(cfg).catch((err) => `不可用：${err.message}`);
        const templatePath = packageFile("template/GY-F003-cleaned.docx");
        let templateOk = false;
        try {
          templateOk = (await stat(templatePath)).isFile();
        } catch {
          templateOk = false;
        }

        return {
          ok: true,
          spaceId: cfg.spaceId || "",
          spaceName: space?.space?.name ?? "",
          rootNodes: (roots.items ?? []).map((n) => ({
            title: n.title,
            token: n.node_token,
            type: n.obj_type,
            hasChild: Boolean(n.has_child),
          })),
          draftRootToken: cfg.draftRootToken || "",
          config: {
            appId: cfg.appId ? `${String(cfg.appId).slice(0, 8)}…` : "",
            appSecret: cfg.appSecret ? "已配置" : "缺失",
            spaceId: cfg.spaceId || "缺失",
          },
          python: String(python),
          template: { path: templatePath, exists: templateOk },
        };
      },
      output: {
        schema: objectSchema({
          ok: { type: "boolean", description: "配置是否可用", required: true },
          spaceId: nullableStr("知识空间 ID"),
          spaceName: nullableStr("知识空间名称"),
          rootNodes: {
            type: "array",
            description: "根级节点列表",
            items: objectSchema({
              title: str("节点标题", true),
              token: str("节点 token", true),
              type: str("对象类型", true),
              hasChild: { type: "boolean", description: "是否有子节点" },
            }),
          },
          draftRootToken: nullableStr("出稿默认父节点 token"),
          config: objectSchema({
            appId: nullableStr("App ID 掩码"),
            appSecret: str("App Secret 状态", true),
            spaceId: str("空间 ID 状态", true),
          }),
          python: str("Python 可执行路径或错误信息", true),
          template: objectSchema({
            path: str("模板绝对路径", true),
            exists: { type: "boolean", description: "模板是否存在" },
          }),
        }),
        render: (_args, v) =>
          text(
            [
              `知识空间：${v.spaceName ?? "未配置"}（${v.spaceId ?? "-"}）`,
              `根节点：${v.rootNodes.map((n) => `${n.title}[${n.type}]`).join("、") || "无"}`,
              `出稿默认父节点：${v.draftRootToken ?? "未配置"}`,
              `Python：${v.python}`,
              `GY-F003 模板：${v.template.exists ? "已就绪" : "缺失"}`,
            ].join("\n"),
          ),
      },
    }),
  );

  // ---------------------------------------------------------------- 知识库导航

  ctx.tools.register(
    defineTool({
      name: "jswj_wiki_list",
      description:
        "列出飞书知识库某个节点下的直接子节点（标题、token、类型、是否有子节点）。用于确认起草库、模板库、出稿库的落位路径。parent 省略时使用配置的 rootToken。",
      parameters: {
        parent: { type: "string", description: "父节点 token 或 wiki 链接；省略则用配置中的 rootToken" },
      },
      async execute(args) {
        const space = spaceRoot(cfg);
        const parent = pickToken(args.parent ?? cfg.rootToken);
        const query = parent ? `&parent_node_token=${encodeURIComponent(parent)}` : "";
        const data = await api(cfg, `/wiki/v2/spaces/${space}/nodes?page_size=50${query}`);
        return {
          parent: parent || "",
          count: (data.items ?? []).length,
          items: (data.items ?? []).map((n) => ({
            title: n.title,
            token: n.node_token,
            type: n.obj_type,
            hasChild: Boolean(n.has_child),
          })),
        };
      },
      output: {
        schema: objectSchema({
          parent: nullableStr("实际使用的父节点 token"),
          count: { type: "number", description: "子节点数量" },
          items: {
            type: "array",
            description: "子节点列表",
            items: objectSchema({
              title: str("标题", true),
              token: str("节点 token", true),
              type: str("对象类型", true),
              hasChild: { type: "boolean", description: "是否有子节点" },
            }),
          },
        }),
        render: (_args, v) =>
          text(
            v.items.length
              ? v.items.map((n) => `${n.hasChild ? "▸" : "·"} ${n.title} [${n.type}] ${n.token}`).join("\n")
              : "该节点下没有子节点。",
          ),
      },
    }),
  );

  // ---------------------------------------------------------------- 读文档

  ctx.tools.register(
    defineTool({
      name: "jswj_doc_read",
      description:
        "读取飞书云文档的纯文本正文。接受 wiki 链接、docx 链接、wiki 节点 token 或文档 token。用于读取参考资料、模板、受审文件。",
      parameters: {
        target: { type: "string", required: true, description: "wiki 链接、docx 链接、节点 token 或文档 token" },
      },
      async execute(args) {
        const token = pickToken(args.target);
        if (!token) fail("没有从 target 中解析出 token，请传知识库文档链接或节点 token。");

        let objToken = token;
        let title = "";
        let objType = "docx";
        try {
          const node = await api(cfg, `/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`);
          objToken = node.node?.obj_token ?? token;
          objType = node.node?.obj_type ?? "docx";
          title = node.node?.title ?? "";
        } catch {
          // 不是 wiki 节点，按 docx 文档 token 直接读
        }

        if (objType === "file") {
          fail("该节点是文件（如 .docx 附件），不是在线文档，无法读取正文。请改用知识库在线文档，或直接提供本地文件路径。");
        }
        if (objType && objType !== "docx") {
          fail(`暂只支持 docx 在线文档，当前类型为 ${objType}。`);
        }

        const doc = await api(cfg, `/docx/v1/documents/${objToken}/raw_content`);
        return { title, objToken, content: doc.content ?? "" };
      },
      output: {
        schema: objectSchema({
          title: str("文档标题", true),
          objToken: str("文档 token", true),
          content: str("正文纯文本", true),
        }),
        render: (_args, v) => text(v.title ? `# ${v.title}\n\n${v.content}` : v.content),
      },
    }),
  );

  // ---------------------------------------------------------------- 新建节点

  ctx.tools.register(
    defineTool({
      name: "jswj_wiki_create",
      description:
        "在飞书知识库指定父节点下新建一个在线文档节点（docx），返回新节点 token。用于按目录规则创建起草目录、预审任务目录。",
      parameters: {
        parent: { type: "string", description: "父节点 token 或 wiki 链接；省略则用配置中的 rootToken" },
        title: { type: "string", required: true, description: "新节点标题（同时作为文档名）" },
      },
      async execute(args) {
        const title = String(args.title ?? "").trim();
        if (!title) fail("title 不能为空，请给出新节点的标题。");
        const space = spaceRoot(cfg);
        const parent = pickToken(args.parent ?? cfg.rootToken);
        const body = { obj_type: "docx", node_type: "origin", title };
        if (parent) body.parent_node_token = parent;
        const data = await api(cfg, `/wiki/v2/spaces/${space}/nodes`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return {
          nodeToken: data.node?.node_token,
          objToken: data.node?.obj_token,
          title: data.node?.title ?? title,
          parent: parent || "",
        };
      },
      output: {
        schema: objectSchema({
          nodeToken: nullableStr("新节点 token"),
          objToken: nullableStr("文档 token"),
          title: str("节点标题", true),
          parent: nullableStr("父节点 token"),
        }),
        render: (_args, v) => text(v),
      },
    }),
  );

  // ---------------------------------------------------------------- 追加正文

  ctx.tools.register(
    defineTool({
      name: "jswj_doc_append",
      description:
        "向飞书在线文档末尾追加内容。支持简单 Markdown：#/##/### 标题、- 列表、1. 编号、> 引用、--- 分隔线，其余按段落。用于写入指南、预审意见、任务说明；正式出稿请用 jswj_render_docx + jswj_publish_docx。",
      parameters: {
        target: { type: "string", required: true, description: "wiki 链接、docx 链接、节点 token 或文档 token" },
        content: { type: "string", required: true, description: "要追加的内容，支持少量 Markdown 语法" },
      },
      async execute(args) {
        const token = pickToken(args.target);
        if (!token) fail("没有从 target 中解析出 token。");
        const content = String(args.content ?? "");
        if (!content.trim()) fail("content 不能为空。");

        let docId = token;
        try {
          const node = await api(cfg, `/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`);
          docId = node.node?.obj_token ?? token;
          if (node.node?.obj_type && node.node.obj_type !== "docx") {
            fail(`该节点类型为 ${node.node.obj_type}，只能向 docx 在线文档追加内容。`);
          }
        } catch (err) {
          if (String(err.message).includes("只能向 docx")) throw err;
        }

        const blocks = [];
        for (const raw of content.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) continue;
          if (line === "---" || line === "***") {
            blocks.push({ block_type: 22, divider: {} });
            continue;
          }
          let m;
          if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
            const level = m[1].length;
            const key = ["heading1", "heading2", "heading3"][level - 1];
            blocks.push({ block_type: level + 2, [key]: { elements: [{ text_run: { content: m[2] } }], style: {} } });
            continue;
          }
          if ((m = /^[-*]\s+(.*)$/.exec(line))) {
            blocks.push({ block_type: 12, bullet: { elements: [{ text_run: { content: m[1] } }], style: {} } });
            continue;
          }
          if ((m = /^\d+\.\s+(.*)$/.exec(line))) {
            blocks.push({ block_type: 13, ordered: { elements: [{ text_run: { content: m[1] } }], style: {} } });
            continue;
          }
          if ((m = /^>\s?(.*)$/.exec(line))) {
            blocks.push({ block_type: 15, quote: { elements: [{ text_run: { content: m[1] } }], style: {} } });
            continue;
          }
          blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: line } }], style: {} } });
        }

        // 飞书单次 children 创建有数量上限，按 40 分批发。
        let batches = 0;
        for (let i = 0; i < blocks.length; i += 40) {
          await api(cfg, `/docx/v1/documents/${docId}/blocks/${docId}/children`, {
            method: "POST",
            body: JSON.stringify({ children: blocks.slice(i, i + 40), index: -1 }),
          });
          batches += 1;
        }
        return { appended: blocks.length, docId, batches };
      },
      output: {
        schema: objectSchema({
          appended: { type: "number", description: "追加的块数" },
          docId: str("文档 token", true),
          batches: { type: "number", description: "请求批次数" },
        }),
        render: (_args, v) => text(`已追加 ${v.appended} 个块（${v.batches} 批）到 ${v.docId}`),
      },
    }),
  );

  // ---------------------------------------------------------------- Word 出稿

  ctx.tools.register(
    defineTool({
      name: "jswj_render_docx",
      description:
        "把 Markdown 正文渲染成套用 GY-F003 模板的 Word 文档（.docx），返回本地绝对路径。封面、页眉、正文样式、表格与图片由渲染器处理。生成的路径随后交给 jswj_publish_docx 上传。",
      parameters: {
        markdown: { type: "string", description: "完整 Markdown 正文；一级标题作为文档标题，二至四级标题映射为正文章节。与 sourcePath 二选一" },
        sourcePath: { type: "string", description: "本地 Markdown 文件绝对路径；与 markdown 二选一，长文档建议先写文件再传路径" },
        baseDir: { type: "string", description: "相对图片路径的基准目录；省略时用 sourcePath 所在目录，否则用工作目录" },
        title: { type: "string", required: true, description: "文件名称，写入封面标题" },
        classification: { type: "string", description: "密级，如 L2 重要/秘密；默认 L2" },
        author: { type: "string", description: "编制人，如「张三 2026.10.22」" },
        checker: { type: "string", description: "校对" },
        reviewer: { type: "string", description: "审核" },
        docNumber: { type: "string", description: "文件编号，可空" },
        version: { type: "string", description: "版本号，默认 A0" },
        revisionNote: { type: "string", description: "修订说明，默认「1 期方案初版」" },
        date: { type: "string", description: "修订日期，默认当天（YYYY.MM.DD）" },
        outPath: { type: "string", description: "输出文件绝对路径；省略则写入配置的 outputDir" },
      },
      async execute(args) {
        const title = String(args.title ?? "").trim();
        if (!title) fail("title 不能为空，请给出文件名称。");

        let markdown;
        let mdPath;
        let temporary = false;
        if (args.sourcePath) {
          if (!isAbsolute(String(args.sourcePath))) fail(`sourcePath 需要绝对路径，收到：${args.sourcePath}`);
          mdPath = String(args.sourcePath);
          try {
            markdown = await readFile(mdPath, "utf8");
          } catch {
            fail(`Markdown 文件不存在或不可读：${mdPath}`);
          }
        } else {
          markdown = String(args.markdown ?? "");
          if (!markdown.trim()) fail("markdown 与 sourcePath 至少提供一个。");
          mdPath = join(tmpdir(), `jswj-${Date.now()}.md`);
          await writeFile(mdPath, markdown, "utf8");
          temporary = true;
        }
        if (!markdown.trim()) fail("Markdown 内容为空。");

        const baseDir = String(args.baseDir ?? "").trim() || (args.sourcePath ? dirname(String(args.sourcePath)) : process.cwd());

        const template = packageFile("template/GY-F003-cleaned.docx");
        try {
          await stat(template);
        } catch {
          fail(`GY-F003 模板缺失：${template}`);
        }

        const python = await pickPython(cfg);
        const script = packageFile("python/render_docx.py");
        const outDir = cfg.outputDir || join(homedir(), ".dsh", "jswj-out");
        await mkdir(outDir, { recursive: true });

        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const outPath = args.outPath
          ? String(args.outPath)
          : join(outDir, `${safeName(title, "技术文件")}-${stamp}.docx`);

        const cmdArgs = [
          script,
          "--md", mdPath,
          "--out", outPath,
          "--template", template,
          "--base-dir", baseDir,
          "--title", title,
          "--classification", args.classification ?? "L2 重要/秘密",
          "--author", args.author ?? "",
          "--checker", args.checker ?? "待定",
          "--reviewer", args.reviewer ?? "待定",
          "--doc-number", args.docNumber ?? "",
          "--version", args.version ?? "A0",
          "--revision-note", args.revisionNote ?? "1 期方案初版",
          "--date", args.date ?? new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
        ];

        let stdout = "";
        try {
          const result = await execFileAsync(python, cmdArgs, {
            timeout: 180000,
            maxBuffer: 8 * 1024 * 1024,
            encoding: "utf8",
            env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
          });
          stdout = result.stdout ?? "";
        } catch (err) {
          const detail = (err.stderr || err.stdout || err.message || "").toString().slice(-1200);
          fail(`Word 渲染失败（Python：${python}）：${detail}`);
        } finally {
          if (temporary) await unlink(mdPath).catch(() => {});
        }

        const line = stdout
          .split(/\r?\n/)
          .reverse()
          .find((l) => l.startsWith("JSWJ_RESULT "));
        if (!line) fail(`渲染器没有返回结果：${stdout.slice(-800)}`);
        let payload;
        try {
          payload = JSON.parse(line.slice("JSWJ_RESULT ".length));
        } catch {
          fail(`渲染器返回结果无法解析：${line.slice(0, 400)}`);
        }
        if (!payload.ok) fail(`渲染器报错：${payload.error ?? "未知错误"}`);

        const info = await stat(payload.path);
        return {
          path: payload.path,
          bytes: info.size,
          blocks: payload.blocks ?? 0,
          title,
          template,
        };
      },
      output: {
        schema: objectSchema({
          path: str("生成的 .docx 绝对路径", true),
          bytes: { type: "number", description: "文件字节数" },
          blocks: { type: "number", description: "解析出的段落块数" },
          title: str("文件名称", true),
          template: str("使用的模板路径", true),
        }),
        render: (_args, v) => text(`已生成 Word：${v.path}\n大小：${v.bytes} 字节\n段落块：${v.blocks ?? "-"}`),
      },
    }),
  );

  // ---------------------------------------------------------------- 发布到知识库

  ctx.tools.register(
    defineTool({
      name: "jswj_publish_docx",
      description:
        "把本地 .docx 上传为飞书知识库节点（保留 Word 原文件，可在知识库中下载）。可指定父节点；省略时用配置的 draftRootToken。上传后自动移入知识库并轮询任务结果。",
      parameters: {
        filePath: { type: "string", required: true, description: "本地 .docx 绝对路径，通常来自 jswj_render_docx" },
        parent: { type: "string", description: "目标父节点 token 或 wiki 链接；省略则用配置的 draftRootToken" },
        name: { type: "string", description: "知识库中的文件名；省略则用本地文件名" },
      },
      async execute(args) {
        const space = spaceRoot(cfg);
        const filePath = String(args.filePath ?? "").trim();
        if (!filePath) fail("filePath 不能为空，请传本地 .docx 绝对路径。");
        if (!isAbsolute(filePath)) fail(`filePath 需要绝对路径，收到：${filePath}`);

        let info;
        try {
          info = await stat(filePath);
        } catch {
          fail(`文件不存在：${filePath}`);
        }
        if (!info.isFile()) fail(`不是文件：${filePath}`);
        if (extname(filePath).toLowerCase() !== ".docx") {
          fail(`只支持 .docx，收到：${extname(filePath) || "无扩展名"}`);
        }
        if (info.size === 0) fail("文件大小为 0，无法发布。");
        if (info.size > MAX_UPLOAD_BYTES) {
          fail(`文件 ${(info.size / 1024 / 1024).toFixed(1)} MB，超过飞书 20 MB 上传上限。请精简图片或拆分文件。`);
        }

        const fileName = safeName(args.name || basename(filePath), "技术文件.docx");
        const parent = pickToken(args.parent ?? cfg.draftRootToken);
        const buffer = await readFile(filePath);
        const token = await getToken(cfg);

        const form = new FormData();
        form.append("file_name", fileName);
        form.append("parent_type", "explorer");
        form.append("parent_node", "");
        form.append("size", String(info.size));
        form.append(
          "file",
          new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          fileName,
        );

        const uploaded = await request(
          `${API}/drive/v1/files/upload_all`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
          true,
        );
        const fileToken = uploaded.file_token;
        if (!fileToken) fail("上传成功但没有返回 file_token。");
        const host = String(uploaded.url ?? "").match(/^https:\/\/([^/]+)/)?.[1] ?? "feishu.cn";

        const moveBody = { obj_type: "file", obj_token: fileToken };
        if (parent) moveBody.parent_wiki_token = parent;

        let moved;
        try {
          moved = await api(cfg, `/wiki/v2/spaces/${space}/nodes/move_docs_to_wiki`, {
            method: "POST",
            body: JSON.stringify(moveBody),
          });
        } catch (err) {
          fail(
            `文件已上传（file_token: ${fileToken}，${uploaded.url ?? "无预览地址"}），但移入知识库失败：${err.message}。` +
              `请检查应用是否为知识空间成员，以及目标父节点编辑权限；也可在飞书中手动移动该文件。`,
          );
        }

        let wikiToken = moved.wiki_token;
        if (!wikiToken && moved.task_id) {
          const node = await pollMoveTask(cfg, moved.task_id);
          wikiToken = node?.node_token;
          if (node?.title) {
            return {
              wikiToken,
              objToken: node.obj_token ?? fileToken,
              title: node.title,
              url: `https://${host}/wiki/${wikiToken}`,
              parent: parent || "",
              size: info.size,
            };
          }
        }
        if (!wikiToken) {
          fail(`移动任务已提交（task_id: ${moved.task_id ?? "n/a"}）但未在等待时间内完成。请稍后在知识库中确认，或手动移动。`);
        }

        return {
          wikiToken,
          objToken: fileToken,
          title: fileName,
          url: `https://${host}/wiki/${wikiToken}`,
          parent: parent || "",
          size: info.size,
        };
      },
      output: {
        schema: objectSchema({
          wikiToken: str("知识库节点 token", true),
          objToken: str("文件 token", true),
          title: str("知识库中的文件名", true),
          url: str("知识库节点链接", true),
          parent: nullableStr("父节点 token"),
          size: { type: "number", description: "文件字节数" },
        }),
        render: (_args, v) =>
          text(`已发布到知识库：${v.title}\n节点：${v.wikiToken}\n链接：${v.url}\n大小：${v.size} 字节`),
      },
    }),
  );

  // ---------------------------------------------------------------- 任务状态

  ctx.tools.register(
    defineTool({
      name: "jswj_task_get",
      description:
        "读取 JSWJ 任务的状态（步骤、基本信息、资料、大纲、生成/自检/修订/出稿结果）。页面发起的任务会用任务号指代，助手执行前后都应先读任务。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务号，形如 DOC-20261022-001 或 REV-20261022-001" },
      },
      async execute(args) {
        const taskId = String(args.taskId ?? "").trim();
        if (!taskId) fail("taskId 不能为空");
        return { task: await getTask(taskId) };
      },
      output: {
        schema: objectSchema({ task: { type: "object", additionalProperties: true, description: "任务对象" } }),
        render: (_args, v) => text(JSON.stringify(v.task, null, 2)),
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "jswj_task_update",
      description:
        "更新 JSWJ 任务状态。patch 是 JSON 对象字符串，可包含 data（与现有 data 浅合并）、step、status。助手完成生成、自检、预审、修订后，用本工具把结果写回任务，页面据此推进。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务号" },
        patch: {
          type: "string",
          required: true,
          description:
            'JSON 对象字符串，例如 {"data":{"generation":{"status":"done","note":"已生成 8 章"}}} 或 {"data":{"selfcheck":{"status":"clean","items":[]}}}',
        },
      },
      async execute(args) {
        const taskId = String(args.taskId ?? "").trim();
        if (!taskId) fail("taskId 不能为空");
        let patch;
        try {
          patch = JSON.parse(String(args.patch ?? "{}"));
        } catch {
          fail('patch 不是合法 JSON，请传对象字符串，例如 {"data":{...}}');
        }
        if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
          fail("patch 必须是 JSON 对象");
        }
        return { task: await patchTask(taskId, patch) };
      },
      output: {
        schema: objectSchema({ task: { type: "object", additionalProperties: true, description: "更新后的任务" } }),
        render: (_args, v) => text(JSON.stringify(v.task, null, 2)),
      },
    }),
  );

  // ---------------------------------------------------------------- 页面数据通道

  const webServer = ctx.get("webServer");
  if (webServer) {
    ctx.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: "/api/jswj",
          handler: (req, res) => handleJswjRequest(req, res, { ctx, webServer, cfg }),
        }),
      "jswj: page data route",
    );
  }
}

export { apply, inject, name };
