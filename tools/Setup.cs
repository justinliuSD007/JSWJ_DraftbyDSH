using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace JswjSetup
{
#if BUNDLED
    /** 构建时注入的内置凭据；仅在带凭据的专用安装器中编译进来。 */
    internal static class BundledCreds
    {
        public const string AppId = SetupCreds.AppId;
        public const string AppSecret = SetupCreds.AppSecret;
    }
#endif

    internal static class Program
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            if (args != null && args.Length > 0 && args[0] == "--selftest")
            {
                return SelfTest();
            }
            if (args != null && args.Length > 2 && args[0] == "--auto")
            {
                return AutoInstall(args[1], args[2]);
            }
            if (args != null && args.Length > 0 && args[0] == "--uninstall")
            {
                return AutoUninstall();
            }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallForm());
            return 0;
        }

        private static int AutoUninstall()
        {
            var log = new StringBuilder();
            var path = Path.Combine(Path.GetTempPath(), "jswj-setup-uninstall.log");
            try
            {
                var installer = new Installer();
                installer.EnsureDshClosed();
                installer.Uninstall(delegate(string s) { log.AppendLine(s); });
                log.AppendLine("RESULT: OK");
                File.WriteAllText(path, log.ToString(), new UTF8Encoding(false));
                return 0;
            }
            catch (Exception ex)
            {
                log.AppendLine("RESULT: FAIL " + ex.Message);
                File.WriteAllText(path, log.ToString(), new UTF8Encoding(false));
                return 1;
            }
        }

        private static int AutoInstall(string appId, string appSecret)
        {
            var log = new StringBuilder();
            var path = Path.Combine(Path.GetTempPath(), "jswj-setup-auto.log");
            try
            {
                var installer = new Installer();
                log.AppendLine("profile: " + installer.ProfileDir);
                log.AppendLine("install: " + installer.InstallDir);
                installer.EnsureDshClosed();
                installer.CopyPayload(delegate(string s) { log.AppendLine(s); });
                installer.RegisterBundle(delegate(string s) { log.AppendLine(s); });
                installer.LinkInstallDir(delegate(string s) { log.AppendLine(s); });
                installer.WriteConfig(appId, appSecret, delegate(string s) { log.AppendLine(s); });
                log.AppendLine("RESULT: OK");
                File.WriteAllText(path, log.ToString(), new UTF8Encoding(false));
                return 0;
            }
            catch (Exception ex)
            {
                log.AppendLine("RESULT: FAIL " + ex.Message);
                File.WriteAllText(path, log.ToString(), new UTF8Encoding(false));
                return 1;
            }
        }

        private static int SelfTest()
        {
            var log = new StringBuilder();
            try
            {
                Installer.CheckEnvironment(log);
                log.AppendLine("RESULT: OK");
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "jswj-setup-selftest.log"), log.ToString(), new UTF8Encoding(false));
                return 0;
            }
            catch (Exception ex)
            {
                log.AppendLine("RESULT: FAIL " + ex.Message);
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "jswj-setup-selftest.log"), log.ToString(), new UTF8Encoding(false));
                return 1;
            }
        }
    }

    internal sealed class Installer
    {
        public const string DepName = "@govy/dsh-plugin-jswj-draft";
        public readonly string PayloadDir;
        public readonly string ProfileDir;
        public readonly string InstallDir;
        public string Version = "";

        public Installer()
        {
            PayloadDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string profileOverride = Environment.GetEnvironmentVariable("JSWJ_PROFILE_DIR");
            string installOverride = Environment.GetEnvironmentVariable("JSWJ_INSTALL_DIR");
            ProfileDir = string.IsNullOrEmpty(profileOverride)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh\\profiles\\desktop")
                : profileOverride;
            InstallDir = string.IsNullOrEmpty(installOverride)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JSWJ-Draft\\plugin")
                : installOverride;
            Version = ReadVersion();
        }

        private string ReadVersion()
        {
            try
            {
                string pkg = Path.Combine(PayloadDir, "package.json");
                if (!File.Exists(pkg)) return "";
                var ser = new JavaScriptSerializer();
                var dict = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(pkg, Encoding.UTF8));
                object v;
                if (dict != null && dict.TryGetValue("version", out v) && v != null) return Convert.ToString(v);
            }
            catch { }
            return "";
        }

        public static void CheckEnvironment(StringBuilder log)
        {
            var explicitProfile = Environment.GetEnvironmentVariable("JSWJ_PROFILE_DIR");
            string profile = string.IsNullOrEmpty(explicitProfile)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh\\profiles\\desktop")
                : explicitProfile;

            log.AppendLine("payload: " + AppDomain.CurrentDomain.BaseDirectory);
            log.AppendLine("profile: " + profile);
            log.AppendLine("profile exists: " + Directory.Exists(profile));
            if (!File.Exists(Path.Combine(profile, "package.json")))
                throw new ApplicationException("未找到 DSH profile：" + profile);

            bool running = false;
            try
            {
                foreach (var p in Process.GetProcessesByName("DeepSeek Harness")) { running = true; }
            }
            catch { }
            log.AppendLine("DSH running: " + running);
            log.AppendLine("localappdata: " + Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
        }

        private readonly List<string[]> _backups = new List<string[]>();

        private string BackupFile(string path)
        {
            if (!File.Exists(path)) return null;
            string bak = path + ".bak-setup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
            File.Copy(path, bak, true);
            _backups.Add(new string[] { path, bak });
            return bak;
        }

        public void Rollback(Action<string> log)
        {
            for (int i = _backups.Count - 1; i >= 0; i--)
            {
                try
                {
                    File.Copy(_backups[i][1], _backups[i][0], true);
                    log("已回滚：" + Path.GetFileName(_backups[i][0]));
                }
                catch (Exception ex)
                {
                    log("回滚失败：" + Path.GetFileName(_backups[i][0]) + " - " + ex.Message);
                }
            }
        }

        public void ValidatePayload()
        {
            string pkg = Path.Combine(PayloadDir, "package.json");
            string lib = Path.Combine(PayloadDir, @"lib\index.js");
            string client = Path.Combine(PayloadDir, @"lib\client.js");
            string template = Path.Combine(PayloadDir, @"template\GY-F003-cleaned.docx");
            var missing = new List<string>();
            if (!File.Exists(pkg)) missing.Add("package.json");
            if (!File.Exists(lib)) missing.Add("lib/index.js");
            if (!File.Exists(client)) missing.Add("lib/client.js");
            if (!File.Exists(template)) missing.Add("template/GY-F003-cleaned.docx");
            if (missing.Count > 0)
                throw new ApplicationException("安装包不完整，缺少：" + string.Join("、", missing.ToArray()) + "。请重新下载安装包。");
        }

        public void Uninstall(Action<string> log)
        {
            log("移除目录联接");
            string link = Path.Combine(ProfileDir, @"node_modules\@govy\dsh-plugin-jswj-draft");
            if (Directory.Exists(link))
            {
                try { Directory.Delete(link, true); } catch (Exception ex) { log("联接删除失败：" + ex.Message); }
            }

            log("从 profile 中移除登记");
            string pkgPath = Path.Combine(ProfileDir, "package.json");
            if (File.Exists(pkgPath))
            {
                BackupFile(pkgPath);
                var ser = new JavaScriptSerializer();
                var root = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(pkgPath, Encoding.UTF8));
                if (root != null)
                {
                    object depsObj;
                    if (root.TryGetValue("dependencies", out depsObj))
                    {
                        var deps = depsObj as Dictionary<string, object>;
                        if (deps != null) deps.Remove(DepName);
                    }
                    object dshObj;
                    if (root.TryGetValue("dsh", out dshObj))
                    {
                        var dsh = dshObj as Dictionary<string, object>;
                        object profObj;
                        if (dsh != null && dsh.TryGetValue("profile", out profObj))
                        {
                            var prof = profObj as Dictionary<string, object>;
                            if (prof != null && prof.ContainsKey("bundles"))
                            {
                                var kept = new List<object>();
                                foreach (var b in ToList(prof, "bundles"))
                                {
                                    if (Convert.ToString(b) != DepName) kept.Add(b);
                                }
                                prof["bundles"] = kept.ToArray();
                            }
                        }
                    }
                    File.WriteAllText(pkgPath, ser.Serialize(root), new UTF8Encoding(false));
                }
            }

            log("清除凭据配置");
            string patchPath = Path.Combine(ProfileDir, "cordis.patch.yml");
            if (File.Exists(patchPath))
            {
                BackupFile(patchPath);
                var kept = new List<string>();
                bool skip = false;
                foreach (var line in File.ReadAllLines(patchPath, Encoding.UTF8))
                {
                    if (System.Text.RegularExpressions.Regex.IsMatch(line, @"^- id:\s*jswj-draft\s*$")) { skip = true; continue; }
                    if (skip && line.StartsWith("- id:")) skip = false;
                    if (!skip) kept.Add(line);
                }
                while (kept.Count > 0)
                {
                    string last = kept[kept.Count - 1].Trim();
                    if (last.Length == 0 || last.StartsWith("# 技术文件起草")) kept.RemoveAt(kept.Count - 1);
                    else break;
                }
                File.WriteAllLines(patchPath, kept.ToArray(), new UTF8Encoding(false));
            }

            log("删除插件文件");
            if (Directory.Exists(InstallDir))
            {
                try { Directory.Delete(InstallDir, true); } catch (Exception ex) { log("文件删除失败：" + ex.Message); }
            }
            log("卸载完成。请重新打开 DSH。");
        }

        public void EnsureDshClosed()
        {
            if (Environment.GetEnvironmentVariable("JSWJ_SKIP_PROCESS_CHECK") == "1") return;
            foreach (var p in Process.GetProcessesByName("DeepSeek Harness"))
            {
                throw new ApplicationException("检测到 DSH 正在运行。请完全退出 DSH（不是最小化）后重新运行安装器。");
            }
        }

        public void CopyPayload(Action<string> log)
        {
            log("复制插件文件到 " + InstallDir);
            Directory.CreateDirectory(InstallDir);
            CopyTree(PayloadDir, InstallDir);
        }

        private static void CopyTree(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var file in Directory.GetFiles(from))
            {
                string name = Path.GetFileName(file);
                if (name.Equals("Setup.exe", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(file, Path.Combine(to, name), true);
            }
            foreach (var dir in Directory.GetDirectories(from))
            {
                CopyTree(dir, Path.Combine(to, Path.GetFileName(dir)));
            }
        }

        public void RegisterBundle(Action<string> log)
        {
            string pkgPath = Path.Combine(ProfileDir, "package.json");
            BackupFile(pkgPath);
            var ser = new JavaScriptSerializer();
            var root = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(pkgPath, Encoding.UTF8));
            if (root == null) root = new Dictionary<string, object>();

            var deps = GetDict(root, "dependencies");
            deps[DepName] = "file:" + InstallDir.Replace("\\", "/");

            var dsh = GetDict(root, "dsh");
            var profile = GetDict(dsh, "profile");
            var bundles = ToList(profile, "bundles");
            bool found = false;
            foreach (var b in bundles) { if (Convert.ToString(b) == DepName) found = true; }
            if (!found) bundles.Add(DepName);
            profile["bundles"] = bundles.ToArray();
            dsh["profile"] = profile;
            root["dsh"] = dsh;

            File.WriteAllText(pkgPath, ser.Serialize(root), new UTF8Encoding(false));
            log("已登记 bundle：" + DepName);
        }

        private static Dictionary<string, object> GetDict(Dictionary<string, object> parent, string key)
        {
            object v;
            if (parent.TryGetValue(key, out v))
            {
                var d = v as Dictionary<string, object>;
                if (d != null) return d;
            }
            var created = new Dictionary<string, object>();
            parent[key] = created;
            return created;
        }

        private static List<object> ToList(Dictionary<string, object> parent, string key)
        {
            object v;
            var list = new List<object>();
            if (parent.TryGetValue(key, out v) && v != null && !(v is string))
            {
                // JavaScriptSerializer 对数组可能给出 object[] 或 ArrayList，须按 IEnumerable 兜底，
                // 否则会静默丢弃已有 bundles，导致安装后 DSH 无法启动。
                var seq = v as System.Collections.IEnumerable;
                if (seq != null)
                {
                    foreach (var item in seq) list.Add(item);
                }
            }
            return list;
        }

        public void LinkInstallDir(Action<string> log)
        {
            string scope = Path.Combine(ProfileDir, "node_modules\\@govy");
            Directory.CreateDirectory(scope);
            string link = Path.Combine(scope, "dsh-plugin-jswj-draft");
            if (Directory.Exists(link))
            {
                try { Directory.Delete(link, false); }
                catch { }
                if (Directory.Exists(link))
                {
                    try { Directory.Delete(link, true); } catch { }
                }
            }
            if (Directory.Exists(link))
                throw new ApplicationException("无法替换已有目录：" + link + "。请手动删除后重试。");

            var psi = new ProcessStartInfo("cmd.exe", "/c mklink /J \"" + link + "\" \"" + InstallDir + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            var proc = Process.Start(psi);
            proc.WaitForExit();
            if (!Directory.Exists(link))
            {
                log("目录联接创建失败，改为直接复制");
                CopyTree(InstallDir, link);
            }
            else
            {
                log("已建立目录联接");
            }
        }

        public void WriteConfig(string appId, string appSecret, Action<string> log)
        {
            string patchPath = Path.Combine(ProfileDir, "cordis.patch.yml");
            var kept = new List<string>();
            if (File.Exists(patchPath))
            {
                BackupFile(patchPath);
                bool skip = false;
                foreach (var line in File.ReadAllLines(patchPath, Encoding.UTF8))
                {
                    if (System.Text.RegularExpressions.Regex.IsMatch(line, "^- id:\\s*jswj-draft\\s*$"))
                    {
                        skip = true;
                        continue;
                    }
                    if (skip && line.StartsWith("- id:")) skip = false;
                    if (!skip) kept.Add(line);
                }
            }

            kept.Add("");
            kept.Add("# 技术文件起草（JSWJ_DraftbyDSH）");
            kept.Add("- id: jswj-draft");
            kept.Add("  config:");
            kept.Add("    appId: \"" + appId + "\"");
            kept.Add("    appSecret: \"" + appSecret + "\"");
            kept.Add("    spaceId: \"7698962670346636559\"");
            kept.Add("    rootToken: \"\"");
            kept.Add("    draftRootToken: \"K3NpwxFzribxgOkzFxaczeH7nXf\"");
            kept.Add("    wikiBaseUrl: \"https://govy.feishu.cn\"");
            kept.Add("    wikiHomeUrl: \"https://govy.feishu.cn/wiki/Arv4wKueCiTuS3kddZrcwGHvnOb\"");
            kept.Add("    summaryWikiToken: \"P77ZwJyDIiIfoJkmUVccrk7mnfc\"");
            kept.Add("    pythonPath: \"\"");
            kept.Add("    outputDir: \"\"");

            File.WriteAllLines(patchPath, kept.ToArray(), new UTF8Encoding(false));
            log("已写入凭据配置");
        }

        private static string Timestamp()
        {
            return DateTime.Now.ToString("yyyyMMdd-HHmmss");
        }
    }

    internal sealed class InstallForm : Form
    {
        private readonly TextBox _appId = new TextBox();
        private readonly TextBox _appSecret = new TextBox();
        private readonly Button _install = new Button();
        private readonly Button _uninstall = new Button();
        private readonly Button _cancel = new Button();
        private readonly TextBox _log = new TextBox();
        private readonly Installer _installer = new Installer();
        private readonly Label _status = new Label();

        public InstallForm()
        {
            Text = "技术文件起草（JSWJ_DraftbyDSH）安装";
            ClientSize = new Size(560, 470);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9f);

            var title = new Label();
            title.Text = string.IsNullOrEmpty(_installer.Version)
                ? "技术文件起草（JSWJ_DraftbyDSH）"
                : "技术文件起草（JSWJ_DraftbyDSH）" + _installer.Version;
            title.Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold);
            title.SetBounds(24, 20, 500, 30);
            Controls.Add(title);

            var note = new Label();
            note.Text = "安装前请完全退出 DSH。安装需要飞书应用的 appId 与 appSecret（仅保存在本机）。";
            note.ForeColor = Color.FromArgb(100, 106, 115);
            note.SetBounds(24, 54, 500, 34);
            Controls.Add(note);

            var appIdLabel = LabelAt("feishu appId", 24, 98);
            Controls.Add(appIdLabel);
            _appId.SetBounds(24, 120, 500, 26);
            _appId.Text = "cli_";
            Controls.Add(_appId);

            var secretLabel = LabelAt("appSecret", 24, 158);
            Controls.Add(secretLabel);
            _appSecret.SetBounds(24, 180, 500, 26);
            _appSecret.UseSystemPasswordChar = true;
            Controls.Add(_appSecret);

