/**
 * 技术文件起草：分步任务向导。
 *
 * 页面按 D1–D8 / R1–R5 推进，每步只做一个决策；状态读写走 Host 的 /api/jswj，
 * 生成、自检、预审、修订等需要模型的工作通过会话交给助手，助手用 jswj_task_update 写回。
 */
window.__ModuleLoader__.load({
  id: "@govy/dsh-plugin-jswj-draft",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const PANEL_ID = "jswj-draft";
    const FORMAL = "技术文件起草（JSWJ_DraftbyDSH）";
    const WIKI_URL = "https://govy.feishu.cn/wiki/Arv4wKueCiTuS3kddZrcwGHvnOb";
    const inject = ["slots", "remote", "remote.session", "uiWorkspace"];

    const C = {
      text: "var(--dsw-alias-label-primary, inherit)",
      sub: "var(--dsw-alias-label-secondary, inherit)",
      line: "var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
      line2: "var(--dsw-alias-border-l2, rgba(127,127,127,0.45))",
      base: "var(--dsw-alias-bg-base, transparent)",
      layer1: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))",
      layer2: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))",
      brand: "var(--dsw-alias-brand-primary, #2468d8)",
      ok: "var(--dsw-alias-state-success-primary, #12a05c)",
      warn: "var(--dsw-alias-state-warn-primary, #c77800)",
      err: "var(--dsw-alias-state-error-primary, #d54941)",
    };
    const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";
    // 高域 VIS：主色 高域紫，辅助 高域红，标准渐变 50°；字体 HarmonyOS Sans。
    const BRAND = "#3B3FB6";
    const BRAND_ALT = "#A64A97";
    const GRADIENT = "linear-gradient(50deg, #3B3FB6 0%, #A64A97 100%)";
    const FONT = '"HarmonyOS Sans SC", "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    // 主按钮固定品牌紫：部分主题里 --dsw-alias-brand-primary 是白色，不能作为填充色。
    const PRIMARY = BRAND;

    const DRAFT_STEPS = ["基本信息", "文档属性", "参考资料", "大纲与纲要", "生成", "成稿确认", "出稿"];
    const REVIEW_STEPS = ["确认开始", "类型与评审单", "文件与资料", "预审", "意见与修订"];

    const STEP_DESC = {
      draft: [
        "填文件名称、选类型与密级；名称做重名检测，编号可空。",
        "选层级、板块与归档位置，目录由属性推导。",
        "粘贴云文档链接或上传原件，至少一份解析成功才能继续。",
        "确认大纲，补一、二级要点；三级以下可留空。",
        "逐章生成，自检与修订由助手在这一步内部完成。",
        "看成稿、提意见、确认成稿；意见由助手定向修订。",
        "渲染 GY-F003 Word，发布到知识库并生成回执。",
      ],
      review: [
        "确认预审范围与预计耗时，确认即建立任务。",
        "选评审类型与评审单，评审单版本冻结。",
        "提供受审文件；参考资料可选，缺资料时相关检查项标「缺依据」。",
        "按评审单审内容、按模板审格式，交给助手执行。",
        "查看意见并决定存档或协助修订，不输出通过结论。",
      ],
    };

    const OUTLINE_TEMPLATES = {
      需求规范: [
        ["1", "概述", 1, true],
        ["2", "规范性引用文件", 1, true],
        ["3", "术语与缩略语", 1, true],
        ["4", "系统描述", 1, true],
        ["5", "需求", 1, true],
        ["5.1", "功能需求", 2, false],
        ["5.2", "性能需求", 2, false],
        ["6", "需求确认规划", 1, true],
        ["7", "结论", 1, true],
        ["8", "附录", 1, false],
      ],
      技术方案: [
        ["1", "概述", 1, true],
        ["2", "方案设计", 1, true],
        ["2.1", "总体方案", 2, false],
        ["2.2", "关键技术与实现", 2, false],
        ["3", "接口", 1, true],
        ["4", "约束与假设", 1, true],
        ["5", "验证与确认", 1, true],
        ["6", "结论", 1, true],
      ],
    };

    const s = {
      page: {
        flex: "1 1 auto",
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        background: C.base,
        color: C.text,
        fontFamily: FONT,
        padding: "28px 26px 56px",
        boxSizing: "border-box",
      },
      brandBar: { width: 56, height: 4, borderRadius: 2, background: GRADIENT, marginBottom: 12 },
      brandMark: { width: 10, height: 10, borderRadius: 2, background: GRADIENT, display: "inline-block" },
      inner: { maxWidth: 1080, margin: "0 auto" },
      head: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 },
      eyebrow: { fontSize: 12, color: C.sub, letterSpacing: "0.04em", marginBottom: 6 },
      crumb: { fontSize: 12, color: C.sub, marginBottom: 10 },
      h1: { fontSize: 22, fontWeight: 650, margin: 0, color: C.text },
      sub: { color: C.sub, fontSize: 13 },
      actionsRow: { display: "flex", gap: 10, marginLeft: "auto", flexWrap: "wrap" },
      btn: {
        height: 34,
        padding: "0 16px",
        borderRadius: 8,
        border: `1px solid ${PRIMARY}`,
        background: PRIMARY,
        color: "#fff",
        fontSize: 13,
        fontWeight: 550,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      btnSecondary: {
        height: 34,
        padding: "0 14px",
        borderRadius: 8,
        border: `1px solid ${C.line2}`,
        background: "transparent",
        color: C.text,
        fontSize: 13,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      btnGhost: {
        height: 30,
        padding: "0 8px",
        borderRadius: 6,
        border: "none",
        background: "transparent",
        color: C.sub,
        fontSize: 13,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      btnDisabled: { opacity: 0.5, cursor: "default" },
      cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 },
      entries: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 8 },
      entryGroup: { border: `1px solid ${C.line}`, background: C.layer1, borderRadius: 12, padding: "14px 16px" },
      entryTitle: { fontSize: 12, color: C.sub, marginBottom: 10 },
      entryRow: { display: "flex", gap: 8, flexWrap: "wrap" },
      envBar: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        border: `1px solid ${C.line}`,
        background: C.layer1,
        borderRadius: 10,
        padding: "10px 14px",
        margin: "14px 0 4px",
        fontSize: 12.5,
        color: C.sub,
      },
      envLabel: { color: C.text, fontWeight: 550 },
      envHint: { color: C.sub, fontSize: 12, lineHeight: 1.6 },
      btnSmall: {
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
        border: `1px solid ${PRIMARY}`,
        background: PRIMARY,
        color: "#fff",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      dangerBtn: {
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
        border: `1px solid ${C.err}`,
        background: "transparent",
        color: C.err,
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      dangerBar: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        border: `1px solid ${C.err}`,
        background: "rgba(213,73,65,0.08)",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 14,
        fontSize: 12.5,
        color: C.text,
      },
      groupTitle: {
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        fontSize: 13,
        fontWeight: 600,
        color: C.text,
        margin: "22px 0 10px",
      },
      groupCount: { fontSize: 12, fontWeight: 400, color: C.sub },
      pendingDot: { width: 6, height: 6, borderRadius: 3, background: C.warn, display: "inline-block", marginRight: 6 },
      taskCard: {
        border: `1px solid ${C.line}`,
        background: C.layer1,
        color: C.text,
        borderRadius: 12,
        padding: "14px 16px",
        cursor: "pointer",
      },
      taskTitle: { fontSize: 14, fontWeight: 600, marginBottom: 6, color: C.text },
      taskMeta: { fontSize: 12, color: C.sub, display: "flex", gap: 10, flexWrap: "wrap" },
      badge: {
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 8px",
        borderRadius: 10,
        fontSize: 11,
        background: C.layer2,
        color: C.sub,
      },
      layout: { display: "grid", gridTemplateColumns: "236px 1fr", gap: 18, alignItems: "start" },
      rail: {
        border: `1px solid ${C.line}`,
        background: C.layer1,
        borderRadius: 12,
        padding: "14px 12px",
        position: "sticky",
        top: 0,
      },
      railTitle: { fontSize: 14, fontWeight: 600, marginBottom: 4, wordBreak: "break-all", color: C.text },
      railMeta: { fontSize: 12, color: C.sub, marginBottom: 12 },
      stepItem: {
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "8px 8px",
        borderRadius: 8,
        fontSize: 13,
        color: C.text,
      },
      stepIndex: { fontFamily: MONO, fontSize: 11, color: C.sub, width: 18 },
      stepDone: { color: C.sub },
      stepCurrent: { background: C.layer2, color: C.text, fontWeight: 600, boxShadow: `inset 3px 0 0 ${BRAND}` },
      stepLocked: { color: C.sub, opacity: 0.55 },
      card: {
        border: `1px solid ${C.line}`,
        background: C.layer1,
        color: C.text,
        borderRadius: 14,
        padding: "18px 20px",
      },
      cardHead: { fontFamily: MONO, fontSize: 11, color: C.sub, marginBottom: 6 },
      cardTitle: { fontSize: 17, fontWeight: 600, margin: "0 0 6px", color: C.text },
      cardDesc: { fontSize: 13, color: C.sub, lineHeight: 1.7, marginBottom: 16 },
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 },
      field: { display: "flex", flexDirection: "column", gap: 6 },
      label: { fontSize: 12, color: C.sub },
      input: {
        height: 34,
        borderRadius: 8,
        border: `1px solid ${C.line2}`,
        background: C.base,
        color: C.text,
        padding: "0 10px",
        fontSize: 13,
        fontFamily: "inherit",
        boxSizing: "border-box",
        width: "100%",
      },
      textarea: {
        minHeight: 120,
        borderRadius: 8,
        border: `1px solid ${C.line2}`,
        background: C.base,
        color: C.text,
        padding: "10px",
        fontSize: 12.5,
        lineHeight: 1.7,
        boxSizing: "border-box",
        width: "100%",
        resize: "vertical",
        fontFamily: MONO,
      },
      footer: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 18,
        paddingTop: 14,
        borderTop: `1px solid ${C.line}`,
        flexWrap: "wrap",
      },
      status: { fontSize: 12.5, color: C.sub, marginLeft: "auto", maxWidth: 460, lineHeight: 1.6 },
      list: { display: "flex", flexDirection: "column", gap: 8 },
      row: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${C.line}`,
        background: C.layer2,
        color: C.text,
        fontSize: 13,
      },
      rowMain: { flex: 1, minWidth: 0 },
      mono: { fontFamily: MONO, fontSize: 12, color: C.sub },
      note: {
        border: `1px dashed ${C.line2}`,
        borderRadius: 10,
        padding: "10px 12px",
        color: C.sub,
        fontSize: 12.5,
        lineHeight: 1.7,
        marginTop: 12,
      },
      link: { color: C.brand, textDecoration: "none", fontSize: 13 },
      chapter: {
        display: "grid",
        gridTemplateColumns: "28px 56px 150px 1fr",
        gap: 8,
        alignItems: "center",
        padding: "6px 0",
        borderTop: `1px solid ${C.line}`,
        color: C.text,
      },
      chapterInput: {
        height: 30,
        borderRadius: 6,
        border: `1px solid ${C.line2}`,
        background: C.base,
        color: C.text,
        padding: "0 8px",
        fontSize: 12.5,
        boxSizing: "border-box",
        width: "100%",
      },
    };

    async function call(action, payload = {}) {
      const res = await fetch("/api/jswj", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-jswj": "1" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!data.ok) throw new Error(data.error || "请求失败");
      return data.value;
    }

    function stepsOf(flow) {
      return flow === "review" ? REVIEW_STEPS : DRAFT_STEPS;
    }

    function templateFor(type) {
      const rows = OUTLINE_TEMPLATES[type] || OUTLINE_TEMPLATES["需求规范"];
      return rows.map(([no, title, level, required]) => ({
        no,
        title,
        level,
        required,
        included: required,
        points: [],
        aiDraft: false,
      }));
    }

    function hydrate(task) {
      const d = task.data || {};
      const chapters = d.outline && Array.isArray(d.outline.chapters) && d.outline.chapters.length
        ? d.outline.chapters
        : templateFor(d.basic?.type || "需求规范");
      return {
        basic: { ...(d.basic || {}) },
        attrs: { ...(d.attrs || {}) },
        sources: Array.isArray(d.sources) ? d.sources : [],
        chapters: chapters.map((c) => ({ ...c, points: Array.isArray(c.points) ? c.points : [] })),
        outlineConfirmed: Boolean(d.outline?.confirmed),
        generation: { ...(d.generation || {}) },
        selfcheck: { ...(d.selfcheck || {}) },
        revision: {
          round: d.revision?.round || 1,
          items: Array.isArray(d.revision?.items) ? d.revision.items : [],
          confirmed: Boolean(d.revision?.confirmed),
          done: Boolean(d.revision?.done),
          executedAt: d.revision?.executedAt || "",
        },
        review: {
          confirmed: Boolean(d.review?.confirmed),
          type: d.review?.type || d.basic?.type || "需求规范",
          checklist: d.review?.checklist || "",
          file: d.review?.file || {},
          issues: Array.isArray(d.review?.issues) ? d.review.issues : [],
          archived: Boolean(d.review?.archived),
        },
        publishMarkdown: d.publish?.markdown || d.generation?.markdown || "",
        publish: { ...(d.publish || {}) },
        draft: {
          ready: Boolean(d.draft?.ready) || Boolean(d.draft?.markdown || d.generation?.markdown),
          markdown: d.draft?.markdown || d.generation?.markdown || "",
          url: d.draft?.url || "",
          nodeToken: d.draft?.nodeToken || "",
          version: d.draft?.version || 1,
          comments: d.draft?.comments || "",
          confirmed: Boolean(d.draft?.confirmed),
        },
        sessions: { ...(d.sessions || {}) },
        link: "",
        status: "",
      };
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
    }

    async function writeClipboard(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return;
      }
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }

    function promptFor(task, step, extra) {      const names = stepsOf(task.flow);
      return [
        `【JSWJ 任务 ${task.id} · 第 ${step} 步：${names[step - 1]}】`,
        "请加载 jswj-draftbydsh 技能，先调用 jswj_task_get 读取该任务，再按任务数据完成这一步。",
        extra || "",
        "完成后必须调用 jswj_task_update 把结果写回任务（generation / selfcheck / revision / review.issues），然后回到「技术文件起草」页面点刷新继续。",
      ]
        .filter(Boolean)
        .join("\n");
    }

    function JswjPage(props) {
      const [screen, setScreen] = React.useState("list");
      const [tasks, setTasks] = React.useState([]);
      const [task, setTask] = React.useState(null);
      const [form, setForm] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const [notice, setNotice] = React.useState("");
      const [font, setFont] = React.useState({ loading: true });
      const [confirmId, setConfirmId] = React.useState("");

      const loadTasks = async () => {
        try {
          setTasks(await call("tasks.list"));
        } catch (err) {
          setError(String(err.message || err));
        }
      };

      React.useEffect(() => {
        loadTasks();
        call("font.status")
          .then((status) => setFont({ ...status, loading: false }))
          .catch(() => setFont({ loading: false, installed: false, sourceAvailable: false }));
      }, []);

      React.useEffect(() => {
        if (task) setForm(hydrate(task));
      }, [task && task.id, task && task.step, task && task.updatedAt]);

      const run = async (fn) => {
        if (busy) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          await fn();
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy(false);
        }
      };

      const openTask = async (id) => {
        await run(async () => {
          const fresh = await call("tasks.get", { id });
          setTask(fresh);
          setScreen("task");
        });
      };

      const finishFlow = async () => {
        await loadTasks();
        setTask(null);
        setScreen("list");
      };

      const fmtTime = (value) => {
        if (!value) return "-";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
      };

      const humanDuration = (start, end) => {
        const from = new Date(start).getTime();
        const to = new Date(end).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return "-";
        const minutes = Math.max(1, Math.round((to - from) / 60000));
        if (minutes < 60) return `${minutes} 分钟`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return `${hours} 小时${rest ? ` ${rest} 分` : ""}`;
      };

      const newTask = async (flow) => {
        await run(async () => {
          const created = await call("tasks.create", { flow });
          setTask(created);
          setScreen("task");
        });
      };

      const refreshTask = async () => {
        if (!task) return;
        await run(async () => {
          setTask(await call("tasks.get", { id: task.id }));
        });
      };

      const savePatch = async (patch) => {
        await run(async () => {
          setTask(await call("tasks.patch", { id: task.id, patch }));
        });
      };

      const submit = async (data) => {
        await run(async () => {
          setTask(await call("tasks.step", { id: task.id, step: task.step, data }));
        });
      };

      const backStep = async () => {
        await savePatch({ step: Math.max(1, task.step - 1) });
      };

      const gotoStep = async (index) => {
        const reached = Number(task?.maxStep ?? task?.step ?? 1);
        if (!task || index > reached || index === task.step) return;
        await savePatch({ step: index });
      };

      const sessionTitleFor = (stepNumber) => {
        const base = (form.basic?.name || form.review?.file?.title || task.id).trim();
        const labels =
          flow === "review"
            ? { 4: "技术资料预审", 5: "预审意见与修订" }
            : { 4: "大纲与纲要草拟", 5: "正文生成", 6: "成稿确认与修订", 7: "出稿" };
        return `${base} ${labels[stepNumber] || "技术文件起草"}`;
      };

      const sessionFor = (stepNumber) => form.sessions?.[String(stepNumber)]?.sessionId;

      const handoff = async (step, extra, forceNew = false) => {
        const existing = sessionFor(step);
        if (existing && !forceNew) {
          props.openSession(existing);
          setNotice("已打开本步已有会话，可继续对话。");
          return;
        }
        await run(async () => {
          await Promise.race([
            props.startAgent(promptFor(task, step, extra), sessionTitleFor(step), task.id, step),
            new Promise((_, reject) => setTimeout(() => reject(new Error("投递超时，请用「复制指令」粘贴到对话中")), 20000)),
          ]);
          setTask(await call("tasks.get", { id: task.id }));
          setNotice("已新建会话并投递任务号；助手完成后回本页点「刷新」。");
        });
      };

      const copyPrompt = async (step, extra) => {
        try {
          await writeClipboard(promptFor(task, step, extra));
          setNotice("指令已复制，可粘贴到对话中。");
        } catch (err) {
          setError("复制失败：" + String((err && err.message) || err));
        }
      };

      const installFont = async () => {
        await run(async () => {
          const result = await call("font.install");
          setFont({ ...result, loading: false, sourceAvailable: true });
          setNotice(result.restartRequired ? "字体已安装，请重启 DSH 后生效。" : "字体已安装。");
        });
      };

      const removeTask = async (id) => {
        await run(async () => {
          await call("tasks.delete", { id });
          setConfirmId("");
          if (task && task.id === id) {
            setTask(null);
            setScreen("list");
          }
          setTasks(await call("tasks.list"));
          setNotice(`已删除任务 ${id}`);
        });
      };

      if (screen === "list" || !task || !form) {
        const groups = [
          ["待处理", tasks.filter((item) => item.pending)],
          ["进行中", tasks.filter((item) => !item.pending && item.status !== "completed")],
          ["已完成", tasks.filter((item) => item.status === "completed")],
        ];
        return h(
          "div",
          { style: s.page },
          h(
            "div",
            { style: s.inner },
            h("div", { style: s.brandBar }),
            h("div", { style: s.eyebrow }, h("span", { style: s.brandMark }), FORMAL),
            h(
              "div",
              { style: s.head },
              h("h1", { style: s.h1 }, "技术文件起草"),
              h("span", { style: s.sub }, "按业务流推进，门禁未过不能进入下一步"),
              h(
                "div",
                { style: s.actionsRow },
                h("button", { style: s.btnSecondary, onClick: () => run(loadTasks) }, "刷新"),
              ),
            ),
            error ? h("div", { style: { color: C.err, fontSize: 13, marginBottom: 12 } }, error) : null,
            h(
              "div",
              { style: s.entries },
              h(
                "div",
                { style: s.entryGroup },
                h("div", { style: s.entryTitle }, "创建技术资料"),
                h(
                  "div",
                  { style: s.entryRow },
                  h("button", { style: s.btn, onClick: () => newTask("draft") }, "技术文件"),
                  h("button", { style: { ...s.btnSecondary, ...s.btnDisabled }, disabled: true }, "需求条目（暂缓）"),
                  h("button", { style: { ...s.btnSecondary, ...s.btnDisabled }, disabled: true }, "试验数据（预留）"),
                ),
              ),
              h(
                "div",
                { style: s.entryGroup },
                h("div", { style: s.entryTitle }, "评审技术资料"),
                h(
                  "div",
                  { style: s.entryRow },
                  h("button", { style: s.btn, onClick: () => newTask("review") }, "技术文件"),
                  h("button", { style: { ...s.btnSecondary, ...s.btnDisabled }, disabled: true }, "需求条目（预留）"),
                ),
              ),
            ),
            !font.loading && !font.installed
              ? h(
                  "div",
                  { style: s.envBar },
                  h("span", { style: s.envLabel }, "字体 HarmonyOS Sans SC"),
                  h("span", { style: { color: C.warn } }, font.supported === false ? "需手动安装" : "未安装"),
                  font.supported !== false
                    ? h("button", { style: s.btnSmall, disabled: busy, onClick: installFont }, "安装字体")
                    : null,
                  font.supported === false
                    ? h("span", { style: s.envHint }, "macOS 请双击 ttf 安装到字体册")
                    : null,
                  font.sourceAvailable === false
                    ? h("span", { style: s.envHint }, "未找到字体目录，可把 ttf 放到桌面「鸿蒙字体（对外仅可用该字体）」")
                    : null,
                )
              : null,
            notice ? h("div", { style: { color: C.ok, fontSize: 12.5, marginBottom: 8 } }, notice) : null,
            tasks.length === 0
              ? h("div", { style: s.note }, "还没有任务。从上方选择「创建技术资料 → 技术文件」开始。")
              : groups.map(([label, items]) =>
                  items.length
                    ? h(
                        "div",
                        { key: label },
                        h("div", { style: s.groupTitle }, label, h("span", { style: s.groupCount }, `${items.length} 项`)),
                        h(
                          "div",
                          { style: s.cards },
                          items.map((item) =>
                            h(
                              "div",
                              { key: item.id, style: s.taskCard, onClick: () => openTask(item.id) },
                              h(
                                "div",
                                { style: s.taskTitle },
                                item.pending ? h("span", { style: s.pendingDot }) : null,
                                item.title || "未命名",
                              ),
                              h(
                                "div",
                                { style: s.taskMeta },
                                h("span", { style: s.badge }, item.flow === "review" ? "评审" : "创建"),
                                h("span", null, `${item.id}`),
                                h("span", null, `${item.step}/${stepsOf(item.flow).length} · ${item.stepName}`),
                                h("span", null, String(item.updatedAt || "").replace("T", " ").slice(0, 16)),
                              ),
                              h(
                                "div",
                                {
                                  style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 8 },
                                  onClick: (event) => event.stopPropagation(),
                                },
                                confirmId === item.id
                                  ? h("span", { style: { fontSize: 12, color: C.err } }, "删除后不可恢复")
                                  : null,
                                confirmId === item.id
                                  ? h("button", { style: s.dangerBtn, onClick: () => removeTask(item.id) }, "确认删除")
                                  : h("button", { style: s.btnGhost, onClick: () => setConfirmId(item.id) }, "删除"),
                                confirmId === item.id
                                  ? h("button", { style: s.btnGhost, onClick: () => setConfirmId("") }, "取消")
                                  : null,
                              ),
                            ),
                          ),
                        ),
                      )
                    : null,
                ),
            h(
              "div",
              { style: s.note },
              "知识库：",
              h("a", { href: WIKI_URL, target: "_blank", rel: "noreferrer", style: s.link }, "技术资料起草库 / 首页（使用指南）"),
              "。页面保存任务与决策，生成、自检、预审、修订由助手执行。",
            ),
          ),
        );
      }

      const flow = task.flow;
      const names = stepsOf(flow);
      const step = Number(task.step);
      const reached = Number(task.maxStep ?? task.step);
      const completedAt = task.completedAt || task.updatedAt;
      const revisionCount =
        flow === "draft" ? Math.max(0, Number(form.draft?.version || 1) - 1) : (form.review?.issues || []).length;
      const sessionCount = Object.keys(task.data?.sessions || form.sessions || {}).length;
      const archivedCount = Number(task.archivedSessions ?? 0);
      const stat = (label, value) =>
        h(
          "div",
          { style: { ...s.field, padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: 8 } },
          h("div", { style: { ...s.mono, marginBottom: 4 } }, label),
          h("div", { style: { fontSize: 15, fontWeight: 600, color: C.text } }, value),
        );
      const title = task.data?.basic?.name || "未命名";
      const set = (patch) => setForm((current) => ({ ...current, ...patch }));
      const growHeight = (el) => {
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      };
      const setBasic = (key) => (e) => set({ basic: { ...form.basic, [key]: e.target.value } });
      const setAttrs = (key) => (e) => set({ attrs: { ...form.attrs, [key]: e.target.value } });

      const stepBody = () => {
        if (flow === "draft") {
          if (step === 1) {
            return h(
              "div",
              null,
              h(
                "div",
                { style: s.grid },
                h("div", { style: { ...s.field, gridColumn: "1 / -1" } },
                  h("label", { style: s.label }, "文件名称（必填）"),
                  h("input", { style: s.input, value: form.basic.name || "", placeholder: "例如：A6-RCU-需求规范", onChange: setBasic("name") }),
                ),
                h("div", { style: s.field },
                  h("label", { style: s.label }, "文件类型"),
                  h(
                    "select",
                    { style: s.input, value: form.basic.type || "需求规范", onChange: setBasic("type") },
                    ["需求规范", "技术方案"].map((v) => h("option", { key: v }, v)),
                  ),
                ),
                h("div", { style: s.field },
                  h("label", { style: s.label }, "密级"),
                  h(
                    "select",
                    { style: s.input, value: form.basic.classification || "L2 重要/秘密", onChange: setBasic("classification") },
                    ["L1 内部有条件公开", "L2 重要/秘密", "L3 核心/绝密"].map((v) => h("option", { key: v }, v)),
                  ),
                ),
                h("div", { style: s.field },
                  h("label", { style: s.label }, "编号（可空）"),
                  h("input", { style: s.input, value: form.basic.number || "", placeholder: "标准化部门分配的编号", onChange: setBasic("number") }),
                ),
              ),
              h("div", { style: s.note }, "类型决定章节模板与评审单，选定后流程中不可改；要改只能新建任务。"),
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: () => setScreen("list") }, "返回列表"),
                h(
                  "button",
                  {
                    style: { ...s.btn, ...(busy ? s.btnDisabled : {}) },
                    disabled: busy,
                    onClick: () => submit({ basic: form.basic }),
                  },
                  "下一步：文档属性",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
              ),
            );
          }

          if (step === 2) {
            const path = `技术资料起草库 / 技术资料草稿库 / ${form.attrs.tier || "-"} / ${form.attrs.board || "-"} / ${form.basic.type || "-"} /`;
            return h(
              "div",
              null,
              h(
                "div",
                { style: s.grid },
                h("div", { style: s.field },
                  h("label", { style: s.label }, "层级"),
                  h(
                    "select",
                    { style: s.input, value: form.attrs.tier || "T2 子系统级", onChange: setAttrs("tier") },
                    ["T0 飞机级", "T1 系统级", "T2 子系统级", "T3 设备级", "T4 软硬件级", "T5 零件级"].map((v) => h("option", { key: v }, v)),
                  ),
                ),
                h("div", { style: s.field },
                  h("label", { style: s.label }, "板块"),
                  h(
                    "select",
                    { style: s.input, value: form.attrs.board || "总体", onChange: setAttrs("board") },
                    ["总体", "电子", "试验试飞", "动力"].map((v) => h("option", { key: v }, v)),
                  ),
                ),
                h("div", { style: s.field },
                  h("label", { style: s.label }, "归档位置"),
                  h(
                    "select",
                    { style: s.input, value: form.attrs.archive || "feishu", onChange: setAttrs("archive") },
                    h("option", { value: "feishu" }, "飞书审批"),
                    h("option", { value: "polarion" }, "Polarion"),
                  ),
                ),
                form.attrs.archive === "polarion"
                  ? h("div", { style: s.field },
                      h("label", { style: s.label }, "Polarion 项目空间"),
                      h("input", { style: s.input, value: form.attrs.project || "", placeholder: "例如：GAC_A6_T0", onChange: setAttrs("project") }),
                      h("span", { style: s.mono }, "填需要归档到的 Polarion 项目空间（名称即可）"),
                    )
                  : null,
              ),
              h("div", { style: s.note },
                "本文件将创建于：",
                h("span", { style: { ...s.mono, color: C.text } }, path),
                "目录不存在时在出稿阶段创建，已存在则复用。",
              ),
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
                h(
                  "button",
                  { style: { ...s.btn, ...(busy ? s.btnDisabled : {}) }, disabled: busy, onClick: () => submit({ attrs: form.attrs }) },
                  "下一步：参考资料",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
              ),
            );
          }

          if (step === 3) {
            const parse = () =>
              run(async () => {
                const link = String(form.link || "").trim();
                if (!link) throw new Error("请先粘贴飞书云文档链接");
                if (!/feishu\.cn|larksuite\.com/i.test(link)) {
                  throw new Error("目前只解析飞书云文档链接；Polarion 只在 D2 记录归档项目空间，不在资料里解析。");
                }
                const doc = await call("doc.read", { target: link });
                set({
                  sources: [
                    ...form.sources.filter((x) => x.url !== link),
                    { url: link, title: doc.title || link, ok: true, chars: doc.chars, objToken: doc.objToken },
                  ],
                  link: "",
                });
              });
            const upload = (event) => {
              const file = event.target.files && event.target.files[0];
              if (!file) return;
              run(async () => {
                const dataBase64 = await fileToBase64(file);
                const uploaded = await call("source.upload", {
                  name: file.name,
                  dataBase64,
                  tier: form.attrs.tier,
                  board: form.attrs.board,
                  taskId: task.id,
                });
                set({
                  sources: [
                    ...form.sources,
                    {
                      kind: "upload",
                      url: uploaded.url,
                      title: uploaded.title,
                      ok: true,
                      chars: uploaded.chars,
                      textPath: uploaded.textPath,
                      nodeToken: uploaded.nodeToken,
                    },
                  ],
                });
                setNotice(`已上传并留存到资料库：${uploaded.title}`);
              });
              event.target.value = "";
            };
            const okCount = form.sources.filter((x) => x.ok).length;
            return h(
              "div",
              null,
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                h("input", { style: { ...s.input, flex: "1 1 300px" }, value: form.link || "", placeholder: "粘贴飞书云文档链接，回车或点「解析」", onChange: (e) => set({ link: e.target.value }) }),
                h("button", { style: { ...s.btnSecondary, ...(busy ? s.btnDisabled : {}) }, disabled: busy, onClick: parse }, "解析"),
                h(
                  "label",
                  {
                    style: { ...s.btnSecondary, display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" },
                    title: "上传 docx / md，解析并留存到知识库资料库",
                  },
                  "上传 docx / md",
                  h("input", {
                    type: "file",
                    accept: ".docx,.md,.markdown,.txt",
                    style: { display: "none" },
                    disabled: busy,
                    onChange: upload,
                  }),
                ),
              ),
              h("div", { style: { ...s.list, marginTop: 12 } },
                form.sources.length === 0
                  ? h("div", { style: s.note }, "还没有参考资料。粘贴飞书云文档链接，或上传 docx / md；上传的文件会解析并留存到 资料库/{层级}/{板块}/。")
                  : form.sources.map((item, i) =>
                      h(
                        "div",
                        { key: `${item.url}-${i}`, style: s.row },
                        h("span", { style: { color: item.ok ? C.ok : C.err } }, item.ok ? "✓" : "✕"),
                        h(
                          "div",
                          { style: s.rowMain },
                          h("div", { style: { fontSize: 13 } }, item.title || item.url),
                          h(
                            "div",
                            { style: s.mono },
                            item.ok
                              ? `已解析 · ${item.chars} 字${item.kind === "upload" ? " · 已留存资料库" : ""}`
                              : `解析失败：${item.error || ""}`,
                          ),
                        ),
                        h(
                          "button",
                          { style: s.btnGhost, onClick: () => set({ sources: form.sources.filter((_, idx) => idx !== i) }) },
                          "移除",
                        ),
                      ),
                    ),
              ),
              h("div", { style: s.note }, "门禁 G3：至少一份资料解析成功；解析失败的要显式剔除。上传的 docx / md 会同步为知识库文件节点，并抽出纯文本供助手读取。"),
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
                h(
                  "button",
                  {
                    style: { ...s.btn, ...(busy || okCount === 0 ? s.btnDisabled : {}) },
                    disabled: busy || okCount === 0,
                    onClick: () => submit({ sources: form.sources }),
                  },
                  "锁定来源",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : notice ? h("span", { style: { ...s.status, color: C.ok } }, notice) : null,
              ),
            );
          }

          if (step === 4) {
            const setChapter = (index, patch) =>
              set({ chapters: form.chapters.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
            const draftExtra =
              "已填写的要点保留，只为空白的一级、二级章节拟 1–3 条初步要点，写回 outline.chapters[].points 并把 aiDraft 设为 true；不要改章节结构。";
            return h(
              "div",
              null,
              h(
                "div",
                { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 } },
                h("span", { style: s.mono }, "要点可换行，一行一条；也可以让助手先拟一版初稿"),
                h(
                  "div",
                  { style: { display: "flex", gap: 8 } },
                  h("button", { style: s.btnSecondary, onClick: () => copyPrompt(4, draftExtra) }, "复制拟稿指令"),
                  h("button", { style: s.btnSecondary, onClick: () => handoff(4, draftExtra) }, sessionFor(4) ? "打开本步会话" : "让助手拟稿"),
                  sessionFor(4) ? h("button", { style: s.btnSecondary, onClick: () => handoff(4, draftExtra, true) }, "新建会话") : null,
                ),
              ),
              h("div", { style: s.list },
                form.chapters.map((c, i) =>
                  h(
                    "div",
                    { key: c.no, style: s.chapter },
                    h("input", {
                      type: "checkbox",
                      checked: Boolean(c.included),
                      disabled: Boolean(c.required),
                      onChange: (e) => setChapter(i, { included: e.target.checked }),
                    }),
                    h("span", { style: s.mono }, c.no),
                    h(
                      "span",
                      { style: { fontSize: 13, paddingLeft: c.level > 1 ? 12 : 0 } },
                      c.title,
                      c.required ? h("span", { style: { ...s.badge, marginLeft: 6 } }, "必备") : null,
                    ),
                    c.level <= 2
                      ? h(
                          "div",
                          { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
                          h("textarea", {
                            ref: growHeight,
                            onInput: (e) => growHeight(e.target),
                            style: {
                              ...s.chapterInput,
                              height: "auto",
                              minHeight: 52,
                              padding: "6px 8px",
                              lineHeight: 1.5,
                              resize: "none",
                              overflow: "hidden",
                              fontFamily: "inherit",
                            },
                            value: (c.points || []).join("\n"),
                            placeholder: "一行一条要点",
                            onChange: (e) =>
                              setChapter(i, {
                                points: e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
                              }),
                          }),
                          h(
                            "label",
                            { style: { fontSize: 11, color: C.sub, whiteSpace: "nowrap", display: "flex", gap: 4, alignItems: "center", paddingTop: 6 } },
                            h("input", {
                              type: "checkbox",
                              checked: Boolean(c.aiDraft),
                              onChange: (e) => setChapter(i, { aiDraft: e.target.checked }),
                            }),
                            "AI 拟稿",
                          ),
                        )
                      : h("span", { style: s.mono }, "三级以下，默认折叠"),
                  ),
                ),
              ),
              h("div", { style: s.note }, "大纲覆盖到四级；一级、二级要点必须填写或标注「由 AI 拟稿」。必备章节不可取消。"),
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
                h(
                  "button",
                  {
                    style: { ...s.btn, ...(busy ? s.btnDisabled : {}) },
                    disabled: busy,
                    onClick: () =>
                      submit({
                        outline: { chapters: form.chapters, confirmed: true },
                      }),
                  },
                  "确认，开始生成",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : notice ? h("span", { style: { ...s.status, color: C.ok } }, notice) : null,
              ),
            );
          }

          if (step === 5) {
            const gen = form.generation || {};
            const selfcheck = form.selfcheck || {};
            const revision = form.revision || { round: 1, items: [], confirmed: false };
            const items = revision.items || [];
            const must = items.filter((it) => it.severity === "严重");
            const suggest = items.filter((it) => it.severity !== "严重");
            const setItem = (index, patch) =>
              set({ revision: { ...revision, items: items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } });
            const acceptAll = () =>
              set({ revision: { ...revision, items: items.map((it) => ({ ...it, accepted: true })) } });

            const summarizeRevision = () => {
              const existing = sessionFor(7);
              if (existing) {
                return run(async () => {
                  await call("session.prompt", { sessionId: existing, text: revisionExtra, timeZone: timeZone() });
                  props.openSession(existing);
                  setNotice("已请求助手汇总修订要点；完成后刷新。");
                });
              }
              return handoff(7, revisionExtra);
            };

            const confirmRevision = () => {
              if (!items.length) {
                setError("还没有修订要点，请先让助手汇总。");
                return;
              }
              return run(async () => {
                await call("tasks.patch", {
                  id: task.id,
                  patch: { data: { revision: { ...revision, confirmed: true, done: false, executedAt: "" } } },
                });
                await props.startAgent(
                  promptFor(
                    task,
                    7,
                    "按 revision.items 逐条执行定向修订，只改意见指出的位置，不整体润色、不补写整节；完成后更新 selfcheck 与 revision.round，把 revision.done 置 true、executedAt 写当前时间、confirmed 置 false，并写回任务。",
                  ),
                  sessionTitleFor(7),
                  task.id,
                  7,
                );
                setTask(await call("tasks.get", { id: task.id }));
                setNotice("已确认修订并交给助手；完成后刷新，再回第 6 步自检。");
              });
            };

            const revisionState = revision.done
              ? `修订已完成${revision.executedAt ? " · " + String(revision.executedAt).replace("T", " ").slice(0, 16) : ""}`
              : revision.confirmed
                ? "修订已确认，等待助手执行"
                : items.length
                  ? "待确认修订要点"
                  : "待汇总修订要点";

            const issueRow = (it, index, withCheck) =>
              h(
                withCheck ? "label" : "div",
                { key: index, style: { ...s.row, cursor: withCheck ? "pointer" : "default" } },
                withCheck
                  ? h("input", {
                      type: "checkbox",
                      checked: it.accepted !== false,
                      onChange: (e) => setItem(index, { accepted: e.target.checked }),
                    })
                  : h("span", { style: { color: it.severity === "严重" ? C.err : C.warn } }, it.severity === "严重" ? "●" : "○"),
                h(
                  "div",
                  { style: s.rowMain },
                  h("div", null, `${it.location || ""} ${it.problem || ""}`),
                  h("div", { style: s.mono }, it.action || it.suggestion || it.basis || ""),
                ),
              );

            const data =
              step === 5
                ? h(
                    "div",
                    null,
                    h(
                      "div",
                      { style: s.row },
                      h("span", { style: { color: gen.status === "done" ? C.ok : C.warn } }, gen.status === "done" ? "✓" : "…"),
                      h(
                        "div",
                        { style: s.rowMain },
                        h(
                          "div",
                          null,
                          gen.status === "done"
                            ? "生成已完成"
                            : `生成中 ${gen.progress || `0/${form.chapters.filter((c) => c.included).length}`} 章`,
                        ),
                        h("div", { style: s.mono }, gen.note || ""),
                      ),
                    ),
                    gen.previewUrl
                      ? h(
                          "div",
                          { style: s.note },
                          "预览：",
                          h("a", { style: s.link, href: gen.previewUrl, target: "_blank", rel: "noreferrer" }, gen.previewUrl),
                        )
                      : null,
                    h("div", { style: s.note }, "点「交给助手生成」会新建会话：助手逐章生成后自动自检并修订到无严重项，再把 generation.status=done 与成稿正文 draft.markdown 写回任务；回到本页刷新即可进入成稿确认。"),
                  )
                : step === 6
                  ? h(
                      "div",
                      null,
                      h(
                        "div",
                        { style: s.row },
                        h("span", { style: { color: selfcheck.status === "clean" ? C.ok : C.warn } }, selfcheck.status === "clean" ? "✓" : "…"),
                        h(
                          "div",
                          { style: s.rowMain },
                          h("div", null, selfcheck.status === "clean" ? "自检无阻断" : "自检未完成或有阻断"),
                          h(
                            "div",
                            { style: s.mono },
                            `必须处理 ${(selfcheck.items || []).filter((i) => i.severity === "严重").length} 条 · 建议 ${(selfcheck.items || []).filter((i) => i.severity !== "严重").length} 条`,
                          ),
                        ),
                      ),
                      (selfcheck.items || []).some((i) => i.severity === "严重")
                        ? h(
                            "div",
                            null,
                            h("div", { style: s.groupTitle }, "必须处理"),
                            h(
                              "div",
                              { style: s.list },
                              (selfcheck.items || [])
                                .filter((i) => i.severity === "严重")
                                .map((it, i) => issueRow(it, i, false)),
                            ),
                          )
                        : null,
                      (selfcheck.items || []).some((i) => i.severity !== "严重")
                        ? h(
                            "div",
                            null,
                            h("div", { style: s.groupTitle }, "建议看看"),
                            h(
                              "div",
                              { style: s.list },
                              (selfcheck.items || [])
                                .filter((i) => i.severity !== "严重")
                                .map((it, i) => issueRow(it, i, false)),
                            ),
                          )
                        : null,
                    )
                  : h(
                      "div",
                      null,
                      h(
                        "div",
                        { style: s.row },
                        h("span", { style: { color: revision.done ? C.ok : C.warn } }, revision.done ? "✓" : "↻"),
                        h(
                          "div",
                          { style: s.rowMain },
                          h("div", null, `第 ${revision.round || 1} 轮修订 · ${revisionState}`),
                          h("div", { style: s.mono }, `${must.length} 条必须处理 · ${suggest.length} 条建议看看`),
                        ),
                      ),
                      items.length
                        ? h(
                            "div",
                            null,
                            h(
                              "div",
                              { style: { ...s.groupTitle, justifyContent: "space-between" } },
                              h("span", null, "修订要点"),
                              h("button", { style: s.btnGhost, onClick: acceptAll }, "同意全部"),
                            ),
                            h(
                              "div",
                              { style: s.list },
                              items.map((it, i) => issueRow(it, i, true)),
                            ),
                          )
                        : h("div", { style: s.note }, "还没有修订要点。点「让助手汇总修订要点」，助手会读取自检问题并写回本轮要点。"),
                      items.length
                        ? h(
                            "label",
                            { style: { ...s.row, marginTop: 10, cursor: "pointer" } },
                            h("input", {
                              type: "checkbox",
                              checked: Boolean(revision.confirmed),
                              onChange: (e) => set({ revision: { ...revision, confirmed: e.target.checked } }),
                            }),
                            h("span", null, "我已确认本轮修订要点"),
                          )
                        : h(
                            "div",
                            { style: { display: "flex", justifyContent: "flex-end", marginTop: 8 } },
                            h("button", { style: s.btnSecondary, onClick: summarizeRevision }, "让助手汇总修订要点"),
                          ),
                    );

            const revisionExtra =
              "请读取 selfcheck.items 与本轮文档，汇总为 revision.items（severity / location / problem / action）并写回任务；不要直接改正文。";
            const generationExtra =
              "生成后自动自检并修订，直到没有严重项；再写回 generation.status=done、selfcheck.status=clean、revision.done=true，并把成稿正文写入 draft.markdown、draft.ready=true、draft.version 加 1。";
            const selfcheckItems = selfcheck.items || [];
            const selfcheckBlockers = selfcheckItems.filter((item) => item.severity === "严重");
            const selfcheckFinished = Boolean(selfcheck.status) && selfcheck.status !== "pending";
            const selfcheckReady = selfcheckFinished && selfcheckBlockers.length === 0;
            const canNext =
              (step === 5 && gen.status === "done") ||
              (step === 6 && selfcheckFinished) ||
              (step === 7 && revision.done && selfcheckReady);
            return h(
              "div",
              null,
              data,
              step === 6 && selfcheckBlockers.length
                ? h(
                    "div",
                    { style: s.note },
                    `自检只诊断，不在这里修改。还有 ${selfcheckBlockers.length} 条必须处理项，点「下一步：修订」统一处理；修订后回来自检复核。`,
                  )
                : null,
              step === 7
                ? h(
                    "div",
                    { style: s.note },
                    "自检发现的问题在这一步统一修改，自检步不再单独修。先「让助手汇总修订要点」，确认后点「确认并交给助手修订」执行；助手完成后回第 6 步复核，没有必须处理项才能出稿，最多三轮。",
                  )
                : null,
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
                h("button", { style: s.btnSecondary, onClick: refreshTask }, "刷新"),
                h(
                  "button",
                  { style: s.btnSecondary, onClick: () => handoff(step, step === 5 ? generationExtra : step === 7 ? revisionExtra : undefined) },
                  sessionFor(step)
                    ? "打开本步会话"
                    : step === 5
                      ? "交给助手生成"
                      : step === 6
                        ? "交给助手自检"
                        : "让助手汇总修订要点",
                ),
                sessionFor(step)
                  ? h(
                      "button",
                      { style: s.btnSecondary, onClick: () => handoff(step, step === 5 ? generationExtra : step === 7 ? revisionExtra : undefined, true) },
                      "新建会话",
                    )
                  : null,
                h(
                  "button",
                  { style: s.btnSecondary, onClick: () => copyPrompt(step, step === 5 ? generationExtra : undefined) },
                  "复制指令",
                ),
                step === 7
                  ? h(
                      "button",
                      {
                        style: { ...s.btnSecondary, ...(items.length === 0 ? s.btnDisabled : {}) },
                        disabled: items.length === 0,
                        onClick: confirmRevision,
                      },
                      "确认并交给助手修订",
                    )
                  : null,
                h(
                  "button",
                  {
                    style: { ...s.btn, ...(busy || !canNext ? s.btnDisabled : {}) },
                    disabled: busy || !canNext,
                    onClick: () => submit(step === 7 ? { revision: { ...revision, confirmed: true } } : {}),
                  },
                  step === 6
                    ? selfcheckFinished
                      ? "下一步：修订"
                      : "自检未完成"
                    : step === 7
                      ? revision.done
                        ? "修订完成，去出稿"
                        : "等待修订完成"
                      : "下一步",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : notice ? h("span", { style: { ...s.status, color: C.ok } }, notice) : null,
              ),
            );
          }

          if (step === 6) {
            const draft = form.draft || { ready: false, markdown: "", url: "", version: 1, comments: "", confirmed: false };
            const preview = () =>
              run(async () => {
                if (!draft.markdown) throw new Error("还没有成稿正文，先让助手生成成稿");
                const result = await call("draft.preview", {
                  id: task.id,
                  markdown: draft.markdown,
                  version: draft.version,
                });
                setTask(await call("tasks.get", { id: task.id }));
                setNotice(`预览稿已生成：${result.path || result.url}`);
              });
            const submitComments = () =>
              run(async () => {
                const comments = String(form.draft?.comments || "").trim();
                if (!comments) throw new Error("请先写下需要修改的意见");
                const next = { ...draft, comments, confirmed: false };
                await call("tasks.patch", { id: task.id, patch: { data: { draft: next } } });
                const prompt = promptFor(
                  task,
                  6,
                  "按 draft.comments 逐条修订成稿，只改意见指出的位置；完成后更新 draft.markdown、draft.version 加 1、draft.ready 置 true、draft.confirmed 置 false，并写回任务。",
                );
                const existing = sessionFor(6);
                if (existing) {
                  await call("session.prompt", { sessionId: existing, text: prompt, timeZone: timeZone() });
                  props.openSession(existing);
                  setNotice("已把意见投递到本步已有会话；完成后刷新。");
                } else {
                  await props.startAgent(prompt, sessionTitleFor(6), task.id, 6);
                  setNotice("已新建本步会话并提交意见；完成后刷新。");
                }
                setTask(await call("tasks.get", { id: task.id }));
              });
            const confirmDraft = () =>
              run(async () => {
                const next = { ...draft, confirmed: true };
                setTask(await call("tasks.step", { id: task.id, step: 6, data: { draft: next } }));
                setNotice("成稿已确认，进入出稿。");
              });
            return h(
              "div",
              null,
              h(
                "div",
                { style: s.row },
                h("span", { style: { color: draft.ready ? C.ok : C.warn } }, draft.ready ? "✓" : "…"),
                h(
                  "div",
                  { style: s.rowMain },
                  h("div", null, draft.ready ? `成稿已生成 · v${draft.version || 1}` : "等待助手生成成稿"),
                  h(
                    "div",
                    { style: s.mono },
                    draft.ready
                      ? "自检与修订已在生成回合由助手自动完成，这里只看成稿、提意见"
                      : "生成后助手会自动自检与修订，不需要逐步推进",
                  ),
                ),
              ),
              draft.url
                ? h("div", { style: s.note }, "预览稿：", h("a", { style: s.link, href: draft.url, target: "_blank", rel: "noreferrer" }, draft.url))
                : h("div", { style: s.note }, "点「生成预览稿」把当前成稿发到知识库，在飞书里直接看 Word 效果。"),
              h(
                "div",
                { style: s.field, marginTop: 12 },
                h("label", { style: s.label }, "我的意见（一行一条或整段）"),
                h("textarea", {
                  style: s.textarea,
                  value: form.draft?.comments || "",
                  placeholder: "例如：5.2 响应时间要给出依据；4.1 重量数据前后不一致",
                  onChange: (e) => set({ draft: { ...draft, comments: e.target.value } }),
                }),
              ),
              h("div", { style: s.note }, "自检和修订在生成回合内部自动完成；这里不再逐步确认。先提交意见让助手改，满意后确认成稿并出稿。"),
              h(
                "div",
                { style: s.footer },
                h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
                h("button", { style: s.btnSecondary, onClick: refreshTask }, "刷新"),
                draft.ready
                  ? h("button", { style: s.btnSecondary, onClick: preview }, draft.url ? "更新预览稿" : "生成预览稿")
                  : h("button", { style: s.btnSecondary, onClick: () => handoff(6, "根据大纲与资料生成成稿，生成后自动自检并修订到无严重项，写回 draft.markdown、draft.ready=true、draft.version 加 1。") }, "交给助手生成成稿"),
                draft.ready
                  ? h("button", { style: { ...s.btnSecondary, ...(busy ? s.btnDisabled : {}) }, disabled: busy, onClick: submitComments }, "提交意见并修订")
                  : null,
                h(
                  "button",
                  {
                    style: { ...s.btn, ...(busy || !draft.ready ? s.btnDisabled : {}) },
                    disabled: busy || !draft.ready,
                    onClick: confirmDraft,
                  },
                  "确认成稿，去出稿",
                ),
                error ? h("span", { style: { ...s.status, color: C.err } }, error) : notice ? h("span", { style: { ...s.status, color: C.ok } }, notice) : null,
              ),
            );
          }

          // step 7
          const draft = form.draft || {};
          const formalName = `${form.basic.number ? `${form.basic.number}-` : ""}${form.basic.name || "技术文件"}.docx`;
          const publish = () =>
            run(async () => {
              const result = await call("draft.publish", { id: task.id });
              const finished = await call("tasks.step", { id: task.id, step: 7, data: {} });
              setTask(finished);
              setNotice(`已按正式文件名出稿：${result.title || formalName}`);
            });
          return h(
            "div",
            null,
            h(
              "div",
              { style: s.row },
              h("span", { style: { color: form.publish?.url ? C.ok : C.warn } }, form.publish?.url ? "✓" : "…"),
              h(
                "div",
                { style: s.rowMain },
                h("div", null, `成稿 v${draft.version || 1}`),
                h("div", { style: s.mono }, `正式文件名：${formalName}`),
              ),
            ),
            h(
              "div",
              { style: s.note },
              `目标目录：技术资料起草库 / 技术资料草稿库 / ${form.attrs.tier || "-"} / ${form.attrs.board || "-"} / ${form.basic.type || "-"} /`,
            ),
            h("div", { style: s.note }, "出稿会把同一份成稿按正式文件名落位，并删除旧草稿文件，不会留下两份。"),
            form.publish?.url
              ? h("div", { style: s.note }, "已出稿：", h("a", { style: s.link, href: form.publish.url, target: "_blank", rel: "noreferrer" }, form.publish.url))
              : null,
            h(
              "div",
              { style: s.footer },
              h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
              h("button", { style: s.btnSecondary, onClick: refreshTask, disabled: busy }, "刷新"),
              h(
                "button",
                { style: { ...s.btnSecondary, ...(busy ? s.btnDisabled : {}) }, disabled: busy, onClick: publish },
                "出稿（正式命名并归档）",
              ),
              error ? h("span", { style: { ...s.status, color: C.err } }, error) : notice ? h("span", { style: { ...s.status, color: C.ok } }, notice) : null,
            ),
          );
        }

        // review flow
        if (step === 1) {
          return h(
            "div",
            null,
            h("div", { style: s.note }, "预审只出「待确认问题」，不输出通过或不通过的结论。预计 3–5 分钟，可中断续做。"),
            h("label", { style: { ...s.row, marginTop: 12, cursor: "pointer" } }, h("input", { type: "checkbox", checked: Boolean(form.review.confirmed), onChange: (e) => set({ review: { ...form.review, confirmed: e.target.checked } }) }), h("span", null, "确认开始，建立预审任务")),
            h(
              "div",
              { style: s.footer },
              h("button", { style: s.btnSecondary, onClick: () => setScreen("list") }, "返回列表"),
              h(
                "button",
                { style: { ...s.btn, ...(busy || !form.review.confirmed ? s.btnDisabled : {}) }, disabled: busy || !form.review.confirmed, onClick: () => submit({ review: { ...form.review, confirmed: true } }) },
                "下一步：类型与评审单",
              ),
              error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
            ),
          );
        }

        if (step === 2) {
          const options = {
            需求规范: "需求规范评审单 v1（28 项）",
            技术方案: "技术方案评审单 v2（32 项）",
          };
          return h(
            "div",
            null,
            h(
              "div",
              { style: s.grid },
              h("div", { style: s.field },
                h("label", { style: s.label }, "评审类型"),
                h(
                  "select",
                  { style: s.input, value: form.review.type || "需求规范", onChange: (e) => set({ review: { ...form.review, type: e.target.value, checklist: options[e.target.value] || "" } }) },
                  ["需求规范", "技术方案"].map((v) => h("option", { key: v }, v)),
                ),
              ),
              h("div", { style: s.field },
                h("label", { style: s.label }, "评审单"),
                h(
                  "select",
                  { style: s.input, value: form.review.checklist || options[form.review.type] || "", onChange: (e) => set({ review: { ...form.review, checklist: e.target.value } }) },
                  Object.values(options).map((v) => h("option", { key: v }, v)),
                ),
              ),
            ),
            h("div", { style: s.note }, "类型与评审单的适用类型必须一致；一个任务只用一份评审单，中途更换须新建任务。"),
            h(
              "div",
              { style: s.footer },
              h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
              h("button", { style: { ...s.btn, ...(busy ? s.btnDisabled : {}) }, disabled: busy, onClick: () => submit({ review: { ...form.review, checklist: form.review.checklist || options[form.review.type] } }) }, "下一步：文件与资料"),
              error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
            ),
          );
        }

        if (step === 3) {
          const parse = () =>
            run(async () => {
              const link = String(form.link || "").trim();
              if (!link) throw new Error("请先粘贴受审文件链接");
              const doc = await call("doc.read", { target: link });
              set({ review: { ...form.review, file: { url: link, title: doc.title || link, ok: true, chars: doc.chars } }, link: "" });
            });
          return h(
            "div",
            null,
            h(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
              h("input", { style: { ...s.input, flex: "1 1 320px" }, value: form.link || "", placeholder: "粘贴受审文件的飞书云文档链接", onChange: (e) => set({ link: e.target.value }) }),
              h("button", { style: s.btnSecondary, disabled: busy, onClick: parse }, "解析"),
            ),
            form.review.file?.ok
              ? h("div", { style: { ...s.row, marginTop: 10 } }, h("span", { style: { color: C.ok } }, "✓"), h("div", { style: s.rowMain }, h("div", null, form.review.file.title), h("div", { style: s.mono }, `已解析 · ${form.review.file.chars} 字`)))
              : h("div", { style: s.note }, "受审文件是必需项；参考资料可在后续交给助手时补充，缺失时相关检查项标「缺依据」。"),
            h(
              "div",
              { style: s.footer },
              h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
              h(
                "button",
                { style: { ...s.btn, ...(busy || !form.review.file?.ok ? s.btnDisabled : {}) }, disabled: busy || !form.review.file?.ok, onClick: () => submit({ review: { ...form.review } }) },
                "下一步：预审",
              ),
              error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
            ),
          );
        }

        if (step === 4) {
          const issues = form.review.issues || [];
          const dimensions = {};
          for (const item of issues) {
            const key = item.dimension || "内容";
            if (!dimensions[key]) dimensions[key] = [];
            dimensions[key].push(item);
          }
          return h(
            "div",
            null,
            h(
              "div",
              { style: s.row },
              h("span", { style: { color: issues.length ? C.ok : C.warn } }, issues.length ? "✓" : "…"),
              h(
                "div",
                { style: s.rowMain },
                h("div", null, issues.length ? `已生成 ${issues.length} 条意见` : "等待助手预审"),
                h(
                  "div",
                  { style: s.mono },
                  issues.length
                    ? `${issues.filter((i) => i.severity === "严重").length} 严重 · ${issues.filter((i) => i.severity !== "严重").length} 建议`
                    : "",
                ),
              ),
            ),
            issues.length
              ? Object.keys(dimensions).map((dim) =>
                  h(
                    "div",
                    { key: dim },
                    h(
                      "div",
                      { style: s.groupTitle },
                      dim,
                      h("span", { style: s.groupCount }, `${dimensions[dim].length} 条`),
                    ),
                    h(
                      "div",
                      { style: s.list },
                      dimensions[dim].map((it, i) =>
                        h(
                          "div",
                          { key: i, style: s.row },
                          h("span", { style: { color: it.severity === "严重" ? C.err : C.warn } }, it.severity === "严重" ? "●" : "○"),
                          h(
                            "div",
                            { style: s.rowMain },
                            h("div", null, `${it.location || ""} ${it.problem || ""}`),
                            h("div", { style: s.mono }, `依据：${it.basis || "缺依据"}；建议：${it.suggestion || "-"}`),
                          ),
                        ),
                      ),
                    ),
                  ),
                )
              : h("div", { style: s.note }, "点「交给助手预审」，助手按评审单检查后把意见写回 review.issues。"),
            h(
              "div",
              { style: s.footer },
              h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
              h("button", { style: s.btnSecondary, onClick: refreshTask }, "刷新"),
              h("button", { style: s.btnSecondary, onClick: () => handoff(4) }, sessionFor(4) ? "打开本步会话" : "交给助手预审"),
              sessionFor(4)
                ? h("button", { style: s.btnSecondary, onClick: () => handoff(4, undefined, true) }, "新建会话")
                : null,
              h("button", { style: s.btnSecondary, onClick: () => copyPrompt(4) }, "复制指令"),
              h(
                "button",
                { style: { ...s.btn, ...(busy || issues.length === 0 ? s.btnDisabled : {}) }, disabled: busy || issues.length === 0, onClick: () => submit({}) },
                "下一步：意见与修订",
              ),
              error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
            ),
          );
        }

        // step 5
        const issues = form.review.issues || [];
        const decisionLabel = { accepted: "采纳", rejected: "驳回", rewritten: "改写" };
        const setIssue = (index, patch) =>
          set({
            review: {
              ...form.review,
              issues: issues.map((it, i) => (i === index ? { ...it, ...patch } : it)),
            },
          });
        const decided = issues.filter((it) => it.decision).length;
        const allDecided = issues.length > 0 && decided === issues.length;
        const archive = () =>
          run(async () => {
            const rows = issues
              .map(
                (it, i) =>
                  `| ${i + 1} | ${it.severity || "建议"} | ${it.dimension || "内容"} | ${it.location || ""} | ${
                    it.problem || ""
                  } | ${it.basis || "缺依据"} | ${it.suggestion || ""} | ${decisionLabel[it.decision] || "待定"} |`,
              )
              .join("\n");
            const markdown = [
              `# ${form.basic.name || "技术文件"} · 预审意见`,
              "",
              "## 预审范围",
              "",
              `评审类型：${form.review.type}；评审单：${form.review.checklist}；受审文件：${form.review.file?.title || "-"}。`,
              "",
              "## 意见清单",
              "",
              "| # | 等级 | 维度 | 位置 | 问题 | 依据 | 建议 | 处置 |",
              "|---|---|---|---|---|---|---|---|",
              rows,
              "",
              "## 说明",
              "",
              "本意见书只列待确认问题，不输出通过或不通过结论。",
            ].join("\n");
            const result = await call("publish", {
              id: task.id,
              markdown,
              title: `${form.basic.name || "技术文件"}-预审意见`,
              classification: form.basic.classification,
              name: `${form.basic.name || "技术文件"}-预审意见.docx`,
            });
            set({ publish: { url: result.url } });
            setTask(await call("tasks.get", { id: task.id }));
            setNotice("意见书已存档。");
          });
        return h(
          "div",
          null,
          h(
            "div",
            { style: s.row },
            h("span", { style: { color: issues.length ? C.ok : C.warn } }, "●"),
            h(
              "div",
              { style: s.rowMain },
              h("div", null, `${issues.length} 条意见 · 已处置 ${decided}/${issues.length}`),
              h(
                "div",
                { style: s.mono },
                `${issues.filter((i) => i.severity === "严重").length} 严重 · ${issues.filter((i) => i.severity !== "严重").length} 建议；每条必须采纳、驳回或改写，不能留待定`,
              ),
            ),
          ),
          issues.map((it, i) =>
            h(
              "div",
              { key: i, style: { ...s.row, flexDirection: "column", alignItems: "stretch", gap: 8 } },
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: { color: it.severity === "严重" ? C.err : C.warn } }, it.severity === "严重" ? "●" : "○"),
                h(
                  "div",
                  { style: s.rowMain },
                  h("div", null, `${it.location || ""} ${it.problem || ""}`),
                  h("div", { style: s.mono }, `依据：${it.basis || "缺依据"}；建议：${it.suggestion || "-"}`),
                ),
                h("span", { style: s.badge }, it.dimension || "内容"),
              ),
              h(
                "div",
                { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
                ["accepted", "rejected", "rewritten"].map((key) =>
                  h(
                    "button",
                    {
                      key,
                      style: {
                        ...s.btnSecondary,
                        background: it.decision === key ? PRIMARY : "transparent",
                        color: it.decision === key ? "#fff" : C.text,
                      },
                      onClick: () => setIssue(i, { decision: key }),
                    },
                    decisionLabel[key],
                  ),
                ),
                it.decision === "rejected" || it.decision === "rewritten"
                  ? h("input", {
                      style: { ...s.input, flex: "1 1 220px" },
                      value: it.decisionReason || "",
                      placeholder: it.decision === "rejected" ? "驳回理由（必填）" : "改写说明",
                      onChange: (e) => setIssue(i, { decisionReason: e.target.value }),
                    })
                  : null,
              ),
            ),
          ),
          h("div", { style: s.note }, "存档目录：技术资料起草库 / 出稿库 / 预审 / {评审类型} / {任务号} /。协助修订只按意见逐条改，不整体润色、不补写整节。"),
          form.publish?.url
            ? h("div", { style: s.note }, "已存档：", h("a", { style: s.link, href: form.publish.url, target: "_blank", rel: "noreferrer" }, form.publish.url))
            : null,
          h(
            "div",
            { style: s.footer },
            h("button", { style: s.btnSecondary, onClick: backStep }, "上一步"),
            h(
              "button",
              { style: s.btnSecondary, disabled: busy, onClick: () => savePatch({ data: { review: { ...form.review, issues } } }) },
              "保存处置",
            ),
            h("button", { style: s.btnSecondary, onClick: () => handoff(5, "如需协助修订，只改意见指出的位置。") }, sessionFor(5) ? "打开本步会话" : "交给助手协助修订"),
            sessionFor(5)
              ? h("button", { style: s.btnSecondary, onClick: () => handoff(5, "如需协助修订，只改意见指出的位置。", true) }, "新建会话")
              : null,
            h("button", { style: s.btnSecondary, onClick: () => copyPrompt(5, "如需协助修订，只改意见指出的位置。") }, "复制指令"),
            h(
              "button",
              { style: { ...s.btnSecondary, ...(busy || !allDecided ? s.btnDisabled : {}) }, disabled: busy || !allDecided, onClick: archive },
              "存档意见书",
            ),
            h(
              "button",
              {
                style: { ...s.btn, ...(busy || !allDecided || !(form.publish?.url || form.review.archived) ? s.btnDisabled : {}) },
                disabled: busy || !allDecided || !(form.publish?.url || form.review.archived),
                onClick: () => submit({ review: { ...form.review, issues, archived: true } }),
              },
              "完成",
            ),
            error ? h("span", { style: { ...s.status, color: C.err } }, error) : null,
          ),
        );
      };

      return h(
        "div",
        { style: s.page },
        h(
          "div",
          { style: s.inner },
          h("div", { style: s.brandBar }),
          h("div", { style: s.eyebrow }, h("span", { style: s.brandMark }), FORMAL),
          h(
            "div",
            { style: s.head },
            h("button", { style: s.btnGhost, onClick: () => setScreen("list") }, "← 任务列表"),
            h("h1", { style: s.h1 }, title),
            h("span", { style: s.badge }, flow === "review" ? "预审" : "起草"),
            h("span", { style: s.mono }, task.id),
            h(
              "div",
              { style: s.actionsRow },
              h("button", { style: s.btnSecondary, onClick: refreshTask }, "刷新"),
              h("button", { style: { ...s.btnSecondary, borderColor: C.err, color: C.err }, onClick: () => setConfirmId(task.id) }, "删除任务"),
            ),
          ),
          confirmId === task.id
            ? h(
                "div",
                { style: s.dangerBar },
                h("span", null, `删除任务 ${task.id}？删除后不可恢复；已出稿文件与上传资料不会被删除。`),
                h("button", { style: { ...s.btnSecondary, borderColor: C.err, color: C.err }, onClick: () => removeTask(task.id) }, "确认删除"),
                h("button", { style: s.btnSecondary, onClick: () => setConfirmId("") }, "取消"),
              )
            : null,
          h(
            "div",
            { style: s.layout },
            h(
              "aside",
              { style: s.rail },
              h("div", { style: s.railTitle }, title),
              h(
                "div",
                { style: s.railMeta },
                `${flow === "review" ? "技术资料预审" : "技术文件起草"} · ${step}/${names.length}${
                  reached > step ? ` · 已推进到 ${reached}` : ""
                }`,
              ),
              names.map((name, i) => {
                const index = i + 1;
                const current = index === step;
                const done = index <= reached && !current;
                const reachable = index <= reached && !current;
                return h(
                  "div",
                  {
                    key: name,
                    title: current ? "当前步骤" : reachable ? `查看第 ${index} 步「${name}」` : "尚未到达",
                    onClick: reachable ? () => gotoStep(index) : undefined,
                    style: {
                      ...s.stepItem,
                      ...(current ? s.stepCurrent : done ? s.stepDone : s.stepLocked),
                      cursor: reachable ? "pointer" : "default",
                    },
                  },
                  h("span", { style: s.stepIndex }, current ? String(index).padStart(2, "0") : done ? "✓" : String(index).padStart(2, "0")),
                  h("span", null, name),
                );
              }),
            ),
            h(
              "main",
              { style: s.card },
              task.status === "completed"
                ? h(
                    React.Fragment,
                    null,
                    h(
                      "div",
                      { style: s.crumb },
                      `${flow === "review" ? "评审技术资料" : "创建技术资料"} › 已完成`,
                    ),
                    h("h2", { style: s.cardTitle }, "流程已完成"),
                    h(
                      "p",
                      { style: s.cardDesc },
                      flow === "review" ? "预审意见已处置并归档，流程结束。" : "文档已出稿并落到知识库，流程结束。",
                    ),
                    h(
                      "div",
                      { style: { ...s.grid, marginTop: 12 } },
                      stat("总耗时", humanDuration(task.createdAt, completedAt)),
                      stat(flow === "draft" ? "修订次数" : "意见条数", flow === "draft" ? `${revisionCount} 次` : `${revisionCount} 条`),
                      stat("开始时间", fmtTime(task.createdAt)),
                      stat("完成时间", fmtTime(completedAt)),
                      stat("参考资料", `${(form.sources || []).length} 份`),
                      stat("相关会话", `${sessionCount} 个${archivedCount ? " · 已归档" : ""}`),
                    ),
                    flow === "draft" && form.publish?.url
                      ? h(
                          "div",
                          { style: { ...s.note, marginTop: 12 } },
                          form.publish?.title ? `出稿文件：${form.publish.title}　` : "出稿文件：",
                          h("a", { style: s.link, href: form.publish.url, target: "_blank", rel: "noreferrer" }, form.publish.url),
                        )
                      : null,
                    h(
                      "div",
                      { style: s.note },
                      archivedCount
                        ? `本任务相关会话已归档（${archivedCount} 个），可在侧栏归档列表查看。`
                        : "任务已结束；需要再改时从任务列表重新打开，已出稿版本不会自动覆盖。",
                    ),
                    task.summarySync
                      ? h(
                          "div",
                          { style: { ...s.note, color: task.summarySync.ok ? C.ok : C.err } },
                          task.summarySync.ok
                            ? `总结已同步到「文件起草工作总结」${task.summarySync.updated ? "（更新已有记录）" : "（新增记录）"}。`
                            : `总结同步失败：${task.summarySync.error || "未知错误"}`,
                        )
                      : null,
                    h(
                      "div",
                      { style: s.footer },
                      h("button", { style: s.btn, onClick: finishFlow }, "返回任务列表"),
                      h("button", { style: s.btnSecondary, onClick: () => newTask(flow) }, "新建同类任务"),
                    ),
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      "div",
                      { style: s.crumb },
                      `${flow === "review" ? "评审技术资料" : "创建技术资料"} › ${
                        flow === "review" ? form.review.type || form.basic.type || "需求规范" : form.basic.type || "需求规范"
                      } › ${step} ${names[step - 1]}`,
                    ),
                    h("div", { style: s.cardHead }, `${flow === "review" ? "R" : "D"}${step} · 第 ${step} 步 / 共 ${names.length} 步`),
                    h("h2", { style: s.cardTitle }, names[step - 1]),
                    h("p", { style: s.cardDesc }, STEP_DESC[flow][step - 1] || ""),
                    stepBody(),
                  ),
            ),
          ),
        ),
      );
    }

    function JswjIcon(props) {
      const size = props && props.size ? props.size : 16;
      return h(
        "span",
        { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, color: props && props.active ? C.brand : "currentColor" } },
        h(
          "svg",
          { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, "aria-hidden": true },
          h("rect", { x: 3, y: 1.5, width: 10, height: 13, rx: 1.6 }),
          h("path", { d: "M5.5 5h5M5.5 8h5M5.5 11h2.6" }),
        ),
      );
    }

    function requestId() {
      const crypto = globalThis.crypto;
      if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
      return `jswj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function timeZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    }

    function apply(ctx) {
      const startAgent = async (text, title, taskId, step) => {
        const started = await call("session.start", { text, timeZone: timeZone(), title, taskId, step });
        const sessionId = started && started.sessionId;
        if (!sessionId) throw new Error("创建会话失败：未返回 sessionId");
        ctx.uiWorkspace.openSession(sessionId);
      };

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            inject: () => ({
              startAgent,
              openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
            }),
          },
          JswjPage,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: () => "技术文件起草" },
          JswjIcon,
        ),
      );
    }

    return { inject, apply };
  },
});
