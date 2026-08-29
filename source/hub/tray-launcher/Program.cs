using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VtallyTray;

internal static class Program
{
    private const string HubUrl = "http://localhost:3000/";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, "Global\\VTallyWebTray", out var isFirstInstance);
        if (!isFirstInstance)
        {
            OpenBrowser(HubUrl);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext());
    }

    internal static void OpenBrowser(string url)
    {
        if (Environment.GetEnvironmentVariable("VTALLY_NO_BROWSER") == "true")
        {
            return;
        }

        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const string HubUrl = "http://localhost:3000/";
    private const string StartupValueName = "vTally Hub";
    private readonly NotifyIcon trayIcon;
    private readonly System.Windows.Forms.Timer monitorTimer;
    private readonly string serverPath;
    private readonly string workingDirectory;
    private readonly string configPath;
    private readonly string settingsPath;
    private readonly TraySettings settings;
    private readonly ToolStripMenuItem autoStartMenuItem;
    private readonly ToolStripMenuItem startHiddenMenuItem;
    private readonly ToolStripMenuItem confirmExitMenuItem;
    private Process? serverProcess;
    private bool isExiting;
    private bool suppressOptionEvents;

    public TrayContext()
    {
        workingDirectory = AppContext.BaseDirectory;
        configPath = Path.Combine(workingDirectory, "wifi-tally.json");
        settingsPath = Path.Combine(workingDirectory, "vtally-web-options.json");
        settings = TraySettings.Load(settingsPath);
        settings.AutoStartWithWindows = IsAutoStartEnabled();
        serverPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "vTally Hub",
            "vtally-server.exe"
        );

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open vTally Hub", null, (_, _) => Program.OpenBrowser(HubUrl));
        menu.Items.Add("Restart Hub", null, (_, _) => RestartServer());
        menu.Items.Add(new ToolStripSeparator());
        autoStartMenuItem = new ToolStripMenuItem("Start with Windows")
        {
            Checked = settings.AutoStartWithWindows,
            CheckOnClick = true
        };
        autoStartMenuItem.CheckedChanged += (_, _) =>
        {
            if (!suppressOptionEvents)
            {
                SetAutoStart(autoStartMenuItem.Checked);
            }
        };
        menu.Items.Add(autoStartMenuItem);

        startHiddenMenuItem = new ToolStripMenuItem("Start hidden to tray")
        {
            Checked = settings.StartHiddenToTray,
            CheckOnClick = true
        };
        startHiddenMenuItem.CheckedChanged += (_, _) =>
        {
            if (suppressOptionEvents)
            {
                return;
            }

            settings.StartHiddenToTray = startHiddenMenuItem.Checked;
            SaveSettings();
        };
        menu.Items.Add(startHiddenMenuItem);

        confirmExitMenuItem = new ToolStripMenuItem("Confirm before exit")
        {
            Checked = settings.ConfirmBeforeExit,
            CheckOnClick = true
        };
        confirmExitMenuItem.CheckedChanged += (_, _) =>
        {
            if (suppressOptionEvents)
            {
                return;
            }

            settings.ConfirmBeforeExit = confirmExitMenuItem.Checked;
            SaveSettings();
        };
        menu.Items.Add(confirmExitMenuItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitTray());

        trayIcon = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "vTally Hub",
            ContextMenuStrip = menu,
            Visible = true
        };
        trayIcon.DoubleClick += (_, _) => Program.OpenBrowser(HubUrl);

        monitorTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        monitorTimer.Tick += (_, _) => EnsureServer();
        Application.ApplicationExit += (_, _) => StopServer();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => StopServer();

        StopExistingBundledServers();
        ExtractBundledServer();
        EnsureServer();
        if (!settings.StartHiddenToTray)
        {
            WaitForHubAndOpenBrowser();
        }
        monitorTimer.Start();
    }

    private void SaveSettings()
    {
        settings.Save(settingsPath);
    }

    private static RegistryKey? OpenRunKey(bool writable)
    {
        return Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable);
    }

    private static string StartupCommand()
    {
        return $"\"{Application.ExecutablePath}\"";
    }

    private static bool IsAutoStartEnabled()
    {
        try
        {
            using var key = OpenRunKey(false);
            return string.Equals(key?.GetValue(StartupValueName) as string, StartupCommand(), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private void SetAutoStart(bool enabled)
    {
        try
        {
            using var key = OpenRunKey(true);
            if (key == null)
            {
                throw new InvalidOperationException("Windows startup registry key was not found.");
            }

            if (enabled)
            {
                key.SetValue(StartupValueName, StartupCommand(), RegistryValueKind.String);
            }
            else
            {
                key.DeleteValue(StartupValueName, false);
            }

            settings.AutoStartWithWindows = enabled;
            SaveSettings();
        }
        catch
        {
            suppressOptionEvents = true;
            autoStartMenuItem.Checked = IsAutoStartEnabled();
            suppressOptionEvents = false;
            trayIcon.ShowBalloonTip(5000, "vTally Hub", "Windows startup option could not be changed.", ToolTipIcon.Error);
        }
    }

    private void ExtractBundledServer()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(serverPath)!);

        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith("vtally-server.exe", StringComparison.OrdinalIgnoreCase));

        if (resourceName == null)
        {
            trayIcon.ShowBalloonTip(5000, "vTally Hub", "Bundled server was not found.", ToolTipIcon.Error);
            return;
        }

        using var resource = assembly.GetManifestResourceStream(resourceName);
        if (resource == null)
        {
            trayIcon.ShowBalloonTip(5000, "vTally Hub", "Bundled server could not be opened.", ToolTipIcon.Error);
            return;
        }

        var tempPath = serverPath + ".tmp";
        using (var output = File.Create(tempPath))
        {
            resource.CopyTo(output);
        }

        try
        {
            if (File.Exists(serverPath))
            {
                File.Delete(serverPath);
            }

            File.Move(tempPath, serverPath);
        }
        catch
        {
            try { File.Delete(tempPath); } catch { }
        }
    }

    private void StopExistingBundledServers()
    {
        foreach (var process in Process.GetProcessesByName("vtally-server"))
        {
            try
            {
                if (!string.Equals(process.MainModule?.FileName, serverPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                process.Kill(true);
                process.WaitForExit(3000);
            }
            catch
            {
                // Keep shutdown quiet if Windows is already closing the process.
            }
        }
    }

    private void EnsureServer()
    {
        if (isExiting || IsHubResponding())
        {
            return;
        }

        if (serverProcess is { HasExited: false })
        {
            return;
        }

        if (!File.Exists(serverPath))
        {
            trayIcon.ShowBalloonTip(5000, "vTally Hub", "Server executable was not found.", ToolTipIcon.Error);
            return;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = serverPath,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        startInfo.Environment["VTALLY_NO_BROWSER"] = "true";
        startInfo.Environment["CONFIG_FILE"] = configPath;

        serverProcess = Process.Start(startInfo);
    }

    private static bool IsHubResponding()
    {
        try
        {
            var request = WebRequest.CreateHttp(HubUrl);
            request.Timeout = 800;
            using var response = (HttpWebResponse)request.GetResponse();
            return (int)response.StatusCode >= 200 && (int)response.StatusCode < 500;
        }
        catch
        {
            return false;
        }
    }

    private void WaitForHubAndOpenBrowser()
    {
        Task.Run(() =>
        {
            for (var i = 0; i < 30; i++)
            {
                if (IsHubResponding())
                {
                    Program.OpenBrowser(HubUrl);
                    return;
                }

                Thread.Sleep(500);
            }

            trayIcon.ShowBalloonTip(5000, "vTally Hub", "Hub server is still starting.", ToolTipIcon.Warning);
        });
    }

    private void RestartServer()
    {
        StopServer();
        EnsureServer();
        if (!settings.StartHiddenToTray)
        {
            WaitForHubAndOpenBrowser();
        }
    }

    private void StopServer()
    {
        try
        {
            if (serverProcess is { HasExited: false })
            {
                serverProcess.Kill(true);
                serverProcess.WaitForExit(3000);
            }
        }
        catch
        {
            // Exiting should stay quiet from the user's point of view.
        }

        StopExistingBundledServers();
    }

    private void ExitTray()
    {
        if (settings.ConfirmBeforeExit)
        {
            var result = MessageBox.Show(
                "Exit vTally Hub and stop the server?",
                "vTally Hub",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button2
            );

            if (result != DialogResult.Yes)
            {
                return;
            }
        }

        isExiting = true;
        monitorTimer.Stop();
        trayIcon.Visible = false;
        StopServer();
        Application.Exit();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            monitorTimer.Dispose();
            trayIcon.Dispose();
        }

        base.Dispose(disposing);
    }
}

internal sealed class TraySettings
{
    public bool AutoStartWithWindows { get; set; }
    public bool StartHiddenToTray { get; set; }
    public bool ConfirmBeforeExit { get; set; } = true;

    public static TraySettings Load(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return new TraySettings();
            }

            return JsonSerializer.Deserialize<TraySettings>(File.ReadAllText(path)) ?? new TraySettings();
        }
        catch
        {
            return new TraySettings();
        }
    }

    public void Save(string path)
    {
        try
        {
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
        }
        catch
        {
            // Options are a convenience; keep the tray app running if saving fails.
        }
    }
}
