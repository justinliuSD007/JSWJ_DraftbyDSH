using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
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

        /** LibreOffice 官方稳定版 MSI（x86-64）。版本写死，升级时改这里即可。 */
        public const string LibreOfficeVersion = "26.8.2";
        public const string LibreOfficeMsiUrl =
            "https://download.documentfoundation.org/libreoffice/stable/" + LibreOfficeVersion +
            "/win/x86_64/LibreOffice_" + LibreOfficeVersion + "_Win_x86-64.msi";
        public const string LibreOfficeMsiName = "LibreOffice_" + LibreOfficeVersion + "_Win_x86-64.msi";

        /** 认为「已安装」的判断依据：两个安装位置的 soffice.exe 存在即可。 */
        private static readonly string[] LibreOfficeExe =
        {
            @"C:\Program Files\LibreOffice\program\soffice.exe",
            @"C:\Program Files (x86)\LibreOffice\program\soffice.exe"
        };

        public readonly string PayloadDir;
        public readonly string ProfileDir;
        public readonly string InstallDir;
        public string Version = "";

        /** 长耗时步骤（复制、下载）里检查用户是否点了取消；由界面注入。 */
        public Func<bool> CancelCheck;

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

        /** 界面上显示的安装位置：用 LocalApplicationData 拼完整路径，避免 8.3 短名。 */
        public string DisplayInstallDir
        {
            get
            {
                string overrideDir = Environment.GetEnvironmentVariable("JSWJ_INSTALL_DIR");
                if (!string.IsNullOrEmpty(overrideDir)) return ToLongPath(overrideDir);
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "JSWJ-Draft", "plugin");
            }
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int GetLongPathName(string shortPath, StringBuilder longPath, int bufferLength);

        /** 把 8.3 短名展开成长路径；路径不存在或展开失败时原样返回。 */
        private static string ToLongPath(string path)
        {
            try
            {
                var buffer = new StringBuilder(1024);
                int n = GetLongPathName(path, buffer, buffer.Capacity);
                if (n > 0 && n < buffer.Capacity) return buffer.ToString();
            }
            catch { }
            return path;
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
            log.AppendLine("libreoffice: " + (FindLibreOffice() ?? "未安装"));
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
            // LibreOffice 是独立软件，用户可能另有用途，卸载插件时不碰它。
            string soffice = FindLibreOffice();
            log(soffice != null
                ? "LibreOffice 是独立组件，保留未动：" + soffice
                : "LibreOffice 是独立组件，不在卸载范围内。");
            log("卸载完成。请重新打开 DSH。");
        }

        /** DSH 是否正在运行。自动化测试可用 JSWJ_SKIP_PROCESS_CHECK=1 跳过。 */
        public static bool IsDshRunning()
        {
            if (Environment.GetEnvironmentVariable("JSWJ_SKIP_PROCESS_CHECK") == "1") return false;
            try
            {
                foreach (var p in Process.GetProcessesByName("DeepSeek Harness"))
                {
                    p.Dispose();
                    return true;
                }
            }
            catch { }
            return false;
        }

        public void EnsureDshClosed()
        {
            if (IsDshRunning()) throw new ApplicationException("DSH 正在运行，请完全退出后重试。");
        }

        /** 检查 .NET Framework 4.8 与 64 位 Windows；返回空字符串表示满足，否则给出缺项。 */
        public static string CheckSystemEnvironment()
        {
            var missing = new List<string>();
            if (!HasNetFramework48()) missing.Add(".NET Framework 4.8");
            if (!Environment.Is64BitOperatingSystem) missing.Add("64 位 Windows");
            return missing.Count == 0 ? "" : "缺少 " + string.Join("、", missing.ToArray());
        }

        private static bool HasNetFramework48()
        {
            try
            {
                using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full"))
                {
                    if (key == null) return false;
                    object release = key.GetValue("Release");
                    if (release == null) return false;
                    return Convert.ToInt32(release) >= 528040; // 528040 = .NET Framework 4.8
                }
            }
            catch { return false; }
        }

        public void CopyPayload(Action<string> log)
        {
            CopyPayload(log, null);
        }

        /** 复制插件文件；progress 按「已复制字节 / 总字节」回报，用于进度百分比。 */
        public void CopyPayload(Action<string> log, Action<long, long> progress)
        {
            log("复制插件文件到 " + InstallDir);
            Directory.CreateDirectory(InstallDir);

            var files = new List<string>();
            CollectFiles(PayloadDir, files);
            long total = 0;
            foreach (var f in files)
            {
                try { total += new FileInfo(f).Length; } catch { }
            }

            long done = 0;
            foreach (var file in files)
            {
                CheckCancelled();
                string rel = file.Substring(PayloadDir.Length).TrimStart('\\');
                string target = Path.Combine(InstallDir, rel);
                string dir = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.Copy(file, target, true);
                try { done += new FileInfo(file).Length; } catch { }
                if (progress != null) progress(done, total);
            }
            log("已复制 " + files.Count + " 个文件，共 " + (total / 1024) + " KB");
        }

        /** 安装器自身与本地凭据不进插件目录，其余文件（含子目录）全部复制。 */
        private static bool IsExcludedFromPayload(string path)
        {
            string name = Path.GetFileName(path);
            if (name.Equals("Setup.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("Setup-bundled.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("Setup.Creds.cs", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("creds.local.json", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static void CollectFiles(string from, List<string> files)
        {
            foreach (var file in Directory.GetFiles(from))
            {
                if (!IsExcludedFromPayload(file)) files.Add(file);
            }
            foreach (var dir in Directory.GetDirectories(from))
            {
                CollectFiles(dir, files);
            }
        }

        private static void CopyTree(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var file in Directory.GetFiles(from))
            {
                if (IsExcludedFromPayload(file)) continue;
                File.Copy(file, Path.Combine(to, Path.GetFileName(file)), true);
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
            log("已登记插件清单：" + DepName);
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

        // ---------- LibreOffice 可选组件 ----------

        /** 返回已安装的 soffice.exe 路径；未安装返回 null。 */
        public static string FindLibreOffice()
        {
            foreach (var path in LibreOfficeExe)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        private void CheckCancelled()
        {
            if (CancelCheck != null && CancelCheck()) throw new OperationCanceledException();
        }

        /** 下载官方 MSI 并静默安装。任意环节失败都抛异常，由界面标红后继续后续步骤。 */
        public void InstallLibreOffice(Action<string> log, Action<long, long> progress)
        {
            log("开始安装 LibreOffice（约 400 MB，需要联网）");
            string dir = Path.Combine(Path.GetTempPath(), "jswj-setup-libreoffice");
            Directory.CreateDirectory(dir);
            string msi = Path.Combine(dir, LibreOfficeMsiName);
            try
            {
                log("下载 " + LibreOfficeMsiUrl);
                DownloadFile(LibreOfficeMsiUrl, msi, progress);
                var info = new FileInfo(msi);
                log("下载完成：" + (info.Length / 1024 / 1024) + " MB");
                if (info.Length < 1024 * 1024)
                    throw new ApplicationException("下载文件不完整（" + info.Length + " 字节），可能网络中断");

                log("静默安装：" + msi);
                int code = RunMsiexec(msi);
                if (code == 1603)
                    throw new ApplicationException("msiexec 返回 1603（安装失败，常见原因是缺少管理员权限）");
                if (code == 1625 || code == 1619)
                    throw new ApplicationException("msiexec 返回 " + code + "（被系统策略拦截或安装包不可读）");
                if (code != 0 && code != 3010)
                    throw new ApplicationException("msiexec 返回错误码 " + code);

                string found = FindLibreOffice();
                if (found == null)
                    throw new ApplicationException("安装程序已返回成功，但仍未找到 soffice.exe；可能未完成授权");
                log("已安装 LibreOffice：" + found);
            }
            finally
            {
                try { if (File.Exists(msi)) File.Delete(msi); } catch { }
                try
                {
                    if (Directory.Exists(dir) && Directory.GetFiles(dir).Length == 0 && Directory.GetDirectories(dir).Length == 0)
                        Directory.Delete(dir);
                }
                catch { }
            }
        }

        /** 流式下载，按「已接收字节 / 总长度」回报进度。 */
        private void DownloadFile(string url, string dest, Action<long, long> progress)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "JSWJ-Setup/1.0 (Windows)";
            request.Timeout = 60000;
            request.ReadWriteTimeout = 60000;
            request.AllowAutoRedirect = true;

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var input = response.GetResponseStream())
            using (var output = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                long total = response.ContentLength;
                long received = 0;
                var buffer = new byte[81920];
                int n;
                while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    CheckCancelled();
                    output.Write(buffer, 0, n);
                    received += n;
                    if (progress != null) progress(received, total);
                }
                if (progress != null) progress(received, total);
            }
        }

        private static int RunMsiexec(string msi)
        {
            var psi = new ProcessStartInfo("msiexec.exe", "/i \"" + msi + "\" /qn /norestart");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            var proc = Process.Start(psi);
            proc.WaitForExit();
            return proc.ExitCode;
        }
    }

    internal sealed class InstallForm : Form
    {
        private static readonly string[] StepTitles = new string[]
        {
            "检查安装包",
            "复制插件文件",
            "登记插件清单",
            "建立目录联接",
            "写入配置",
            "安装 LibreOffice 组件"
        };

        private const int StepCheck = 0;
        private const int StepCopy = 1;
        private const int StepBundle = 2;
        private const int StepLink = 3;
        private const int StepConfig = 4;
        private const int StepLibre = 5;

        // 步骤状态记在数组里，供工作线程判断；界面文字另行更新。
        private const int StatePending = 0;
        private const int StateRunning = 1;
        private const int StateDone = 2;
        private const int StateSkipped = 3;
        private const int StateFailed = 4;

        private static readonly Color PendingColor = Color.FromArgb(150, 155, 165);
        private static readonly Color SkipColor = Color.FromArgb(184, 189, 196);
        private static readonly Color RunningColor = Color.FromArgb(51, 112, 255);
        private static readonly Color DoneColor = Color.FromArgb(52, 168, 83);
        private static readonly Color FailedColor = Color.FromArgb(245, 63, 63);
        private static readonly Color HintColor = Color.FromArgb(100, 106, 115);
        private static readonly Color DescColor = Color.FromArgb(140, 146, 155);
        private static readonly Color SoftColor = Color.FromArgb(178, 184, 192);
        private static readonly Color BodyColor = Color.FromArgb(60, 66, 75);

#if !BUNDLED
        private readonly TextBox _appId = new TextBox();
        private readonly TextBox _appSecret = new TextBox();
#endif
        private readonly CheckBox _compPlugin = new CheckBox();
        private readonly CheckBox _compLibre = new CheckBox();
        private readonly Button _install = new Button();
        private readonly Button _uninstall = new Button();
        private readonly Button _cancel = new Button();
        private readonly TextBox _log = new TextBox();
        private readonly Label _logHint = new Label();
        private readonly Label _status = new Label();
        private readonly Label[] _stepNames = new Label[StepTitles.Length];
        private readonly Label[] _stepStatus = new Label[StepTitles.Length];
        private readonly int[] _stepState = new int[StepTitles.Length];
        private readonly ToolTip _toolTip = new ToolTip();
        private readonly Installer _installer = new Installer();

        /** 两屏共用 */
        private const string SubtitleText = "适用于 DeepSeek Harness 桌面端 · v0.7.0-beta.8";

        // 两屏：安装前确认页 + 安装页，同一窗口内切换。
        private readonly Panel _installPage = new Panel();
        private readonly Panel _precheckPage = new Panel();
        private readonly Label[] _checkIcon = new Label[3];
        private readonly Label[] _checkName = new Label[3];
        private readonly Label[] _checkResult = new Label[3];
        private readonly Label[] _checkHint = new Label[3];
        private readonly bool[] _checkOk = new bool[3];
        private readonly CheckBox _confirmBox = new CheckBox();
        private readonly Button _recheck = new Button();
        private readonly Button _next = new Button();
        private readonly Button _preCancel = new Button();

        private volatile bool _cancelled;
        private volatile bool _closed;
        private bool _running;
        private int _copyPct = -1;
        private int _librePct = -1;

        public InstallForm()
        {
            Text = "技术文件起草 · 安装程序";
            ClientSize = new Size(620, 640);
            MinimumSize = new Size(640, 560);
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9f);
            FormClosing += OnFormClosing;

            // 先搭安装页（尺寸按 620×640 定），再把确认页盖在上面，最后由 ShowInstallPage 切回来。
            _installPage.SetBounds(0, 0, 620, 640);
            _installPage.Visible = false;
            Controls.Add(_installPage);

            _precheckPage.SetBounds(0, 0, 620, 350);
            Controls.Add(_precheckPage);

            int y = 16;

            var title = new Label();
            title.Text = "技术文件起草 · 安装程序";
            title.Font = new Font("Microsoft YaHei UI", 14f, FontStyle.Bold);
            title.SetBounds(24, y, 572, 26);
            title.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(title);
            y += 28;

            var subtitle = new Label();
            subtitle.Text = SubtitleText;
            subtitle.ForeColor = HintColor;
            subtitle.SetBounds(24, y, 572, 17);
            subtitle.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(subtitle);
            y += 20;

            var note = new Label();
#if BUNDLED
            // 内置凭据版本：不显示输入框，安装即完成。
            note.Text = "内置凭据已配置，直接点「开始安装」即可。";
#else
            note.Text = "安装需要飞书应用的 appId 与 appSecret（仅保存在本机）。";
#endif
            note.ForeColor = HintColor;
            note.SetBounds(24, y, 572, 30);
            note.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(note);
            y += 32;

#if !BUNDLED
            var appIdLabel = LabelAt("feishu appId");
            appIdLabel.SetBounds(24, y, 296, 17);
            _installPage.Controls.Add(appIdLabel);

            _appId.SetBounds(24, y + 18, 296, 24);
            _appId.Text = "cli_";
            _installPage.Controls.Add(_appId);

            var secretLabel = LabelAt("appSecret");
            secretLabel.SetBounds(332, y, 264, 17);
            _installPage.Controls.Add(secretLabel);

            _appSecret.SetBounds(332, y + 18, 264, 24);
            _appSecret.UseSystemPasswordChar = true;
            _installPage.Controls.Add(_appSecret);
            y += 48;
#endif

            var compHeader = new Label();
            compHeader.Text = "本安装程序将安装以下组件：";
            compHeader.ForeColor = HintColor;
            compHeader.SetBounds(24, y, 572, 18);
            compHeader.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(compHeader);
            y += 18;

            _compPlugin.Text = "插件本体";
            _compPlugin.Checked = true;
            _compPlugin.AutoCheck = false; // 固定勾选：点不动，但勾选标记保持正常可见
            _compPlugin.TabStop = false;
            _compPlugin.ForeColor = Color.FromArgb(120, 126, 135); // 灰字表示固定项
            _compPlugin.SetBounds(24, y, 300, 22);
            _toolTip.SetToolTip(_compPlugin, "固定包含，不可取消");
            _installPage.Controls.Add(_compPlugin);
            AddComponentMeta(y, "1 MB", "", "工具、技能、模板与页面渲染组件");
            y += 44;

            _compLibre.Text = "LibreOffice 文档转换组件";
            _compLibre.Checked = false; // 默认不勾选：体积大、要联网、需要管理员权限
            _compLibre.SetBounds(24, y, 300, 22);
            _installPage.Controls.Add(_compLibre);
            AddComponentMeta(y, "约 400 MB", "· 可选", "把 Word 转成分页图片，供原文精确定位；需联网下载，约 3–5 分钟");
            y += 44;

            string fullPath = _installer.DisplayInstallDir;
            var pathLabel = new Label();
            pathLabel.Font = new Font("Microsoft YaHei UI", 8.5f);
            pathLabel.ForeColor = DescColor;
            pathLabel.AutoEllipsis = true;
            pathLabel.SetBounds(24, y, 572, 17);
            pathLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            int prefixWidth = TextRenderer.MeasureText("安装到：", pathLabel.Font).Width;
            pathLabel.Text = "安装到：" + ElideMiddle(fullPath, pathLabel.Font, 572 - prefixWidth - 8);
            _toolTip.SetToolTip(pathLabel, fullPath);
            _installPage.Controls.Add(pathLabel);
            y += 18;

            _install.Text = "开始安装";
            _install.SetBounds(24, y, 150, 34);
            _install.BackColor = RunningColor;
            _install.ForeColor = Color.White;
            _install.FlatStyle = FlatStyle.Flat;
            _install.Click += OnInstall;
            _installPage.Controls.Add(_install);

            _cancel.Text = "取消";
            _cancel.SetBounds(186, y, 96, 34);
            _cancel.Click += OnCancel;
            _installPage.Controls.Add(_cancel);

            // 卸载是破坏性操作：右下角、次要样式，与主操作拉开距离。
            _uninstall.Text = "卸载";
            _uninstall.SetBounds(504, y, 92, 34);
            _uninstall.BackColor = Color.White;
            _uninstall.ForeColor = Color.FromArgb(95, 100, 110);
            _uninstall.FlatStyle = FlatStyle.Flat;
            _uninstall.FlatAppearance.BorderSize = 1;
            _uninstall.FlatAppearance.BorderColor = Color.FromArgb(200, 205, 213);
            _uninstall.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _uninstall.Click += OnUninstall;
            _installPage.Controls.Add(_uninstall);
            y += 38;

            int stepTop = y + 6;
            for (int i = 0; i < StepTitles.Length; i++)
            {
                var name = new Label();
                name.Text = StepTitles[i];
                name.ForeColor = BodyColor;
                name.AutoEllipsis = true;
                name.SetBounds(24, stepTop + i * 19, 400, 19);
                name.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
                _installPage.Controls.Add(name);
                _stepNames[i] = name;

                var state = new Label();
                state.Text = "待执行";
                state.ForeColor = PendingColor;
                state.TextAlign = ContentAlignment.MiddleRight;
                state.AutoEllipsis = true;
                state.SetBounds(444, stepTop + i * 19, 152, 19);
                state.Anchor = AnchorStyles.Top | AnchorStyles.Right;
                _installPage.Controls.Add(state);
                _stepStatus[i] = state;
                _stepState[i] = StatePending;
            }

            int sepTop = stepTop + StepTitles.Length * 19 + 6;
            var sep = new Panel();
            sep.BackColor = Color.FromArgb(214, 218, 224);
            sep.SetBounds(24, sepTop, 572, 1);
            sep.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(sep);

            _status.SetBounds(24, sepTop + 8, 572, 18);
            _status.ForeColor = HintColor;
            _status.AutoEllipsis = true;
            _status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(_status);

            int logTop = sepTop + 8 + 18 + 6;
            int logHeight = Math.Max(40, ClientSize.Height - logTop - 16);
            _log.SetBounds(24, logTop, 572, logHeight);
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.BackColor = Color.FromArgb(245, 246, 247);
            _log.BorderStyle = BorderStyle.FixedSingle;
            _log.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(_log);

            // 日志为空时显示占位说明，写入第一行后隐藏。
            _logHint.Text = "安装日志将显示在这里";
            _logHint.ForeColor = SoftColor;
            _logHint.AutoSize = false;
            _logHint.SetBounds(_log.Left + 8, _log.Top + 6, 300, 18);
            _logHint.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            _installPage.Controls.Add(_logHint);
            _logHint.BringToFront();

            BuildPrecheckPage();
            Resize += OnPageResize;
            _installPage.Visible = false;
            _precheckPage.Visible = true;
            MinimumSize = new Size(640, 390);
            ClientSize = new Size(620, 350);
            RefreshChecks();
        }

        /** 安装前确认页：三项检查 + 确认勾选 + 三个按钮。 */
        private void BuildPrecheckPage()
        {
            int y = 16;

            var title = new Label();
            title.Text = "技术文件起草 · 安装程序";
            title.Font = new Font("Microsoft YaHei UI", 14f, FontStyle.Bold);
            title.SetBounds(24, y, 572, 26);
            _precheckPage.Controls.Add(title);
            y += 28;

            var subtitle = new Label();
            subtitle.Text = SubtitleText;
            subtitle.ForeColor = HintColor;
            subtitle.SetBounds(24, y, 572, 17);
            _precheckPage.Controls.Add(subtitle);
            y += 26;

            var intro = new Label();
            intro.Text = "安装前请确认以下事项。全部满足后点「下一步」继续。";
            intro.ForeColor = BodyColor;
            intro.SetBounds(24, y, 572, 20);
            _precheckPage.Controls.Add(intro);
            y += 34;

            string[] names = { "已安装 DSH 并至少启动过一次", "DSH 当前未运行", "系统环境" };
            for (int i = 0; i < names.Length; i++)
            {
                int rowTop = y + i * 46;

                var icon = new Label();
                icon.Text = "●";
                icon.ForeColor = PendingColor;
                icon.SetBounds(24, rowTop + 2, 18, 18);
                _precheckPage.Controls.Add(icon);
                _checkIcon[i] = icon;

                var name = new Label();
                name.Text = names[i];
                name.ForeColor = BodyColor;
                name.AutoEllipsis = true;
                name.SetBounds(48, rowTop, 350, 20);
                _precheckPage.Controls.Add(name);
                _checkName[i] = name;

                var result = new Label();
                result.Text = "";
                result.TextAlign = ContentAlignment.MiddleRight;
                result.AutoEllipsis = true;
                result.SetBounds(404, rowTop, 192, 20);
                _precheckPage.Controls.Add(result);
                _checkResult[i] = result;

                var hint = new Label();
                hint.Text = "";
                hint.Font = new Font("Microsoft YaHei UI", 8.25f);
                hint.ForeColor = DescColor;
                hint.AutoEllipsis = true;
                hint.SetBounds(48, rowTop + 21, 548, 16);
                _precheckPage.Controls.Add(hint);
                _checkHint[i] = hint;
            }
            y += names.Length * 46;

            _confirmBox.Text = "我已确认以上事项，并已退出 DSH";
            _confirmBox.SetBounds(24, y, 572, 24);
            _confirmBox.CheckedChanged += delegate { UpdateNextEnabled(); };
            _precheckPage.Controls.Add(_confirmBox);
            y += 40;

            _recheck.Text = "重新检测";
            _recheck.SetBounds(24, y, 96, 32);
            _recheck.BackColor = Color.White;
            _recheck.ForeColor = Color.FromArgb(95, 100, 110);
            _recheck.FlatStyle = FlatStyle.Flat;
            _recheck.FlatAppearance.BorderSize = 1;
            _recheck.FlatAppearance.BorderColor = Color.FromArgb(200, 205, 213);
            _recheck.Click += OnRecheck;
            _precheckPage.Controls.Add(_recheck);

            _next.Text = "下一步";
            _next.SetBounds(132, y, 150, 32);
            _next.BackColor = RunningColor;
            _next.ForeColor = Color.White;
            _next.FlatStyle = FlatStyle.Flat;
            _next.Click += OnNext;
            _precheckPage.Controls.Add(_next);

            _preCancel.Text = "取消";
            _preCancel.SetBounds(294, y, 96, 32);
            _preCancel.Click += delegate { Close(); };
            _precheckPage.Controls.Add(_preCancel);
        }

        /** 窗口大小变化时，让当前可见的那一页跟着铺满。 */
        private void OnPageResize(object sender, EventArgs e)
        {
            if (_installPage.Visible) _installPage.SetBounds(0, 0, ClientSize.Width, ClientSize.Height);
            else if (_precheckPage.Visible) _precheckPage.SetBounds(0, 0, ClientSize.Width, ClientSize.Height);
        }

        /** 重新跑三项检查，刷新结论与「下一步」可用状态。 */
        private void RefreshChecks()
        {
            bool profileOk = Directory.Exists(_installer.ProfileDir);
            SetCheck(0, profileOk, "✓ 已就绪", "✗ 未找到配置目录",
                profileOk ? "" : "请先启动一次 DSH，任意建一个会话，再退出重试");

            bool dshClosed = !Installer.IsDshRunning();
            SetCheck(1, dshClosed, "✓ 已退出", "✗ 正在运行",
                dshClosed ? "" : "请从托盘完全退出 DSH");

            bool envOk = Installer.CheckSystemEnvironment().Length == 0;
            SetCheck(2, envOk, "✓ 满足要求", "✗ 不满足",
                envOk ? "" : "需要 .NET Framework 4.8 与 64 位 Windows");

            UpdateNextEnabled();
        }

        private void SetCheck(int index, bool ok, string passText, string failText, string hint)
        {
            _checkOk[index] = ok;
            _checkIcon[index].ForeColor = ok ? DoneColor : FailedColor;
            _checkResult[index].Text = ok ? passText : failText;
            _checkResult[index].ForeColor = ok ? DoneColor : FailedColor;
            _checkHint[index].Text = hint;
        }

        /** 前两项检查通过、且勾选确认后，才允许进入安装页。 */
        private void UpdateNextEnabled()
        {
            bool ready = _checkOk[0] && _checkOk[1] && _confirmBox.Checked;
            _next.Enabled = ready;
            // FlatStyle.Flat 的自定义底色不会随禁用变灰，这里手动调浅并换灰字。
            _next.BackColor = ready ? RunningColor : Color.FromArgb(226, 231, 240);
            _next.ForeColor = ready ? Color.White : Color.FromArgb(126, 134, 148);
        }

        private void OnRecheck(object sender, EventArgs e)
        {
            RefreshChecks();
        }

        private void OnNext(object sender, EventArgs e)
        {
            // 再校验一遍，防止用户确认后又启动 DSH。
            RefreshChecks();
            if (!_checkOk[0] || !_checkOk[1])
            {
                MessageBox.Show(this, "仍有检查项未通过，请处理后点「重新检测」。", "无法继续",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!_confirmBox.Checked)
            {
                MessageBox.Show(this, "请先勾选「我已确认以上事项，并已退出 DSH」。", "请确认",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            ShowInstallPage();
        }

        private void ShowInstallPage()
        {
            _precheckPage.Visible = false;
            _installPage.SetBounds(0, 0, 620, 640);
            _installPage.Visible = true;
            MinimumSize = new Size(640, 560);
            ClientSize = new Size(620, 640);
            _install.Focus();
        }

        private static Label LabelAt(string text)
        {
            var l = new Label();
            l.Text = text;
            return l;
        }

        /** 组件行第二行：右侧体积（右对齐）+ 可选标记 + 下一行小字说明。 */
        private void AddComponentMeta(int y, string sizeText, string optionalText, string descText)
        {
            var font = new Font("Microsoft YaHei UI", 8.5f);
            const int right = 596;
            int optionalWidth = 0;

            if (!string.IsNullOrEmpty(optionalText))
            {
                optionalWidth = TextRenderer.MeasureText(optionalText, font).Width;
                var optional = new Label();
                optional.Text = optionalText;
                optional.Font = font;
                optional.ForeColor = SoftColor;
                optional.TextAlign = ContentAlignment.MiddleLeft;
                optional.SetBounds(right - optionalWidth, y + 2, optionalWidth, 18);
                optional.Anchor = AnchorStyles.Top | AnchorStyles.Right;
                _installPage.Controls.Add(optional);
            }

            int sizeWidth = TextRenderer.MeasureText(sizeText, font).Width;
            var size = new Label();
            size.Text = sizeText;
            size.Font = font;
            size.ForeColor = DescColor;
            size.TextAlign = ContentAlignment.MiddleRight;
            size.SetBounds(right - optionalWidth - sizeWidth, y + 2, sizeWidth, 18);
            size.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _installPage.Controls.Add(size);

            var desc = new Label();
            desc.Text = descText;
            desc.Font = new Font("Microsoft YaHei UI", 8.25f);
            desc.ForeColor = DescColor;
            desc.AutoEllipsis = true;
            desc.SetBounds(44, y + 24, 552, 17);
            desc.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _installPage.Controls.Add(desc);
        }

        /** 路径过长时省略中间，保留开头与结尾。 */
        private static string ElideMiddle(string text, Font font, int maxWidth)
        {
            if (text == null) return "";
            if (TextRenderer.MeasureText(text, font).Width <= maxWidth) return text;

            int keepHead = 18;
            int keepTail = 18;
            if (keepHead + keepTail + 1 > text.Length) return text;
            string candidate = text.Substring(0, keepHead) + "…" + text.Substring(text.Length - keepTail);
            while (TextRenderer.MeasureText(candidate, font).Width > maxWidth && keepHead + keepTail > 12)
            {
                if (keepHead > keepTail) keepHead--; else keepTail--;
                candidate = text.Substring(0, keepHead) + "…" + text.Substring(text.Length - keepTail);
            }
            return candidate;
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_running && !_cancelled)
            {
                if (MessageBox.Show(this, "安装正在进行，退出将中断安装。确定退出？", "确认退出",
                    MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
                {
                    e.Cancel = true;
                    return;
                }
                _cancelled = true;
            }
            _closed = true;
        }

        /** 跨线程更新界面；窗口已关闭时静默丢弃。 */
        private void Ui(Action action)
        {
            if (_closed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(action);
                    return;
                }
                action();
            }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
        }

        private void SetStepStatus(int index, string text, Color color)
        {
            Ui(delegate
            {
                _stepStatus[index].Text = text;
                _stepStatus[index].ForeColor = color;
            });
        }

        /** 安装/卸载进行中：主操作与卸载都禁用，只留取消。 */
        private void SetBusy(bool busy)
        {
            _install.Enabled = !busy;
            _uninstall.Enabled = !busy;
            // FlatStyle.Flat 的自定义底色不会随禁用变灰，这里手动调浅，避免看起来还能点。
            _install.BackColor = busy ? Color.FromArgb(176, 197, 240) : RunningColor;
        }

        private void StepRunning(int index)
        {
            _stepState[index] = StateRunning;
            SetStepStatus(index, "执行中", RunningColor);
        }

        private void StepRunningPct(int index, int percent)
        {
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            _stepState[index] = StateRunning;
            SetStepStatus(index, "执行中 " + percent + "%", RunningColor);
        }

        private void StepDone(int index)
        {
            _stepState[index] = StateDone;
            SetStepStatus(index, "完成", DoneColor);
        }

        private void StepSkipped(int index, string reason)
        {
            _stepState[index] = StateSkipped;
            SetStepStatus(index, "跳过", SkipColor);
        }

        private void StepFailed(int index, string reason)
        {
            _stepState[index] = StateFailed;
            SetStepStatus(index, "失败：" + reason, FailedColor);
        }

        private void Append(string line)
        {
            Ui(delegate
            {
                _log.AppendText((_log.Text.Length > 0 ? Environment.NewLine : "") + line);
                _logHint.Visible = _log.Text.Length == 0;
            });
        }

        private void ClearLog()
        {
            Ui(delegate
            {
                _log.Clear();
                _logHint.Visible = true;
            });
        }

        private void ReportProgress(int index, long done, long total, ref int last)
        {
            int pct = total > 0 ? (int)(done * 100 / total) : -1;
            if (pct == last) return;
            last = pct;
            if (pct < 0) return;
            StepRunningPct(index, pct);
        }

        private void OnCancel(object sender, EventArgs e)
        {
            if (_running)
            {
                _cancelled = true;
                _cancel.Enabled = false;
                _status.Text = "正在取消…";
                _status.ForeColor = PendingColor;
                Append("已请求取消，当前步骤结束后停止。");
                return;
            }
            Close();
        }

        private void OnInstall(object sender, EventArgs e)
        {
            string appId;
            string appSecret;
#if BUNDLED
            appId = BundledCreds.AppId;
            appSecret = BundledCreds.AppSecret;
#else
            appId = _appId.Text.Trim();
            appSecret = _appSecret.Text.Trim();
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
#endif
            bool withLibreOffice = _compLibre.Checked;

            _running = true;
            _cancelled = false;
            _copyPct = -1;
            _librePct = -1;
            SetBusy(true);
            _cancel.Enabled = true;
            _cancel.Text = "取消";
            _compLibre.Enabled = false;
            ClearLog();
            _status.Text = "正在安装…";
            _status.ForeColor = HintColor;
            for (int i = 0; i < StepTitles.Length; i++)
            {
                _stepState[i] = StatePending;
                SetStepStatus(i, "待执行", PendingColor);
            }

            // 复制与下载都走这里检查取消，避免安装中途无法退出。
            _installer.CancelCheck = delegate { return _cancelled; };

            var worker = new Thread(delegate()
            {
                var failed = new List<string>();
                bool cancelled = false;
                bool touchedPlugin = false;

                try
                {
                    bool payloadOk = RunStep(StepCheck, delegate
                    {
                        _installer.ValidatePayload();
                        _installer.EnsureDshClosed();
                        Append("安装包检查通过，DSH 未在运行");
                    }, failed);

                    if (!payloadOk)
                    {
                        // 安装包或环境不满足，后续步骤没有意义，统一标为跳过。
                        for (int i = 1; i < StepTitles.Length; i++) StepSkipped(i, "前置检查未通过");
                        Append("前置检查未通过，未做任何改动。");
                    }
                    else
                    {
                        touchedPlugin = true;
                        RunStep(StepCopy, delegate
                        {
                            _installer.CopyPayload(Append, delegate(long done, long total)
                            {
                                ReportProgress(StepCopy, done, total, ref _copyPct);
                            });
                        }, failed);

                        RunStep(StepBundle, delegate { _installer.RegisterBundle(Append); }, failed);
                        RunStep(StepLink, delegate { _installer.LinkInstallDir(Append); }, failed);
                        RunStep(StepConfig, delegate { _installer.WriteConfig(appId, appSecret, Append); }, failed);

                        if (!withLibreOffice)
                        {
                            StepSkipped(StepLibre, "未勾选");
                            Append("未勾选 LibreOffice，跳过下载与安装。");
                        }
                        else
                        {
                            string existing = Installer.FindLibreOffice();
                            if (existing != null)
                            {
                                _stepState[StepLibre] = StateDone;
                                SetStepStatus(StepLibre, "已安装", DoneColor);
                                Append("已检测到 LibreOffice：" + existing + "，跳过下载。");
                            }
                            else
                            {
                                RunStep(StepLibre, delegate
                                {
                                    _installer.InstallLibreOffice(Append, delegate(long done, long total)
                                    {
                                        ReportProgress(StepLibre, done, total, ref _librePct);
                                    });
                                }, failed);
                            }
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    cancelled = true;
                    Append("安装已取消。");
                    for (int i = 0; i < StepTitles.Length; i++)
                    {
                        if (_stepState[i] == StatePending) StepSkipped(i, "已取消");
                    }
                }
                catch (Exception ex)
                {
                    failed.Add("安装");
                    Append("安装异常终止：" + ex.Message);
                }

                bool pluginFailed = false;
                foreach (var name in failed)
                {
                    if (name != StepTitles[StepLibre]) pluginFailed = true;
                }
                if (touchedPlugin && (pluginFailed || cancelled))
                {
                    Append("");
                    Append("回滚对 profile 配置的改动…");
                    _installer.Rollback(Append);
                }

                Finish(failed, cancelled);
            });
            worker.IsBackground = true;
            worker.Start();
        }

        /** 执行一个步骤：失败只记录，不中断后续步骤。 */
        private bool RunStep(int index, Action work, List<string> failed)
        {
            if (_cancelled)
            {
                StepSkipped(index, "已取消");
                return false;
            }
            StepRunning(index);
            try
            {
                work();
                StepDone(index);
                return true;
            }
            catch (OperationCanceledException)
            {
                StepSkipped(index, "已取消");
                throw;
            }
            catch (Exception ex)
            {
                StepFailed(index, ex.Message);
                Append("[" + StepTitles[index] + "] 失败：" + ex.Message);
                failed.Add(StepTitles[index]);
                return false;
            }
        }

        private void Finish(List<string> failed, bool cancelled)
        {
            Ui(delegate
            {
                _running = false;
                _installer.CancelCheck = null;
                SetBusy(false);
                _cancel.Enabled = true;
                _cancel.Text = "关闭";
                _compLibre.Enabled = true;

                if (cancelled)
                {
                    _status.Text = "已取消，未完成的部分需要重新安装。";
                    _status.ForeColor = PendingColor;
                    MessageBox.Show(this, "安装已取消。请查看日志中已完成的步骤。", "已取消",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                else if (failed.Count == 1 && failed[0] == StepTitles[StepCheck])
                {
                    _status.Text = "安装包检查未通过，未做任何改动。";
                    _status.ForeColor = FailedColor;
                    MessageBox.Show(this, "安装包检查未通过，请确认安装程序与插件文件在同一目录。", "未完成",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                else if (failed.Count > 0)
                {
                    _status.Text = "以下组件未完成：" + string.Join("、", failed.ToArray());
                    _status.ForeColor = FailedColor;
                    MessageBox.Show(this, "安装未完成。未完成的组件与原因见列表中红色行。", "未完成",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                else
                {
                    _status.Text = "安装完成，请重新打开 DSH。";
                    _status.ForeColor = DoneColor;
                    MessageBox.Show(this, "安装完成。请重新打开 DSH。", "完成",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            });
        }

        /** 卸载前确认：默认焦点在「取消」，避免误按。 */
        private bool ConfirmUninstall()
        {
            using (var dlg = new Form())
            {
                dlg.Text = "确认卸载";
                dlg.Font = Font;
                dlg.FormBorderStyle = FormBorderStyle.FixedDialog;
                dlg.StartPosition = FormStartPosition.CenterParent;
                dlg.MaximizeBox = false;
                dlg.MinimizeBox = false;
                dlg.ShowInTaskbar = false;
                dlg.ClientSize = new Size(400, 150);

                var text = new Label();
                text.Text = "将移除插件文件、目录联接与配置。知识库中的文档不受影响。确定卸载吗？";
                text.SetBounds(20, 20, 360, 56);
                dlg.Controls.Add(text);

                var ok = new Button();
                ok.Text = "卸载";
                ok.SetBounds(180, 96, 90, 32);
                ok.DialogResult = DialogResult.OK;
                dlg.Controls.Add(ok);

                var no = new Button();
                no.Text = "取消";
                no.SetBounds(282, 96, 90, 32);
                no.DialogResult = DialogResult.Cancel;
                dlg.Controls.Add(no);

                dlg.AcceptButton = null;
                dlg.CancelButton = no;
                dlg.Shown += delegate { no.Focus(); };
                return dlg.ShowDialog(this) == DialogResult.OK;
            }
        }

        private void OnUninstall(object sender, EventArgs e)
        {
            if (!ConfirmUninstall()) return;

            _running = true;
            _cancelled = false;
            SetBusy(true);
            _cancel.Enabled = false;
            ClearLog();
            _status.Text = "正在卸载…";
            _status.ForeColor = HintColor;

            var worker = new Thread(delegate()
            {
                try
                {
                    _installer.EnsureDshClosed();
                    _installer.Uninstall(Append);
                    Ui(delegate
                    {
                        _running = false;
                        _status.Text = "卸载完成，请重新打开 DSH。";
                        _status.ForeColor = DoneColor;
                        SetBusy(false);
                        _cancel.Enabled = true;
                        _cancel.Text = "关闭";
                    });
                }
                catch (Exception ex)
                {
                    Append("");
                    Append("卸载失败：" + ex.Message);
                    Ui(delegate
                    {
                        _running = false;
                        _status.Text = "卸载失败：" + ex.Message;
                        _status.ForeColor = FailedColor;
                        SetBusy(false);
                        _cancel.Enabled = true;
                        _cancel.Text = "关闭";
                    });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }
}
