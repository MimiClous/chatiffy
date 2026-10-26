using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    internal const string Url = "http://127.0.0.1:8080";
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
                    using (var context = new TrayContext(stop)) Application.Run(context);
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
    private readonly Control dispatcher = new Control();
    private readonly ToolStripMenuItem status = new ToolStripMenuItem("Запускается…");
    private readonly ToolStripMenuItem open = new ToolStripMenuItem("Открыть редактор");
    private readonly System.Windows.Forms.Timer startup = new System.Windows.Forms.Timer();
    private readonly RegisteredWaitHandle stopWait;
    private Process child;
    private Job job;
    private bool closing;
    private bool ready;

    internal TrayContext(EventWaitHandle stop)
    {
        dispatcher.CreateControl();
        status.Enabled = false;
        open.Enabled = false;
        open.Click += delegate { Open(Program.Url); };
        var menu = new ContextMenuStrip();
        menu.Renderer = new ToolStripProfessionalRenderer(new PixelColors());
        menu.BackColor = Color.FromArgb(29, 25, 41);
        menu.ForeColor = Color.FromArgb(244, 240, 255);
        menu.Font = new Font("Consolas", 10);
        menu.ShowImageMargin = false;
        menu.ShowCheckMargin = false;
        menu.Items.Add(status);
        menu.Items.Add(open);
        menu.Items.Add("Настройки Twitch", null, delegate { Open(Program.Config); });
        menu.Items.Add("Открыть журнал", null, delegate { Open(Program.LogFile); });
        menu.Items.Add("Перезапустить сервер", null, delegate { StopServer(); StartServer(); });
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
            info.EnvironmentVariables["PORT"] = "8080";
            info.EnvironmentVariables["ALLOWED_HOSTS"] = "127.0.0.1,localhost";
            info.EnvironmentVariables["CHATIFFY_DESKTOP"] = "1";
            info.EnvironmentVariables["NODE_ENV"] = "production";
            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            child = process;
            job = new Job();
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                Program.Log(e.Data);
                if (e.Data == "CHATIFFY_READY") Dispatch(delegate {
                    if (child != process || process.HasExited) return;
                    startup.Stop(); ready = true; open.Enabled = true;
                    status.Text = "Работает: " + Program.Url;
                    tray.Text = "Chatiffy — сервер работает";
                    tray.ShowBalloonTip(3000, "Chatiffy запущен", "Двойной щелчок по значку откроет редактор.", ToolTipIcon.Info);
                });
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Program.Log(e.Data); };
            process.Exited += delegate { Dispatch(delegate {
                if (child != process) return;
                startup.Stop();
                Failure("Сервер остановлен. Возможно, порт 8080 занят. См. журнал и перезапустите сервер.");
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
        base.ExitThreadCore();
    }
}

internal sealed class PixelColors : ProfessionalColorTable
{
    public PixelColors() { UseSystemColors = false; }
    public override Color ToolStripDropDownBackground { get { return Color.FromArgb(29, 25, 41); } }
    public override Color MenuBorder { get { return Color.FromArgb(167, 139, 250); } }
    public override Color MenuItemBorder { get { return Color.FromArgb(101, 224, 188); } }
    public override Color MenuItemSelected { get { return Color.FromArgb(65, 50, 83); } }
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
