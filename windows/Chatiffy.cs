using System;
using Microsoft.Win32;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    internal const string Url = "http://127.0.0.1:17845";
    internal static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Chatiffy");
    internal static readonly string Config = Path.Combine(Data, "settings.env");
    internal static readonly string LogFile = Path.Combine(Data, "server.log");
    private static readonly object LogLock = new object();

    internal static void Log(string line)
    {
        if (String.IsNullOrWhiteSpace(line)) return;
        lock (LogLock)
        {
            try
            {
                if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 1024 * 1024)
                {
                    File.Copy(LogFile, LogFile + ".previous", true);
                    File.Delete(LogFile);
                }
                File.AppendAllText(LogFile, DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            bool created;
            using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Chatiffy.Stop"))
            using (var mutex = new Mutex(true, @"Local\Chatiffy.Desktop", out created))
            {
                if (Array.IndexOf(args, "--quit") >= 0) { if (!created) stop.Set(); return 0; }
                if (!created) return 0;
                try
                {
                    Directory.CreateDirectory(Data);
                    if (!File.Exists(Config)) File.WriteAllText(Config, "# Optional Twitch credentials. Save and restart from the tray.\r\nTWITCH_CLIENT_ID=\r\nTWITCH_CLIENT_SECRET=\r\n");
                    using (var context = new TrayContext(stop, Array.IndexOf(args, "--autostart") >= 0)) Application.Run(context);
                }
                finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception error)
        {
            Log(error.ToString());
            MessageBox.Show(error.Message, "Chatiffy", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly Icon appIcon;
    private readonly string fontPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app", "assets", "fonts", "Monocraft.ttf");
    private readonly System.Drawing.Text.PrivateFontCollection fonts = new System.Drawing.Text.PrivateFontCollection();
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] private static extern int AddFontResourceEx(string file, uint flags, IntPtr reserved);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] private static extern bool RemoveFontResourceEx(string file, uint flags, IntPtr reserved);
    private readonly Control dispatcher = new Control();
    private readonly ToolStripMenuItem status = new ToolStripMenuItem("Запускается…");
    private readonly ToolStripMenuItem open = new ToolStripMenuItem("Открыть редактор");
    private bool updating;
    private readonly bool quietStartup;
    private readonly ToolStripMenuItem autostart = new ToolStripMenuItem("Запускать вместе с Windows");
    private readonly ToolStripMenuItem updates = new ToolStripMenuItem("Проверить обновления");
    private readonly System.Windows.Forms.Timer startup = new System.Windows.Forms.Timer();
    private readonly RegisteredWaitHandle stopWait;
    private Process child;
    private Job job;
    private bool closing;
    private bool ready;

    internal TrayContext(EventWaitHandle stop, bool fromAutostart)
    {
        quietStartup = fromAutostart;
        dispatcher.CreateControl();
        status.Enabled = false;
        open.Enabled = false;
        open.Click += delegate { Open(Program.Url); };
        var menu = new ContextMenuStrip();
        menu.Renderer = new PixelMenuRenderer();
        menu.BackColor = Color.FromArgb(29, 25, 41);
        menu.ForeColor = Color.FromArgb(244, 240, 255);
        // WinForms TextRenderer uses GDI; register privately as well as with GDI+.
        if (AddFontResourceEx(fontPath, 0x10, IntPtr.Zero) == 0) throw new IOException("Cannot load the bundled Monocraft font.");
        fonts.AddFontFile(fontPath);
        menu.Font = new Font(fonts.Families[0], 10, FontStyle.Regular);
        menu.ShowImageMargin = false;
        menu.ShowCheckMargin = true;
        menu.Items.Add(status);
        menu.Items.Add(open);
        menu.Items.Add("Диагностика", null, delegate { Open(Program.Url + "/?diagnostics=1"); });
        updates.Click += delegate { Open(Program.Url + "/?updates=1"); };
        menu.Items.Add(updates);
        try {
            // Keep an explicitly enabled registration valid after moving the portable folder.
            if (StartupRegistration.Enabled) StartupRegistration.SetEnabled(true);
            autostart.Checked = StartupRegistration.Enabled;
        } catch (Exception error) { Program.Log("Autostart: " + error.Message); }
        autostart.ToolTipText = "Запуск в трее при входе в Windows, без открытия браузера.";
        autostart.Click += delegate {
            try {
                StartupRegistration.SetEnabled(!StartupRegistration.Enabled);
                autostart.Checked = StartupRegistration.Enabled;
            } catch (Exception error) {
                Program.Log(error.ToString());
                MessageBox.Show(error.Message, "Не удалось изменить автозагрузку Chatiffy", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
        menu.Opening += delegate {
            try { autostart.Checked = StartupRegistration.Enabled; }
            catch (Exception error) { Program.Log("Autostart: " + error.Message); }
        };
        menu.Items.Add(autostart);
        var advanced = new ToolStripMenuItem("Дополнительно");
        advanced.DropDownItems.Add("Настройки Twitch", null, delegate { Open(Program.Config); });
        advanced.DropDownItems.Add("Открыть журнал", null, delegate { Open(Program.LogFile); });
        advanced.DropDownItems.Add("Перезапустить сервер", null, delegate { StopServer(); StartServer(); });
        advanced.DropDown.BackColor = Color.FromArgb(29, 25, 41);
        advanced.DropDown.ForeColor = Color.FromArgb(244, 240, 255);
        advanced.DropDown.Renderer = new PixelMenuRenderer();
        advanced.DropDown.Font = menu.Font;
        menu.Items.Add(advanced);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Выход", null, delegate { ExitThread(); });
        using (var stream = typeof(Program).Assembly.GetManifestResourceStream("Chatiffy.Icon"))
        using (var source = new Icon(stream, SystemInformation.SmallIconSize)) appIcon = (Icon)source.Clone();
        tray = new NotifyIcon { Icon = appIcon, Text = "Chatiffy — запуск", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { if (ready) Open(Program.Url); };
        startup.Interval = 15000;
        startup.Tick += delegate { startup.Stop(); StopServer(); Failure("Сервер не запустился за 15 секунд. См. журнал."); };
        stopWait = ThreadPool.RegisterWaitForSingleObject(stop, delegate { Dispatch(delegate { ExitThread(); }); }, null, Timeout.Infinite, true);
        StartServer();
    }

    private void StartUpdate(string version)
    {
        if (updating) return;
        if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+$")) return;
        try
        {
            string temp = Path.Combine(Path.GetTempPath(), "Chatiffy-update-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            string script = Path.Combine(temp, "update.ps1");
            File.Copy(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "update.ps1"), script);
            string install = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            var info = new ProcessStartInfo("powershell.exe") {
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Version \"" + version + "\" -InstallPath \"" + install + "\" -LauncherPid " + Process.GetCurrentProcess().Id + " -StatusPath \"" + Path.Combine(Program.Data, "update-status.json") + "\"",
                UseShellExecute = true, WorkingDirectory = temp
            };
            // The helper validates and downloads before asking this launcher to quit.
            var helper = Process.Start(info);
            updating = true;
            helper.EnableRaisingEvents = true;
            helper.Exited += delegate { Dispatch(delegate { updating = false; }); helper.Dispose(); };
        }
        catch (Exception error) {
            Program.Log(error.ToString());
            try { File.WriteAllText(Path.Combine(Program.Data, "update-status.json"), "{\"stage\":\"failed\",\"message\":\"Windows could not start the updater. Check the application log.\"}"); } catch { }
            MessageBox.Show(error.Message, "Ошибка обновления Chatiffy", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void Open(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        catch (Exception error) { Failure(error.Message); }
    }

    private void Dispatch(Action action)
    {
        try { if (!closing && !dispatcher.IsDisposed) dispatcher.BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    private void StartServer()
    {
        ready = false;
        open.Enabled = false;
        status.Text = "Запускается…";
        tray.Text = "Chatiffy — запуск";
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe")) {
                Arguments = "--env-file=\"" + Program.Config + "\" \"" + Path.Combine(root, "app", "server.mjs") + "\"",
                WorkingDirectory = Path.Combine(root, "app"), UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            info.EnvironmentVariables.Remove("NODE_OPTIONS");
            info.EnvironmentVariables.Remove("TWITCH_CLIENT_ID");
            info.EnvironmentVariables.Remove("TWITCH_CLIENT_SECRET");
            info.EnvironmentVariables["HOST"] = "127.0.0.1";
            info.EnvironmentVariables["PORT"] = "17845";
            info.EnvironmentVariables["ALLOWED_HOSTS"] = "127.0.0.1,localhost";
            info.EnvironmentVariables["CHATIFFY_DATA_DIR"] = Program.Data;
            info.EnvironmentVariables["CHATIFFY_DESKTOP"] = "1";
            info.EnvironmentVariables["NODE_ENV"] = "production";
            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            child = process;
            job = new Job();
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                Program.Log(e.Data);
                if (e.Data != null && e.Data.StartsWith("CHATIFFY_UPDATE_AVAILABLE ")) Dispatch(delegate {
                    updates.Text = "Доступно обновление " + e.Data.Substring("CHATIFFY_UPDATE_AVAILABLE ".Length);
                });
                if (e.Data != null && e.Data.StartsWith("CHATIFFY_UPDATE ")) Dispatch(delegate { StartUpdate(e.Data.Substring("CHATIFFY_UPDATE ".Length).Trim()); });
                if (e.Data == "CHATIFFY_READY") Dispatch(delegate {
                    if (child != process || process.HasExited) return;
                    startup.Stop(); ready = true; open.Enabled = true;
                    status.Text = "Работает: " + Program.Url;
                    tray.Text = "Chatiffy — сервер работает";
                    if (!quietStartup) tray.ShowBalloonTip(3000, "Chatiffy запущен", "Двойной щелчок по значку откроет редактор.", ToolTipIcon.Info);
                });
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Program.Log(e.Data); };
            process.Exited += delegate { Dispatch(delegate {
                if (child != process) return;
                startup.Stop();
                Failure("Сервер остановлен. Возможно, порт 17845 занят. См. журнал и перезапустите сервер.");
            }); };
            process.Start();
            job.Assign(process);
            process.BeginOutputReadLine(); process.BeginErrorReadLine();
            startup.Start();
        }
        catch (Exception error) { StopServer(); Program.Log(error.ToString()); Failure(error.Message); }
    }

    private void Failure(string message)
    {
        ready = false; open.Enabled = false;
        status.Text = "Сервер недоступен";
        tray.Text = "Chatiffy — ошибка";
        tray.ShowBalloonTip(5000, "Chatiffy", message, ToolTipIcon.Error);
    }

    private void StopServer()
    {
        startup.Stop();
        var process = child; child = null;
        if (process != null)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.StandardInput.WriteLine("shutdown"); process.StandardInput.Flush();
                    if (!process.WaitForExit(3000)) process.Kill();
                }
            }
            catch (InvalidOperationException) { }
            catch (IOException) { }
            catch (System.ComponentModel.Win32Exception error) { Program.Log(error.Message); }
            finally { process.Dispose(); }
        }
        if (job != null) { job.Dispose(); job = null; }
    }

    protected override void ExitThreadCore()
    {
        closing = true;
        stopWait.Unregister(null);
        tray.Visible = false;
        StopServer();
        var menuFont = tray.ContextMenuStrip.Font;
        tray.ContextMenuStrip.Dispose(); menuFont.Dispose(); tray.Dispose(); appIcon.Dispose(); startup.Dispose(); dispatcher.Dispose();
        fonts.Dispose(); RemoveFontResourceEx(fontPath, 0x10, IntPtr.Zero);
        base.ExitThreadCore();
    }
}

// Current-user registration only; does not require administrator privileges.
internal static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Chatiffy";
    internal static bool Enabled {
        get {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                return key != null && !String.IsNullOrWhiteSpace(key.GetValue(ValueName) as string);
        }
    }
    internal static void SetEnabled(bool enabled) {
        if (enabled) {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
                key.SetValue(ValueName, "\"" + Application.ExecutablePath + "\" --autostart", RegistryValueKind.String);
        } else {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                if (key != null) key.DeleteValue(ValueName, false);
        }
    }
}

internal sealed class PixelMenuRenderer : ToolStripProfessionalRenderer
{
    internal PixelMenuRenderer() : base(new PixelColors()) { RoundedEdges = false; }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
        e.TextColor = e.Item.Enabled ? Color.FromArgb(244, 240, 255) : Color.FromArgb(155, 145, 175);
        base.OnRenderItemText(e);
    }
    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e) {
        e.ArrowColor = e.Item.Enabled ? Color.FromArgb(101, 224, 188) : Color.FromArgb(155, 145, 175);
        base.OnRenderArrow(e);
    }
    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e) {
        var r = e.ImageRectangle;
        using (var pen = new Pen(Color.FromArgb(101, 224, 188), 2)) {
            e.Graphics.DrawLines(pen, new Point[] {
                new Point(r.Left + 2, r.Top + r.Height / 2),
                new Point(r.Left + r.Width / 2 - 1, r.Bottom - 3),
                new Point(r.Right - 2, r.Top + 3)
            });
        }
    }
}

internal sealed class PixelColors : ProfessionalColorTable
{
    public PixelColors() { UseSystemColors = false; }
    public override Color ToolStripDropDownBackground { get { return Color.FromArgb(29, 25, 41); } }
    public override Color MenuBorder { get { return Color.FromArgb(167, 139, 250); } }
    public override Color MenuItemBorder { get { return Color.FromArgb(101, 224, 188); } }
    public override Color MenuItemSelected { get { return Color.FromArgb(65, 50, 83); } }
    public override Color MenuItemSelectedGradientBegin { get { return MenuItemSelected; } }
    public override Color MenuItemSelectedGradientEnd { get { return MenuItemSelected; } }
    public override Color MenuItemPressedGradientBegin { get { return MenuItemSelected; } }
    public override Color MenuItemPressedGradientMiddle { get { return MenuItemSelected; } }
    public override Color MenuItemPressedGradientEnd { get { return MenuItemSelected; } }
    public override Color ImageMarginGradientBegin { get { return ToolStripDropDownBackground; } }
    public override Color ImageMarginGradientMiddle { get { return ToolStripDropDownBackground; } }
    public override Color ImageMarginGradientEnd { get { return ToolStripDropDownBackground; } }
    public override Color CheckBackground { get { return ToolStripDropDownBackground; } }
    public override Color CheckSelectedBackground { get { return MenuItemSelected; } }
    public override Color CheckPressedBackground { get { return MenuItemSelected; } }
    public override Color SeparatorDark { get { return Color.FromArgb(59, 50, 79); } }
    public override Color SeparatorLight { get { return Color.FromArgb(59, 50, 79); } }
}

// Windows kills the server if its tray owner crashes or is terminated.
internal sealed class Job : IDisposable
{
    private IntPtr handle;
    [StructLayout(LayoutKind.Sequential)] private struct Basic {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Io {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Limits {
        public Basic Basic;
        public Io Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    internal Job() {
        handle = CreateJobObject(IntPtr.Zero, null);
        var limits = new Limits(); limits.Basic.Flags = 0x2000;
        if (handle == IntPtr.Zero || !SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits)))) {
            int error = Marshal.GetLastWin32Error(); Dispose(); throw new System.ComponentModel.Win32Exception(error);
        }
    }
    internal void Assign(Process process) {
        if (!AssignProcessToJobObject(handle, process.Handle)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}
