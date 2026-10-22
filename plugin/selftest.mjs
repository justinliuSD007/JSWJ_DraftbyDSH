// JSWJ 插件自测：不经过 DSH 工具通道，直接加载 apply 并执行注册的工具。
// 仅用于安装后验证，不随 bundle 发布。
import { readFile } from "node:fs/promises";

const mod = await import("./lib/index.js");
const tools = new Map();
const ctx = {
  tools: {
    register(spec) {
      tools.set(spec.name, spec);
    },
  },
};

const config = {
  appId: process.env.JSWJ_APP_ID ?? "",
  appSecret: process.env.JSWJ_APP_SECRET ?? "",
  spaceId: process.env.JSWJ_SPACE_ID ?? "",
  rootToken: process.env.JSWJ_ROOT_TOKEN ?? "",
  draftRootToken: process.env.JSWJ_DRAFT_ROOT_TOKEN ?? "",
};

if (!config.appId || !config.appSecret || !config.spaceId) {
  console.error("请先设置 JSWJ_APP_ID / JSWJ_APP_SECRET / JSWJ_SPACE_ID 再运行自测。");
  process.exit(2);
}

mod.apply(ctx, config);
console.log("registered:", [...tools.keys()].join(", "));

async function run(name, args = {}) {
  const spec = tools.get(name);
  const value = await spec.execute(args, {});
  const rendered = spec.output?.render?.(args, value);
  console.log(`\n=== ${name} ===`);
  console.log(rendered?.[0]?.text ?? JSON.stringify(value, null, 2));
  return value;
}

const ping = await run("jswj_ping");

const list = await run("jswj_wiki_list", {});
if (!list.items.length) throw new Error("根节点为空");

const templateNode = list.items.find((n) => n.title === "技术文件模板");
if (templateNode) {
  await run("jswj_doc_read", { target: templateNode.token });
}

const rendered = await run("jswj_render_docx", {
  title: "JSWJ 插件自测文档",
  classification: "L3 一般",
  author: "自测脚本",
  markdown: [
    "# JSWJ 插件自测文档",
    "",
    "## 概述",
    "",
    "本文档由 selftest.mjs 生成，用于验证渲染与发布链路，验证完成后会删除。",
    "",
    "### 验证项",
    "",
    "| 项目 | 结果 |",
    "|---|---|",
    "| 封面回填 | 通过 |",
    "| 发布链路 | 见下 |",
  ].join("\n"),
});

const published = await run("jswj_publish_docx", {
  filePath: rendered.path,
  name: "JSWJ-插件自测.docx",
});

console.log("\nPUBLISHED", JSON.stringify(published));

if (process.argv.includes("--cleanup") && published.objToken) {
  const auth = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  }).then((r) => r.json());
  const token = auth.tenant_access_token;
  const del = await fetch(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/${config.spaceId}/nodes/${published.objToken}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ obj_type: "file", include_children: true }),
    },
  ).then((r) => r.json());
  console.log("cleanup:", del.code, del.msg, JSON.stringify(del.data ?? {}));
}