#if BUNDLED
            // 内置凭据版本：不显示输入框，安装即完成。
            appIdLabel.Visible = false;
            secretLabel.Visible = false;
            _appId.Visible = false;
            _appSecret.Visible = false;
            _appId.Text = BundledCreds.AppId;
            _appSecret.Text = BundledCreds.AppSecret;
            note.Text = "内置凭据已配置，直接点「开始安装」即可。安装前请完全退出 DSH。";
            _install.Top -= 120;
            _cancel.Top -= 120;
            _uninstall.Top -= 120;
            _status.Top -= 120;
            _log.Top -= 120;
            _log.Height += 120;
#endif

            _install.Text = "开始安装";
            _install.SetBounds(24, 222, 150, 36);
            _install.BackColor = Color.FromArgb(51, 112, 255);
            _install.ForeColor = Color.White;
            _install.FlatStyle = FlatStyle.Flat;
            _install.Click += OnInstall;
            Controls.Add(_install);

            _cancel.Text = "取消";
            _cancel.SetBounds(186, 222, 96, 36);
            _cancel.Click += delegate { Close(); };
            Controls.Add(_cancel);

            _uninstall.Text = "卸载";
            _uninstall.SetBounds(432, 222, 92, 36);
            _uninstall.FlatStyle = FlatStyle.Flat;
            _uninstall.Click += OnUninstall;
            Controls.Add(_uninstall);

            _status.SetBounds(24, 268, 500, 22);
            _status.ForeColor = Color.FromArgb(100, 106, 115);
            Controls.Add(_status);

            _log.SetBounds(24, 294, 500, 150);
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.BackColor = Color.FromArgb(245, 246, 247);
            _log.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(_log);
        }

        private static Label LabelAt(string text, int x, int y)
        {
            var l = new Label();
            l.Text = text;
            l.SetBounds(x, y, 300, 20);
            return l;
        }

        private void Append(string line)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Append), new object[] { line });
                return;
            }
            _log.AppendText((_log.Text.Length > 0 ? Environment.NewLine : "") + line);
        }

        private void OnInstall(object sender, EventArgs e)
        {
            string appId = _appId.Text.Trim();
            string appSecret = _appSecret.Text.Trim();
            if (appId.Length == 0 || appSecret.Length == 0)
            {
                MessageBox.Show(this, "appId 与 appSecret 都不能为空。", "缺少信息", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!appId.StartsWith("cli_"))
            {
                var r = MessageBox.Show(this, "appId 通常以 cli_ 开头，确认继续？", "确认", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (r != DialogResult.OK) return;
            }

            _install.Enabled = false;
            _cancel.Enabled = false;
            _appId.ReadOnly = true;
            _appSecret.ReadOnly = true;
            _log.Clear();
            _status.Text = "正在安装…";

            var worker = new Thread(delegate ()
            {
                try
                {
                    Append("检查安装包完整性");
                    _installer.ValidatePayload();
                    Append("检查运行环境");
                    _installer.EnsureDshClosed();
                    Append("DSH 已退出");
                    _installer.CopyPayload(Append);
                    _installer.RegisterBundle(Append);
                    _installer.LinkInstallDir(Append);
                    _installer.WriteConfig(appId, appSecret, Append);
                    Append("");
                    Append("安装完成。请重新打开 DSH，左侧会出现「技术文件起草」。");
                    Done(true);
                }
                catch (Exception ex)
                {
                    Append("");
                    Append("安装失败：" + ex.Message);
                    Append("正在回滚到安装前状态…");
                    _installer.Rollback(Append);
                    Done(false);
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void OnUninstall(object sender, EventArgs e)
        {
            if (MessageBox.Show(this, "将移除插件与其配置（保留知识库中的文件）。确认卸载？", "确认卸载", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK)
                return;

            _install.Enabled = false;
            _cancel.Enabled = false;
            _uninstall.Enabled = false;
            _log.Clear();
            _status.Text = "正在卸载…";

            var worker = new Thread(delegate ()
            {
                try
                {
                    _installer.EnsureDshClosed();
                    _installer.Uninstall(Append);
                    Done(true);
                }
                catch (Exception ex)
                {
                    Append("");
                    Append("卸载失败：" + ex.Message);
                    Done(false);
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void Done(bool ok)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<bool>(Done), new object[] { ok });
                return;
            }
            _status.Text = ok ? "安装完成" : "安装失败";
            _status.ForeColor = ok ? Color.FromArgb(52, 168, 83) : Color.FromArgb(245, 63, 63);
            _install.Enabled = true;
            _cancel.Enabled = true;
            _uninstall.Enabled = true;
            _cancel.Text = "关闭";
            if (ok)
            {
                MessageBox.Show(this, "安装完成。请重新打开 DSH。", "完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                MessageBox.Show(this, "安装未完成，请查看窗口中的提示。", "失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
