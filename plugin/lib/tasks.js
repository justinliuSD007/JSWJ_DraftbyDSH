/**
 * JSWJ 任务存储与门禁。
 *
 * 状态放 Host 侧文件（~/.dsh/jswj-tasks/<id>.json），页面与助手都只通过这里读写，
 * 对话只是视图，不是状态。门禁在提交步骤时判定，不通过就不推进。
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".dsh", "jswj-tasks");

const FLOW_PREFIX = { draft: "DOC", review: "REV" };

export const DRAFT_STEPS = [
  "基本信息",
  "文档属性",
  "参考资料",
  "大纲与纲要",
  "生成",
  "自检",
  "修订",
  "出稿",
];

export const REVIEW_STEPS = ["确认开始", "类型与评审单", "文件与资料", "预审", "意见与修订"];

export function stepsOf(flow) {
  return flow === "review" ? REVIEW_STEPS : DRAFT_STEPS;
}

function stamp() {
  return new Date().toISOString();
}

function dayKey() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function readJson(id) {
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

export async function listTasks() {
  await ensureDir();
  const names = await readdir(DIR).catch(() => []);
  const tasks = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const task = JSON.parse(await readFile(join(DIR, name), "utf8"));
      tasks.push(summarize(task));
    } catch {
      /* 单个文件损坏不应拖垮列表 */
    }
  }
  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** 由已有数据推断达到过的最高步骤，兼容没有 maxStep 的旧任务。 */
function inferMaxStep(task) {
  const d = task.data || {};
  let n = Number(task.step) || 1;
  if (task.flow === "review") {
    if (d.review?.archived) n = Math.max(n, 5);
    if ((d.review?.issues ?? []).length) n = Math.max(n, 4);
    if (d.review?.file?.ok) n = Math.max(n, 3);
    if (d.review?.checklist) n = Math.max(n, 2);
  } else {
    if (d.publish?.url) n = Math.max(n, 8);
    if ((d.revision?.items ?? []).length || d.revision?.confirmed) n = Math.max(n, 7);
    if (d.selfcheck?.status && d.selfcheck.status !== "pending") n = Math.max(n, 6);
    if (d.generation?.status === "done") n = Math.max(n, 5);
    if ((d.outline?.chapters ?? []).length) n = Math.max(n, 4);
    if ((d.sources ?? []).length) n = Math.max(n, 3);
    if (d.attrs?.tier) n = Math.max(n, 2);
  }
  return n;
}

function normalize(task) {
  if (!task.maxStep) task.maxStep = inferMaxStep(task);
  return task;
}

function summarize(task) {
  normalize(task);
  return {
    id: task.id,
    flow: task.flow,
    step: task.maxStep,
    maxStep: task.maxStep,
    status: task.status,
    title: task.data?.basic?.name || task.data?.review?.file?.title || "未命名",
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    stepName: stepsOf(task.flow)[task.maxStep - 1] ?? "已完成",
    pending: isPending(task),
  };
}

/** 「待我处理」：预审有未处置意见，或起草到修订步等待确认。 */
function isPending(task) {
  if (task.status !== "active") return false;
  const d = task.data || {};
  const reached = task.maxStep ?? task.step;
  if (task.flow === "review") {
    const issues = d.review?.issues ?? [];
    return reached >= 4 && issues.some((item) => !item.decision);
  }
  if (task.flow === "draft") {
    return reached === 6 && (d.selfcheck?.items ?? []).length > 0;
  }
  return false;
}

export async function getTask(id) {
  const task = await readJson(id);
  if (!task) throw new Error(`任务不存在：${id}`);
  return normalize(task);
}

/** 删除任务记录。已出稿的文档与已上传的资料不会被删除。 */
export async function deleteTask(id) {
  try {
    await unlink(join(DIR, `${id}.json`));
  } catch (err) {
    if (err && err.code === "ENOENT") throw new Error(`任务不存在：${id}`);
    throw err;
  }
  return { id, deleted: true };
}

export async function createTask(flow) {
  if (flow !== "draft" && flow !== "review") throw new Error(`未知业务流：${flow}`);
  await ensureDir();
  const prefix = FLOW_PREFIX[flow];
  const day = dayKey();
  const names = await readdir(DIR).catch(() => []);
  let seq = 1;
  const existing = new Set(names);
  while (existing.has(`${prefix}-${day}-${String(seq).padStart(3, "0")}.json`)) seq += 1;
  const id = `${prefix}-${day}-${String(seq).padStart(3, "0")}`;
  const task = {
    id,
    flow,
    step: 1,
    maxStep: 1,
    status: "active",
    createdAt: stamp(),
    updatedAt: stamp(),
    data: {
      basic: { name: "", type: flow === "review" ? "需求规范" : "需求规范", classification: "L2 重要/秘密", number: "" },
      attrs: { tier: "T2 子系统级", board: "总体", archive: "feishu", project: "" },
      sources: [],
      outline: { chapters: [], confirmed: false },
      generation: { status: "idle", note: "" },
      selfcheck: { status: "pending", items: [] },
      revision: { round: 1, items: [], confirmed: false },
      publish: {},
      sessions: {},
      review: {
        confirmed: false,
        type: "需求规范",
        checklist: "",
        file: {},
        issues: [],
        archived: false,
      },
    },
  };
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(task, null, 2), "utf8");
  return task;
}

