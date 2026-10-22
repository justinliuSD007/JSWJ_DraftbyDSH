/**
 * 客户端入口：一个可交互的整页视图 + 一个侧边栏入口。
 *
 * 交互路径：页面收集基本信息 → 通过 ctx.remote.session.create/prompt 新建会话并投递结构化指令
 * → ctx.uiWorkspace.openSession 切到对话，由助手按 Skill 继续执行。
 * 不在页面里重复业务逻辑，页面只负责「收集意图」和「展示状态」。
 *
 * 不使用 JSX、不引入第三方 UI 库；只用 React 宿主模块与主题变量。
 */
window.__ModuleLoader__.load({
  id: "@govy/dsh-plugin-jswj-draft",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const PANEL_ID = "jswj-draft";
    const WIKI_URL = "https://govy.feishu.cn/wiki/K3NpwxFzribxgOkzFxaczeH7nXf";

    const inject = ["slots", "remote", "remote.session", "uiWorkspace"];

    const C = {
      text: "var(--dsw-alias-label-primary)",
      sub: "var(--dsw-alias-label-secondary)",
      line: "var(--dsw-alias-border-l1)",
      line2: "var(--dsw-alias-border-l2)",
      base: "var(--dsw-alias-bg-base)",
      layer1: "var(--dsw-alias-bg-layer-1)",
      layer2: "var(--dsw-alias-bg-layer-2)",
      brand: "var(--dsw-alias-brand-primary)",
      ok: "var(--dsw-alias-state-success-primary)",
      warn: "var(--dsw-alias-state-warn-primary)",
      err: "var(--dsw-alias-state-error-primary)",
    };

    const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";

    const DRAFT_STEPS = [
      ["01", "基本信息", "文件名称、文件类型、密级（L1/L2/L3）、编号可空", "名称非空、类型与密级已选"],
      ["02", "文档属性", "层级、板块、归档位置，目录由属性推导", "三项齐备、目标目录可建"],
      ["03", "参考资料", "云文档链接或上传件，逐份确认解析结果", "至少一份解析成功"],
      ["04", "大纲与纲要", "章节到三、四级，只就一、二级确认要点", "覆盖模板必备章节"],
      ["05", "生成", "逐章生成正文，表格结构化，图形有数据才画", "全部章节完成"],
      ["06", "自检", "内容、格式、其他三类检查", "无阻断项"],
      ["07", "修订", "先汇总要点并确认，再定向修订", "至多三轮，超轮需确认"],
      ["08", "出稿", "渲染 GY-F003 Word，发布到知识库对应目录", "文件已落位、回执已生成"],
    ];

    const REVIEW_STEPS = [
      ["01", "确认开始", "说明范围与预计耗时", "已确认"],
      ["02", "类型与评审单", "按评审类型加载评审单并冻结版本", "类型与评审单一致"],
      ["03", "文件与资料", "受审文件必需，参考资料可选", "受审文件解析成功"],
      ["04", "预审", "按评审单审内容、按模板审格式、查术语与编号", "三类检查均有结论"],
      ["05", "意见与修订", "输出意见清单并存档，询问是否协助修订", "意见书已写入任务目录"],
    ];

    const CHAIN = [
      ["定稿", "Markdown 正文按章节组织，[E#] 引用保留"],
      ["渲染", "jswj_render_docx 套 GY-F003，回填封面与页眉"],
      ["发布", "jswj_publish_docx 上传为知识库文件节点"],
      ["回执", "返回节点 token 与链接，写入任务记录"],
    ];

    const TREE = [
      ["技术资料起草库", "知识空间 7698962670346636559", 0],
      ["首页", "docx", 1],
      ["技术文件模板", "docx · GY-F003 模板源", 1],
      ["技术资料草稿库", "docx · 出稿默认落位", 1],
      ["{层级} / {板块} / {文件类型} /", "按文档属性自动创建", 2],
    ];

    const s = {
      page: {
        minHeight: "100%",
        background: C.base,
        color: C.text,
        padding: "32px 28px 56px",
        boxSizing: "border-box",
      },
      inner: { maxWidth: 1000, margin: "0 auto" },
      eyebrow: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO,
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: C.brand,
        marginBottom: 10,
      },
      dot: { width: 6, height: 6, borderRadius: 3, background: C.brand },
      h1: { fontSize: 24, lineHeight: 1.35, fontWeight: 650, margin: "0 0 8px" },
      lead: { margin: "0 0 24px", color: C.sub, fontSize: 14, lineHeight: 1.75, maxWidth: 760 },
      section: { marginBottom: 28 },
      sectionHead: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
        flexWrap: "wrap",
      },
      sectionTitle: { fontSize: 16, fontWeight: 600, margin: 0 },
      sectionMeta: { fontSize: 12, color: C.sub },
      card: {
        border: `1px solid ${C.line}`,
        background: C.layer1,
        borderRadius: 14,
        padding: "18px 18px 14px",
      },
      formGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 12,
      },
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
        outline: "none",
        boxSizing: "border-box",
        width: "100%",
      },
      actions: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginTop: 16,
        paddingTop: 14,
        borderTop: `1px solid ${C.line}`,
      },
      btn: {
        height: 34,
        padding: "0 16px",
        borderRadius: 8,
        border: "none",
        background: C.brand,
        color: "#fff",
        fontSize: 13,
        fontWeight: 550,
        cursor: "pointer",
      },
      btnSecondary: {
        height: 34,
        padding: "0 16px",
        borderRadius: 8,
        border: `1px solid ${C.line2}`,
        background: "transparent",
        color: C.text,
        fontSize: 13,
        cursor: "pointer",
      },
      btnGhost: {
        height: 34,
        padding: "0 12px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: C.sub,
        fontSize: 13,
        cursor: "pointer",
        textDecoration: "underline",
      },
      link: { fontSize: 13, color: C.brand, textDecoration: "none" },
      status: { fontSize: 12.5, lineHeight: 1.6, marginLeft: "auto", maxWidth: 420 },
      row: {
        display: "grid",
        gridTemplateColumns: "44px 116px 1fr",
        gap: 12,
        alignItems: "start",
        padding: "12px 0",
        borderTop: `1px solid ${C.line}`,
      },
      rowFirst: { borderTop: "none" },
      index: { fontFamily: MONO, fontSize: 12, color: C.sub, paddingTop: 2 },
      stepName: { fontSize: 14, fontWeight: 550 },
      stepDesc: { fontSize: 13, color: C.sub, lineHeight: 1.6 },
      gate: {
        marginTop: 4,
        fontSize: 12,
        color: C.sub,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      },
      gateDot: { width: 5, height: 5, borderRadius: 3, background: C.ok, flex: "0 0 auto" },
      chain: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 10,
      },
      chainCard: {
        border: `1px solid ${C.line}`,
        background: C.layer2,
        borderRadius: 12,
        padding: "14px 14px 12px",
      },
      chainStep: { fontFamily: MONO, fontSize: 11, color: C.brand, marginBottom: 6 },
      chainTitle: { fontSize: 14, fontWeight: 600, marginBottom: 4 },
      chainDesc: { fontSize: 12, color: C.sub, lineHeight: 1.6 },
      tree: {
        border: `1px solid ${C.line}`,
        background: C.layer1,
        borderRadius: 14,
        padding: "16px 18px",
        fontFamily: MONO,
        fontSize: 13,
        lineHeight: 2,
      },
      treeRow: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" },
      treeName: { color: C.text },
      treeMeta: { color: C.sub, fontSize: 12 },
      note: {
        marginTop: 6,
        border: `1px dashed ${C.line2}`,
        borderRadius: 12,
        padding: "14px 16px",
        color: C.sub,
        fontSize: 13,
        lineHeight: 1.7,
      },
      code: { fontFamily: MONO, fontSize: 12, color: C.text },
    };

    function Section(props) {
      return h(
        "section",
        { style: props.style ?? s.section },
        h(
          "div",
          { style: s.sectionHead },
          h("h2", { style: s.sectionTitle }, props.title),
          props.meta ? h("span", { style: s.sectionMeta }, props.meta) : null,
        ),
        props.children,
      );
    }

    function Field(props) {
      return h(
        "div",
        { style: { ...s.field, gridColumn: props.wide ? "1 / -1" : undefined } },
        h("label", { style: s.label, htmlFor: props.id }, props.label),
        props.children,
      );
    }

    function StepTable(props) {
      return h(
        "div",
        { style: s.card },
        props.steps.map((step, i) =>
          h(
            "div",
            { key: step[0], style: { ...s.row, ...(i === 0 ? s.rowFirst : {}) } },
            h("div", { style: s.index }, step[0]),
            h("div", { style: s.stepName }, step[1]),
            h(
              "div",
              null,
              h("div", { style: s.stepDesc }, step[2]),
              h(
                "div",
                { style: s.gate },
                h("span", { style: s.gateDot }),
                h("span", null, "门禁：", step[3]),
              ),
            ),
          ),
        ),
      );
    }

    function Chain() {
      return h(
        "div",
        { style: s.chain },
        CHAIN.map((item, i) =>
          h(
            "div",
            { key: item[0], style: s.chainCard },
            h("div", { style: s.chainStep }, `STEP ${i + 1}`),
            h("div", { style: s.chainTitle }, item[0]),
            h("div", { style: s.chainDesc }, item[1]),
          ),
        ),
      );
    }

    function Tree() {
      return h(
        "div",
        { style: s.tree },
        TREE.map((node, i) =>
          h(
            "div",
            { key: i, style: { ...s.treeRow, paddingLeft: node[2] * 18 } },
            h("span", { style: s.treeName }, `${node[2] === 0 ? "" : node[2] === 1 ? "├─ " : "└─ "}${node[0]}`),
            h("span", { style: s.treeMeta }, node[1]),
          ),
        ),
      );
    }

    function JswjPage(props) {
      const [form, setForm] = React.useState({
        title: "",
        type: "需求规范",
        classification: "L2 重要/秘密",
        tier: "T2 子系统级",
        board: "总体",
      });
      const [status, setStatus] = React.useState({ kind: "idle", text: "填写信息后点击「开始起草」，会在新会话中启动流程。" });
      const [busy, setBusy] = React.useState(false);

      const update = (key) => (event) => {
        setForm((current) => ({ ...current, [key]: event.target.value }));
      };

      const run = async (kind) => {
        if (busy) return;
        if (kind === "draft" && !form.title.trim()) {
          setStatus({ kind: "error", text: "第①步门禁未过：文件名称不能为空。" });
          return;
        }
        setBusy(true);
        setStatus({ kind: "pending", text: "正在创建会话并投递指令…" });
        try {
          await props.startFlow(kind, form);
          setStatus({ kind: "ok", text: "已在新会话中启动，请到对话里确认下一步。" });
        } catch (err) {
          setStatus({
            kind: "error",
            text: "启动失败：" + String((err && err.message) || err) + "。可点「复制指令」粘贴到对话中继续。",
          });
        } finally {
          setBusy(false);
        }
      };

      const copy = async () => {
        try {
          await props.copyCommand(form);
          setStatus({ kind: "ok", text: "指令已复制，可粘贴到任意对话中。" });
        } catch (err) {
          setStatus({ kind: "error", text: "复制失败：" + String((err && err.message) || err) });
        }
      };

      const statusColor =
        status.kind === "ok" ? C.ok : status.kind === "error" ? C.err : status.kind === "pending" ? C.warn : C.sub;

      return h(
        "div",
        { style: s.page },
        h(
          "div",
          { style: s.inner },
          h("div", { style: s.eyebrow }, h("span", { style: s.dot }), "JSWJ_DraftbyDSH"),
          h("h1", { style: s.h1 }, "技术文件起草与 AI 预审"),
          h(
            "p",
            { style: s.lead },
            "页面负责收集意图，助手负责执行。填好基本信息后点「开始起草」，会在新会话中把结构化指令交给助手，由它按 Skill 的八步流程继续；预审同理。",
          ),
          h(
            Section,
            { title: "快速开始", meta: "点击后自动切到对话" },
            h(
              "div",
              { style: s.card },
              h(
                "div",
                { style: s.formGrid },
                h(
                  Field,
                  { label: "文件名称（必填）", wide: true },
                  h("input", {
                    id: "jswj-title",
                    style: s.input,
                    value: form.title,
                    placeholder: "例如：RCU 需求规范",
                    onChange: update("title"),
                  }),
                ),
                h(
                  Field,
                  { label: "文件类型" },
                  h(
                    "select",
                    { style: s.input, value: form.type, onChange: update("type") },
                    h("option", null, "需求规范"),
                    h("option", null, "技术方案"),
                  ),
                ),
                h(
                  Field,
                  { label: "密级" },
                  h(
                    "select",
                    { style: s.input, value: form.classification, onChange: update("classification") },
                    h("option", null, "L1 公开"),
                    h("option", null, "L2 重要/秘密"),
                    h("option", null, "L3 一般"),
                  ),
                ),
                h(
                  Field,
                  { label: "层级" },
                  h(
                    "select",
                    { style: s.input, value: form.tier, onChange: update("tier") },
                    ["T0 飞机级", "T1 系统级", "T2 子系统级", "T3 设备级", "T4 软硬件级"].map((v) =>
                      h("option", { key: v }, v),
                    ),
                  ),
                ),
                h(
                  Field,
                  { label: "板块" },
                  h(
                    "select",
                    { style: s.input, value: form.board, onChange: update("board") },
                    ["总体", "电子", "试验试飞", "动力"].map((v) => h("option", { key: v }, v)),
                  ),
                ),
              ),
              h(
                "div",
                { style: s.actions },
                h(
                  "button",
                  {
                    type: "button",
                    style: { ...s.btn, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" },
                    disabled: busy,
                    onClick: () => run("draft"),
                  },
                  "开始起草",
                ),
                h(
                  "button",
                  {
                    type: "button",
                    style: { ...s.btnSecondary, opacity: busy ? 0.6 : 1 },
                    disabled: busy,
                    onClick: () => run("review"),
                  },
                  "开始预审",
                ),
                h("button", { type: "button", style: s.btnGhost, onClick: copy }, "复制指令"),
                h(
                  "a",
                  { style: { ...s.link, marginLeft: "auto" }, href: WIKI_URL, target: "_blank", rel: "noreferrer" },
                  "打开知识库 ↗",
                ),
                h("span", { style: { ...s.status, color: statusColor }, role: "status" }, status.text),
              ),
            ),
          ),
          h(Section, { title: "出稿链路", meta: "渲染与发布是两个独立工具" }, h(Chain)),
          h(
            Section,
            { title: "业务流 1 · 创建技术文档", meta: "8 步 · 每步先过门禁" },
            h(StepTable, { steps: DRAFT_STEPS }),
          ),
          h(
            Section,
            { title: "业务流 2 · 技术资料 AI 预审", meta: "5 步 · 只出待确认问题" },
            h(StepTable, { steps: REVIEW_STEPS }),
          ),
          h(Section, { title: "知识库落位", meta: "当前实际结构" }, h(Tree)),
          h(
            "div",
            { style: s.note },
            "工具：",
            h("span", { style: s.code }, "jswj_ping"),
            " / ",
            h("span", { style: s.code }, "jswj_wiki_list"),
            " / ",
            h("span", { style: s.code }, "jswj_doc_read"),
            " / ",
            h("span", { style: s.code }, "jswj_wiki_create"),
            " / ",
            h("span", { style: s.code }, "jswj_doc_append"),
            " / ",
            h("span", { style: s.code }, "jswj_render_docx"),
            " / ",
            h("span", { style: s.code }, "jswj_publish_docx"),
            "。页面只负责发起，执行与确认都在对话里完成。",
          ),
        ),
      );
    }

    function JswjIcon(props) {
      const size = props && props.size ? props.size : 16;
      return h(
        "span",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            color: props && props.active ? C.brand : "currentColor",
          },
        },
        h(
          "svg",
          {
            width: size,
            height: size,
            viewBox: "0 0 16 16",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.4,
            "aria-hidden": true,
          },
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

    function draftPrompt(form) {
      return [
        "【JSWJ_DraftbyDSH · 业务流1：创建技术文档】",
        "请加载 jswj-draftbydsh 技能，先调用 jswj_ping 自检，再从第①步开始。",
        "已知信息：",
        `- 文件名称：${form.title.trim()}`,
        `- 文件类型：${form.type}`,
        `- 密级：${form.classification}`,
        `- 层级：${form.tier}`,
        `- 板块：${form.board}`,
        "缺失的项请逐轮向我确认（每轮不超过 5 项），门禁未满足前不要进入下一步。",
      ].join("\n");
    }

    function reviewPrompt() {
      return [
        "【JSWJ_DraftbyDSH · 业务流2：技术资料 AI 预审】",
        "请加载 jswj-draftbydsh 技能，先调用 jswj_ping 自检，再按第①步确认评审范围与预计耗时。",
        "我会提供受审文件与评审单；先不要执行预审，等我给出文件。",
      ].join("\n");
    }

    function apply(ctx) {
      const startFlow = async (kind, form) => {
        const content = kind === "draft" ? draftPrompt(form) : reviewPrompt();
        const created = await ctx.remote.session.create({});
        const sessionId = created && created.sessionId;
        if (!sessionId) throw new Error("会话创建失败：未返回 sessionId");
        await ctx.remote.session.prompt({
          requestId: requestId(),
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: content }],
          clientTimeZone: timeZone(),
        });
        ctx.uiWorkspace.openSession(sessionId);
      };

      const copyCommand = async (form) => {
        const text = draftPrompt(form);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          return text;
        }
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        return text;
      };

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            inject: () => ({ startFlow, copyCommand }),
          },
          JswjPage,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 20,
            label: () => "技术文件",
          },
          JswjIcon,
        ),
      );
    }

    return { inject, apply };
  },
});
