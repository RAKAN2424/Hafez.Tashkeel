using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HafizSetup
{
    public class InstallerForm : Form
    {
        private TextBox txtInstallDir;
        private Button btnBrowse;
        private CheckBox chkInstallPrereqs;
        private CheckBox chkInstallPythonAi;
        private CheckBox chkDesktopShortcut;
        private CheckBox chkOpenModelsFolder;
        private Button btnInstall;
        private Button btnLaunch;
        private ProgressBar progressBar;
        private RichTextBox logBox;
        private Label lblStatus;
        private volatile bool isInstalling = false;

        public InstallerForm()
        {
            Text = "Hafiz Bel'Amya Studio - Windows Setup Installer";
            Size = new Size(720, 560);
            MinimumSize = new Size(680, 520);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(14, 18, 28);
            ForeColor = Color.FromArgb(241, 245, 249);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            BuildUi();
        }

        private void BuildUi()
        {
            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 84;
            header.BackColor = Color.FromArgb(20, 27, 45);
            header.Padding = new Padding(20, 14, 20, 10);

            Label title = new Label();
            title.Text = "Hafiz Bel'Amya Setup (حافظ بالعامية - برنامج التثبيت)";
            title.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.Dock = DockStyle.Top;
            title.Height = 32;

            Label subtitle = new Label();
            subtitle.Text = "Installs the app, downloads missing runtimes from Internet, creates the 'models' folder, and creates Desktop shortcuts.";
            subtitle.ForeColor = Color.FromArgb(148, 163, 184);
            subtitle.Dock = DockStyle.Bottom;
            subtitle.Height = 24;

            header.Controls.Add(subtitle);
            header.Controls.Add(title);

            Panel body = new Panel();
            body.Dock = DockStyle.Fill;
            body.Padding = new Padding(20, 14, 20, 16);

            Label lblDir = new Label();
            lblDir.Text = "Install Directory (سيتم إنشاء مجلد models داخله مباشرة):";
            lblDir.Location = new Point(20, 14);
            lblDir.Size = new Size(660, 22);
            lblDir.ForeColor = Color.FromArgb(203, 213, 225);

            txtInstallDir = new TextBox();
            txtInstallDir.Location = new Point(20, 40);
            txtInstallDir.Size = new Size(555, 28);
            txtInstallDir.BackColor = Color.FromArgb(30, 41, 59);
            txtInstallDir.ForeColor = Color.White;
            txtInstallDir.BorderStyle = BorderStyle.FixedSingle;
            txtInstallDir.Text = @"C:\HafizBelAmya";

            btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(585, 39);
            btnBrowse.Size = new Size(95, 28);
            btnBrowse.BackColor = Color.FromArgb(51, 65, 85);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.Click += new EventHandler(OnBrowseClick);

            chkInstallPrereqs = new CheckBox();
            chkInstallPrereqs.Text = "Auto-download missing Node.js 20, Python 3.11 & FFmpeg from Internet";
            chkInstallPrereqs.Location = new Point(20, 80);
            chkInstallPrereqs.Size = new Size(660, 24);
            chkInstallPrereqs.Checked = true;

            chkInstallPythonAi = new CheckBox();
            chkInstallPythonAi.Text = "Install Python AI Backends (.venv + PyTorch CUDA/CPU, llama-cpp, Whisper, OmniVoice)";
            chkInstallPythonAi.Location = new Point(20, 108);
            chkInstallPythonAi.Size = new Size(660, 24);
            chkInstallPythonAi.Checked = true;

            chkDesktopShortcut = new CheckBox();
            chkDesktopShortcut.Text = "Create Desktop shortcuts (Hafiz Bel'Amya + Models Folder)";
            chkDesktopShortcut.Location = new Point(20, 136);
            chkDesktopShortcut.Size = new Size(660, 24);
            chkDesktopShortcut.Checked = true;

            chkOpenModelsFolder = new CheckBox();
            chkOpenModelsFolder.Text = "Open 'models' folder when finished so you can move your model folders inside";
            chkOpenModelsFolder.Location = new Point(20, 164);
            chkOpenModelsFolder.Size = new Size(660, 24);
            chkOpenModelsFolder.Checked = true;

            lblStatus = new Label();
            lblStatus.Text = "Ready to install.";
            lblStatus.Location = new Point(20, 198);
            lblStatus.Size = new Size(660, 22);
            lblStatus.ForeColor = Color.FromArgb(125, 211, 252);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(20, 224);
            progressBar.Size = new Size(660, 18);
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;

            logBox = new RichTextBox();
            logBox.Location = new Point(20, 252);
            logBox.Size = new Size(660, 135);
            logBox.BackColor = Color.FromArgb(9, 13, 22);
            logBox.ForeColor = Color.FromArgb(148, 163, 184);
            logBox.Font = new Font("Consolas", 8.5f);
            logBox.ReadOnly = true;
            logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;

            btnInstall = new Button();
            btnInstall.Text = "Install Now (تثبيت وتحميل الناقص)";
            btnInstall.Location = new Point(20, 398);
            btnInstall.Size = new Size(280, 36);
            btnInstall.BackColor = Color.FromArgb(16, 185, 129);
            btnInstall.ForeColor = Color.White;
            btnInstall.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            btnInstall.Click += new EventHandler(OnInstallClick);

            btnLaunch = new Button();
            btnLaunch.Text = "Launch Hafiz Studio";
            btnLaunch.Location = new Point(315, 398);
            btnLaunch.Size = new Size(200, 36);
            btnLaunch.BackColor = Color.FromArgb(59, 130, 246);
            btnLaunch.ForeColor = Color.White;
            btnLaunch.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnLaunch.FlatStyle = FlatStyle.Flat;
            btnLaunch.Enabled = false;
            btnLaunch.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            btnLaunch.Click += new EventHandler(OnLaunchClick);

            body.Controls.Add(lblDir);
            body.Controls.Add(txtInstallDir);
            body.Controls.Add(btnBrowse);
            body.Controls.Add(chkInstallPrereqs);
            body.Controls.Add(chkInstallPythonAi);
            body.Controls.Add(chkDesktopShortcut);
            body.Controls.Add(chkOpenModelsFolder);
            body.Controls.Add(lblStatus);
            body.Controls.Add(progressBar);
            body.Controls.Add(logBox);
            body.Controls.Add(btnInstall);
            body.Controls.Add(btnLaunch);

            Controls.Add(body);
            Controls.Add(header);
        }

        private void OnBrowseClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.SelectedPath = txtInstallDir.Text;
                if (dlg.ShowDialog() == DialogResult.OK)
                {
                    txtInstallDir.Text = dlg.SelectedPath;
                }
            }
        }

        private void OnLaunchClick(object sender, EventArgs e)
        {
            string startBat = Path.Combine(txtInstallDir.Text.Trim(), "start_hafiz.bat");
            if (File.Exists(startBat))
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = startBat;
                psi.WorkingDirectory = txtInstallDir.Text.Trim();
                psi.UseShellExecute = true;
                Process.Start(psi);
                Close();
            }
        }

        private void OnInstallClick(object sender, EventArgs e)
        {
            if (isInstalling) return;
            string installDir = txtInstallDir.Text.Trim();
            if (string.IsNullOrEmpty(installDir))
            {
                MessageBox.Show("Please choose an installation folder.", "Hafiz Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            isInstalling = true;
            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtInstallDir.Enabled = false;

            bool doPrereqs = chkInstallPrereqs.Checked;
            bool doPythonAi = chkInstallPythonAi.Checked;
            bool doShortcuts = chkDesktopShortcut.Checked;
            bool doOpenModels = chkOpenModelsFolder.Checked;

            Thread worker = new Thread(delegate()
            {
                RunInstallation(installDir, doPrereqs, doPythonAi, doShortcuts, doOpenModels);
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void UiLog(string msg)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(UiLog), msg);
                return;
            }
            logBox.AppendText(msg + Environment.NewLine);
            logBox.ScrollToCaret();
        }

        private void UiProgress(int pct, string status)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<int, string>(UiProgress), pct, status);
                return;
            }
            if (pct >= 0 && pct <= 100) progressBar.Value = pct;
            if (!string.IsNullOrEmpty(status)) lblStatus.Text = status;
        }

        private void RunInstallation(string installDir, bool doPrereqs, bool doPythonAi, bool doShortcuts, bool doOpenModels)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                Directory.CreateDirectory(installDir);

                UiProgress(10, "Extracting application bundle into " + installDir + "...");
                ExtractAppFiles(installDir);

                string modelsDir = Path.Combine(installDir, "models");
                Directory.CreateDirectory(modelsDir);
                UiLog("[OK] Models folder ready at: " + modelsDir);

                RefreshPathFromRegistry();

                if (doPrereqs)
                {
                    UiProgress(25, "Checking Node.js, Python 3.11 & FFmpeg...");
                    EnsurePrerequisites(installDir);
                    RefreshPathFromRegistry();
                }

                string nodeExe = FindExecutable("node.exe", new string[] {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                    @"C:\Program Files\nodejs\node.exe"
                });
                if (string.IsNullOrEmpty(nodeExe))
                {
                    throw new Exception("Node.js was not detected. Please install Node.js 20+ from https://nodejs.org and re-run setup.");
                }

                string npmCmd = Path.Combine(Path.GetDirectoryName(nodeExe), "npm.cmd");
                if (!File.Exists(npmCmd)) npmCmd = "npm.cmd";

                UiProgress(45, "Installing Node.js dependencies (npm install)...");
                int npmCode = RunProcess(npmCmd, "install", installDir);
                if (npmCode != 0)
                {
                    throw new Exception("npm install failed with exit code " + npmCode);
                }

                if (doPythonAi)
                {
                    UiProgress(65, "Setting up Python .venv and downloading AI backends...");
                    InstallPythonBackends(installDir);
                }

                if (doShortcuts)
                {
                    UiProgress(90, "Creating Desktop shortcuts...");
                    CreateDesktopShortcuts(installDir, modelsDir);
                }

                UiProgress(100, "Installation Complete! Put your model folders inside: " + modelsDir);
                UiLog("============================================================");
                UiLog("SETUP COMPLETE!");
                UiLog("Drop your model folders inside: " + modelsDir);
                UiLog("Then launch: " + Path.Combine(installDir, "start_hafiz.bat"));

                BeginInvoke(new Action(delegate()
                {
                    btnLaunch.Enabled = true;
                    isInstalling = false;
                    btnInstall.Enabled = true;
                    if (doOpenModels && Directory.Exists(modelsDir))
                    {
                        Process.Start("explorer.exe", modelsDir);
                    }
                    MessageBox.Show(
                        "Setup finished successfully!\n\nModels Folder:\n" + modelsDir + "\n\nMove your model folders inside this 'models' folder and launch Hafiz Studio.",
                        "Hafiz Bel'Amya Setup",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }));
            }
            catch (Exception ex)
            {
                UiLog("[ERROR] " + ex.Message);
                UiProgress(0, "Setup encountered an error.");
                BeginInvoke(new Action(delegate()
                {
                    isInstalling = false;
                    btnInstall.Enabled = true;
                    btnBrowse.Enabled = true;
                    txtInstallDir.Enabled = true;
                    MessageBox.Show(ex.Message, "Setup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }));
            }
        }

        private void ExtractAppFiles(string installDir)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream payloadStream = asm.GetManifestResourceStream("HafizPayload.zip");
            if (payloadStream != null)
            {
                string tmpZip = Path.Combine(Path.GetTempPath(), "hafiz_setup_payload.zip");
                using (FileStream fs = new FileStream(tmpZip, FileMode.Create, FileAccess.Write))
                {
                    payloadStream.CopyTo(fs);
                }
                payloadStream.Dispose();

                using (ZipArchive archive = ZipFile.OpenRead(tmpZip))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(Path.Combine(installDir, entry.FullName));
                            continue;
                        }
                        string destPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));
                        Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                        entry.ExtractToFile(destPath, true);
                    }
                }
                try { File.Delete(tmpZip); } catch { }
                UiLog("[OK] Extracted embedded application files.");
                return;
            }

            // Fallback: copy from adjacent source directory if running unbundled
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string parentDir = Directory.GetParent(exeDir.TrimEnd('\\')) != null ? Directory.GetParent(exeDir.TrimEnd('\\')).FullName : exeDir;
            string sourceRoot = File.Exists(Path.Combine(exeDir, "server.ts")) ? exeDir : parentDir;
            if (File.Exists(Path.Combine(sourceRoot, "server.ts")) && !string.Equals(Path.GetFullPath(sourceRoot).TrimEnd('\\'), Path.GetFullPath(installDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                UiLog("[Info] Copying files from " + sourceRoot + "...");
                RunProcess("robocopy", string.Format("\"{0}\" \"{1}\" /E /XD node_modules .venv dist .git /XF *.exe", sourceRoot, installDir), sourceRoot);
            }
        }

        private void EnsurePrerequisites(string installDir)
        {
            string winget = FindExecutable("winget.exe", new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\WindowsApps\winget.exe")
            });

            string nodeExe = FindExecutable("node.exe", new string[] { @"C:\Program Files\nodejs\node.exe" });
            if (string.IsNullOrEmpty(nodeExe))
            {
                UiLog("[Download] Installing Node.js 20 LTS...");
                if (!string.IsNullOrEmpty(winget))
                {
                    RunProcess(winget, "install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements", installDir);
                }
                else
                {
                    string msi = Path.Combine(Path.GetTempPath(), "node-v20.18.1-x64.msi");
                    DownloadFile("https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi", msi);
                    RunProcess("msiexec.exe", string.Format("/i \"{0}\" /qn", msi), installDir);
                }
            }
            else
            {
                UiLog("[OK] Node.js found: " + nodeExe);
            }

            string pyExe = FindPython();
            if (string.IsNullOrEmpty(pyExe))
            {
                UiLog("[Download] Installing Python 3.11...");
                if (!string.IsNullOrEmpty(winget))
                {
                    RunProcess(winget, "install --id Python.Python.3.11 -e --accept-package-agreements --accept-source-agreements", installDir);
                }
                else
                {
                    string exe = Path.Combine(Path.GetTempPath(), "python-3.11.9-amd64.exe");
                    DownloadFile("https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe", exe);
                    RunProcess(exe, "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1", installDir);
                }
            }
            else
            {
                UiLog("[OK] Python found: " + pyExe);
            }

            string ffmpegExe = FindExecutable("ffmpeg.exe", new string[0]);
            if (string.IsNullOrEmpty(ffmpegExe) && !string.IsNullOrEmpty(winget))
            {
                UiLog("[Download] Installing FFmpeg via winget...");
                RunProcess(winget, "install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements", installDir);
            }
        }

        private void InstallPythonBackends(string installDir)
        {
            string pyExe = FindPython();
            if (string.IsNullOrEmpty(pyExe))
            {
                UiLog("[WARN] Python not found after check; skipping .venv AI packages.");
                return;
            }

            string venvPy = Path.Combine(installDir, @".venv\Scripts\python.exe");
            if (!File.Exists(venvPy))
            {
                UiLog("[Python] Creating .venv...");
                RunProcess(pyExe, "-m venv .venv", installDir);
            }

            if (!File.Exists(venvPy)) venvPy = pyExe;

            RunProcess(venvPy, "-m pip install --upgrade pip setuptools wheel", installDir);

            string nvidia = FindExecutable("nvidia-smi.exe", new string[] {
                @"C:\Windows\System32\nvidia-smi.exe",
                @"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
            });

            if (!string.IsNullOrEmpty(nvidia))
            {
                UiLog("[GPU] NVIDIA GPU detected! Installing CUDA PyTorch + CUDA llama-cpp-python...");
                RunProcess(venvPy, "-m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124", installDir);
                RunProcess(venvPy, "-m pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124", installDir);
            }

            string reqPath = Path.Combine(installDir, "requirements.txt");
            if (File.Exists(reqPath))
            {
                RunProcess(venvPy, "-m pip install -r requirements.txt", installDir);
            }
            RunProcess(venvPy, "-m pip install openai-whisper --quiet", installDir);
            RunProcess(venvPy, "-m pip install TTS --quiet", installDir);
            RunProcess(venvPy, "-m pip install omnivoice --quiet", installDir);
        }

        private void DownloadFile(string url, string destPath)
        {
            UiLog("[GET] " + url);
            using (WebClient client = new WebClient())
            {
                client.DownloadFile(url, destPath);
            }
        }

        private int RunProcess(string fileName, string args, string workingDir)
        {
            UiLog("> " + fileName + " " + args);
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = args;
            psi.WorkingDirectory = workingDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            using (Process p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (!string.IsNullOrEmpty(e.Data)) UiLog("  " + e.Data);
                };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (!string.IsNullOrEmpty(e.Data)) UiLog("  " + e.Data);
                };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        private void CreateDesktopShortcuts(string installDir, string modelsDir)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                CreateShortcut(Path.Combine(desktop, "Hafiz Bel'Amya.lnk"), Path.Combine(installDir, "start_hafiz.bat"), installDir, "Launch Hafiz Bel'Amya Studio");
                CreateShortcut(Path.Combine(desktop, "Hafiz Models Folder.lnk"), modelsDir, modelsDir, "Drop your AI model folders here");
                UiLog("[OK] Desktop shortcuts created.");
            }
            catch (Exception ex)
            {
                UiLog("[WARN] Could not create shortcuts: " + ex.Message);
            }
        }

        private void CreateShortcut(string lnkPath, string targetPath, string workDir, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type scType = shortcut.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        private string FindPython()
        {
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindExecutable("python.exe", new string[] {
                Path.Combine(localApp, @"Programs\Python\Python311\python.exe"),
                Path.Combine(localApp, @"Programs\Python\Python312\python.exe"),
                Path.Combine(localApp, @"Programs\Python\Python310\python.exe"),
                @"C:\Python311\python.exe",
                @"C:\Python310\python.exe"
            });
        }

        private string FindExecutable(string exeName, string[] extraPaths)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] dirs = pathEnv.Split(';');
            foreach (string d in dirs)
            {
                if (string.IsNullOrEmpty(d)) continue;
                try
                {
                    string candidate = Path.Combine(d.Trim(), exeName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            foreach (string p in extraPaths)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private void RefreshPathFromRegistry()
        {
            try
            {
                string sysPath = "";
                string usrPath = "";
                using (RegistryKey k1 = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"))
                {
                    if (k1 != null) sysPath = Convert.ToString(k1.GetValue("Path", ""));
                }
                using (RegistryKey k2 = Registry.CurrentUser.OpenSubKey(@"Environment"))
                {
                    if (k2 != null) usrPath = Convert.ToString(k2.GetValue("Path", ""));
                }
                string current = Environment.GetEnvironmentVariable("PATH") ?? "";
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string combined = string.Format("{0};{1};{2};{3};{4}",
                    sysPath,
                    usrPath,
                    @"C:\Program Files\nodejs",
                    Path.Combine(localApp, @"Programs\Python\Python311"),
                    current);
                Environment.SetEnvironmentVariable("PATH", combined);
            }
            catch { }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