/** 浅合并 data，一步提交的字段不会覆盖同层其他字段。 */
export async function patchTask(id, patch = {}) {
  const task = await getTask(id);
  if (patch.data && typeof patch.data === "object") {
    task.data = { ...task.data, ...patch.data };
  }
  for (const key of ["step", "status"]) {
    if (patch[key] !== undefined) task[key] = patch[key];
  }
  if (patch.step !== undefined) {
    task.maxStep = Math.max(Number(task.maxStep) || 1, Number(patch.step) || 1);
  }
  task.maxStep = Math.max(Number(task.maxStep) || 1, Number(task.step) || 1);
  task.updatedAt = stamp();
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(task, null, 2), "utf8");
  return task;
}

function need(condition, message) {
  if (!condition) throw new Error(message);
}

export function evaluateGate(flow, step, task) {
  const d = task.data;
  if (flow === "draft") {
    if (step === 1) {
      need(String(d.basic?.name ?? "").trim(), "G1：文件名称不能为空");
      need(String(d.basic?.type ?? "").trim(), "G1：请选择文件类型");
      need(String(d.basic?.classification ?? "").trim(), "G1：请选择密级");
    }
    if (step === 2) {
      need(String(d.attrs?.tier ?? "").trim(), "G2：请选择层级");
      need(String(d.attrs?.board ?? "").trim(), "G2：请选择板块");
      need(String(d.attrs?.archive ?? "").trim(), "G2：请选择归档位置");
      if (d.attrs.archive === "polarion") need(String(d.attrs.project ?? "").trim(), "G2：归档到 Polarion 时必须选择项目空间");
    }
    if (step === 3) {
      const ok = (d.sources ?? []).filter((s) => s && s.ok);
      need(ok.length > 0, "G3：至少一份参考资料解析成功");
    }
    if (step === 4) {
      const chapters = d.outline?.chapters ?? [];
      need(chapters.length > 0, "G4：大纲为空");
      const missing = chapters.filter((c) => c.required && !c.included);
      need(missing.length === 0, `G4：必备章节未包含：${missing.map((c) => c.no).join("、")}`);
      const thin = chapters.filter((c) => c.included && c.level <= 2 && (c.points ?? []).filter(Boolean).length === 0 && !c.aiDraft);
      need(thin.length === 0, `G4：一级/二级要点为空且未标注「由 AI 拟稿」：${thin.map((c) => c.no).join("、")}`);
      need(d.outline?.confirmed === true, "G4：请先确认大纲");
    }
    if (step === 5) need(d.generation?.status === "done", "G5：生成尚未完成");
    if (step === 6) {
      const items = d.selfcheck?.items ?? [];
      const blockers = items.filter((item) => item.severity === "严重");
      const finished = d.selfcheck?.status && d.selfcheck.status !== "pending";
      need(finished, "G6：自检尚未完成");
      need(d.selfcheck?.status === "clean" || blockers.length === 0, `G6：自检仍有 ${blockers.length} 条必须处理项`);
    }
    if (step === 7) {
      need((d.revision?.round ?? 1) <= 3 || d.revision?.overrunConfirmed, "G7：超过三轮须显式确认继续");
      need(d.revision?.confirmed === true, "G7：请先确认修订要点");
    }
    if (step === 8) need(String(d.publish?.url ?? "").trim(), "G8：文件尚未出稿");
    return;
  }

  if (step === 1) need(d.review?.confirmed === true, "Q1：请先确认开始");
  if (step === 2) {
    need(String(d.review?.type ?? "").trim(), "Q2：请选择评审类型");
    need(String(d.review?.checklist ?? "").trim(), "Q2：请选择评审单");
  }
  if (step === 3) need(d.review?.file?.ok === true, "Q3：受审文件尚未解析成功");
  if (step === 4) need((d.review?.issues ?? []).length > 0, "Q4：预审尚未产出意见");
  if (step === 5) {
    const undecided = (d.review?.issues ?? []).filter((item) => !item.decision);
    need(undecided.length === 0, `Q5：还有 ${undecided.length} 条意见未处置（采纳 / 驳回 / 改写）`);
    need(d.review?.archived === true, "Q5：意见书尚未存档");
  }
}

/** 提交当前步骤：合并数据 → 判门禁 → 推进。门禁失败不落库。 */
export async function submitStep(id, step, data) {
  const task = await getTask(id);
  if (Number(task.step) !== Number(step)) {
    throw new Error(`步骤不匹配：当前在第 ${task.step} 步，收到第 ${step} 步`);
  }
  const merged = { ...task, data: { ...task.data, ...(data ?? {}) } };
  evaluateGate(task.flow, Number(step), merged);
  merged.data = data ? { ...task.data, ...data } : task.data;
  merged.step = Number(step) + 1;
  if (merged.step > stepsOf(task.flow).length) {
    merged.step = stepsOf(task.flow).length;
    merged.status = "completed";
  }
  merged.maxStep = Math.max(Number(task.maxStep) || 1, merged.step);
  merged.updatedAt = stamp();
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
