using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using KeePass;
using KeePass.App;
using KeePass.App.Configuration;
using KeePass.Forms;
using KeePass.Plugins;
using KeePass.Resources;
using KeePass.UI;
using KeePass.Util;
using KeePass.Util.Spr;
using KeePassLib;
using KeePassLib.Collections;
using KeePassLib.Keys;
using KeePassLib.Serialization;
using KeePassLib.Utility;
using KeePassFerry.Forms;
using KeePassFerry.Models.DataExchange;
using KeePassFerry.Properties;
using OptionsForm = KeePassFerry.Forms.OptionsForm;

namespace KeePassFerry
{
    /// <summary>
    /// The main class - starts the RPC service and server
    /// </summary>
    public sealed class KeePassFerryExt : Plugin
    {
        // version information
        public static readonly Version PluginVersion = new Version(2, 0, 2);

        // KeePass prüft hier auf neue Plugin-Versionen (Zeile "KeePassFerry:1.2.3", wie der AssemblyTitle)
        public override string UpdateUrl
        {
            get { return "https://raw.githubusercontent.com/KeePassFerry/KeePassFerry/main/version.txt"; }
        }

        private BackgroundWorker _BackgroundWorker; // used to invoke main thread from other threads
        private AutoResetEvent _BackgroundWorkerAutoResetEvent;
        private NativePipeServer _RPCServer;

        /// <summary>
        /// Eigene Schlüssel und gekoppelte Browser-Clients von KeePassFerry
        /// </summary>
        internal FerryIdentity FerryIdentity { get; private set; }
        private FerryService _RPCService;

        public TextWriter logger;

        /// <summary>
        /// Listens for requests from RPC clients (native messaging host)
        /// </summary>
        public NativePipeServer RPCServer
        {
            get { return _RPCServer; }
        }

        /// <summary>
        /// Provides an externally accessible API for common KeePass operations
        /// </summary>
        public FerryService RPCService
        {
            get { return _RPCService; }
        }

        internal IPluginHost _host;

        private EventHandler<GwmWindowEventArgs> GwmWindowAddedHandler;

        private static LockManager _lockRPCClientManagers = new LockManager();
        private Dictionary<string, FerryClientManager> _RPCClientManagers = new Dictionary<string, FerryClientManager>(3);
        public volatile bool terminating;

        /// <summary>
        /// The <c>Initialize</c> function is called by KeePass when
        /// you should initialize your plugin (create menu items, etc.).
        /// </summary>
        /// <param name="host">Plugin host interface. By using this
        /// interface, you can access the KeePass main window and the
        /// currently opened database.</param>
        /// <returns>true if channel registered correctly, otherwise false</returns>
        public override bool Initialize(IPluginHost host)
        {
            try
            {

                Debug.Assert(host != null);
                if (host == null)
                    return false;
                _host = host;

                // KeePass-Update-Prüfung: version.txt ist mit dem Release-Schlüssel signiert (signing/sign-version.ps1);
                // unsignierte oder veränderte Dateien zeigt KeePass als Fehler statt einer falschen Version
                UpdateCheckEx.SetFileSigKey(UpdateUrl, FerryReleaseKey.PublicKeyXml);

                _BackgroundWorker = new BackgroundWorker();
                _BackgroundWorker.WorkerReportsProgress = true;
                _BackgroundWorker.ProgressChanged += _BackgroundWorker_ProgressChanged;
                _BackgroundWorkerAutoResetEvent = new AutoResetEvent(false);
                _BackgroundWorker.DoWork += delegate
                {
                    _BackgroundWorkerAutoResetEvent.WaitOne();
                };
                _BackgroundWorker.RunWorkerAsync();

                string debugFileName = host.CommandLineArgs["KeePassFerryDebug"];
                if (debugFileName != null)
                {
                    try
                    {
                        logger = new StreamWriter(debugFileName);
                        ((StreamWriter)logger).AutoFlush = true;
                    }
                    catch (Exception ex)
                    {
                        Utils.ShowMonoSafeMessageBox(FerryText.T("KeePassFerry: Das Debug-Protokoll konnte nicht gestartet werden. Bis zum Neustart von KeePass mit einem gültigen Protokollpfad wird nichts protokolliert. Grund: ", "KeePassFerry: The debug log could not be started. Nothing will be logged until KeePass is restarted with a valid log file location. Reason: ") + ex);
                    }
                }
                if (logger != null) logger.WriteLine("Logger initialised.");

                // Die Public Suffix List ist eingebettet (PublicSuffix.cs); die frühere DLL lud sie zur Laufzeit aus
                // dem Internet in diese Datei – Überbleibsel entfernen
                try
                {
                    string oldCache = GetLocalConfigLocation() + "publicSuffixDomainCache.txt";
                    if (File.Exists(oldCache)) File.Delete(oldCache);
                }
                catch (Exception)
                {
                    // nur Aufräumen
                }

                // The client managers hold the connections of native messaging hosts
                CreateClientManagers();

                if (logger != null) logger.WriteLine("Client managers started.");
                //TODO2: set up language services

                _RPCService = new FerryService(host,
                    getStandardIconsBase64(host.MainWindow.ClientIcons), this);
                if (logger != null) logger.WriteLine("RPC service started.");
                FerryIdentity = new FerryIdentity(host);
                SaveConfigSoon();

                Hibp = new HibpChecker(host);
                // Seit 1.0.17 ohne Sicherung erzeugter Passwörter: alte Einstellung entfernen
                host.CustomConfig.SetString("KeePassFerry.BackupGeneratedPasswords", null);
                try
                {
                    _RPCServer = new NativePipeServer(RPCService, this);
                }
                catch (InvalidOperationException ex)
                {
                    Utils.ShowMonoSafeMessageBox(@"KeePassFerry is already active in another KeePass instance of this Windows user. Browser connections are only possible to that instance.

Technical detail: " + ex.Message);
                    if (logger != null) logger.WriteLine("KeePassFerry startup failed: " + ex);
                    Hibp.Dispose();
                    Hibp = null;
                    _BackgroundWorkerAutoResetEvent.Set(); // terminate _BackgroundWorker
                    return false;
                }

                EnsureHostRegistration();
                // Selbstheilend: fehlt die Registrierung später (z. B. durch ein Aufräumprogramm), trägt das Plugin sie
                // beim Öffnen einer Datenbank und alle 15 Minuten wieder ein; geschrieben wird nur bei Abweichungen
                _registrationTimer = new System.Windows.Forms.Timer { Interval = 15 * 60 * 1000 };
                _registrationTimer.Tick += delegate { EnsureHostRegistration(); };
                _registrationTimer.Start();
                if (logger != null) logger.WriteLine("RPC server started.");

                // Reste geöffneter Anhang-Kopien (z. B. nach einem Absturz)
                FerryTempFiles.CleanUp();

                // register to recieve events that we need to deal with

                _host.MainWindow.FileOpened += OnKPDBOpen;
                _host.MainWindow.FileClosed += OnKPDBClose;
                _host.MainWindow.FileCreated += OnKPDBCreated;
                _host.MainWindow.FileSaving += OnKPDBSaving;
                _host.MainWindow.FileSaved += OnKPDBSaved;

                _host.MainWindow.DocumentManager.ActiveDocumentSelected += OnKPDBSelected;

                GwmWindowAddedHandler = GlobalWindowManager_WindowAdded;
                GlobalWindowManager.WindowAdded += GwmWindowAddedHandler;
            }
            catch (Exception ex)
            {
                if (logger != null) logger.WriteLine("KeePassFerry startup failed: " + ex);
                _BackgroundWorkerAutoResetEvent.Set(); // terminate _BackgroundWorker
                return false;
            }
            if (logger != null) logger.WriteLine("KeePassFerry startup succeeded.");
            ShowUpdateResultSoon();
            return true; // Initialization successful
        }

        private System.Windows.Forms.Timer _registrationTimer;

        // Passwortprüfung bei "Have I Been Pwned" (nur wenn eingeschaltet)
        internal HibpChecker Hibp { get; private set; }

        private void EnsureHostRegistration()
        {
            try
            {
                NativeHostRegistration.AllowDevExtension =
                    _host.CustomConfig.GetBool(NativeHostRegistration.AllowDevExtensionConfigKey, false);
                string registrationError = NativeHostRegistration.Register();
                if (registrationError != null && logger != null)
                    logger.WriteLine("Native messaging host not registered: " + registrationError);
            }
            catch (Exception ex)
            {
                if (logger != null) logger.WriteLine("Native messaging host registration failed: " + ex);
            }
        }

        // Nach einem Update aus KeePass (FerryUpdater): einmalig melden, ob die neue Version läuft
        private void ShowUpdateResultSoon()
        {
            string from = _host.CustomConfig.GetString(FerryUpdater.UpdatedFromConfigKey, "");
            if (string.IsNullOrEmpty(from)) return;
            _host.CustomConfig.SetString(FerryUpdater.UpdatedFromConfigKey, null);
            SaveConfigSoon();
            string now = FerryUpdater.InstalledVersion;
            bool ok = from != now;
            string releaseUrl = "https://github.com/KeePassFerry/KeePassFerry/releases/tag/v" + now;

            // Windows-Benachrichtigung über das Symbol im Infobereich: blockiert nichts, auch nicht bei gesperrter
            // Datenbank (KeePass startet oft minimiert, entsperrt wird erst auf Anfrage des Browsers). Klick: Änderungen
            var timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += delegate
            {
                NotifyIcon icon = _host.MainWindow.MainNotifyIcon;
                if (icon != null && icon.Visible)
                {
                    timer.Stop();
                    timer.Dispose();
                    EventHandler clicked = null;
                    clicked = delegate
                    {
                        icon.BalloonTipClicked -= clicked;
                        WinUtil.OpenUrl(ok ? releaseUrl : FerryUpdater.ReleasesPage, null);
                    };
                    icon.BalloonTipClicked += clicked;
                    icon.ShowBalloonTip(15000, "KeePassFerry", ok
                        ? FerryText.T("Erfolgreich aktualisiert: Version " + from + " → " + now + ". Klicken Sie hier für die Änderungen.",
                            "Updated successfully: version " + from + " → " + now + ". Click here for the changes.")
                        : FerryText.T("Das Update wurde nicht abgeschlossen; installiert ist weiterhin Version " + now + ". Klicken Sie hier für das Setup.",
                            "The update was not completed; version " + now + " is still installed. Click here for the setup."),
                        ok ? ToolTipIcon.Info : ToolTipIcon.Warning);
                    return;
                }
                // Ohne Symbol im Infobereich: Dialog, aber erst wenn kein KeePass-Dialog offen und die Datenbank
                // entsperrt ist (sonst kämpft er mit der Entsperr-Abfrage um den Vordergrund)
                if (GlobalWindowManager.WindowCount > 0 ||
                    !_host.MainWindow.IsAtLeastOneFileOpen() || _host.MainWindow.IsFileLocked(null))
                    return;
                timer.Stop();
                timer.Dispose();
                if (ok)
                {
                    if (MessageService.AskYesNo(
                        FerryText.T("KeePassFerry wurde erfolgreich aktualisiert: Version " + from + " → " + now + ".\n\nÄnderungen dieser Version ansehen?",
                            "KeePassFerry was updated successfully: version " + from + " → " + now + ".\n\nView the changes in this version?"),
                        "KeePassFerry", false, MessageBoxIcon.Information))
                        WinUtil.OpenUrl(releaseUrl, null);
                }
                else
                {
                    MessageService.ShowWarning(FerryText.T(
                        "Das Update von KeePassFerry wurde nicht abgeschlossen; installiert ist weiterhin Version " + now + ".\n\nBitte versuchen Sie es erneut über \"KeePassFerry → Nach Updates suchen\" oder laden Sie das Setup von GitHub.",
                        "The KeePassFerry update was not completed; version " + now + " is still installed.\n\nPlease try again via \"KeePassFerry → Check for updates\" or download the setup from GitHub."));
                }
            };
            timer.Start();
        }

        private string GetLocalConfigLocation()
        {
            string strBaseDirName = PwDefs.ShortProductName;
            if (!string.IsNullOrEmpty(AppConfigSerializer.BaseName))
                strBaseDirName = AppConfigSerializer.BaseName;

            string strUserDir;
            try
            {
                strUserDir = Environment.GetFolderPath(
                    Environment.SpecialFolder.ApplicationData);
            }
            catch (Exception)
            {
                strUserDir = UrlUtil.GetFileDirectory(UrlUtil.FileUrlToPath(
                    Assembly.GetExecutingAssembly().GetName().CodeBase), true, false);
            }
            strUserDir = UrlUtil.EnsureTerminatingSeparator(strUserDir, false);

            return strUserDir + strBaseDirName + Path.DirectorySeparatorChar;
        }

        private void GlobalWindowManager_WindowAdded(object sender, GwmWindowEventArgs e)
        {
            var ef = e.Form as PwEntryForm;
            if (ef != null)
            {
                ef.Shown += editEntryFormShown;
                return;
            }

            var gf = e.Form as GroupForm;
            if (gf != null)
            {
                gf.Shown += editGroupFormShown;
                return;
            }

            var dsf = e.Form as DatabaseSettingsForm;
            if (dsf != null)
            {
                dsf.Shown += databaseSettingsFormShown;
            }
        }

        private void databaseSettingsFormShown(object sender, EventArgs e)
        {
            TabControl mainTabControl = null;
            var dsf = sender as DatabaseSettingsForm;

            //This might not work, but might as well use the feature if possible.
            try
            {
                Control[] cs = dsf.Controls.Find("m_tabMain", true);
                if (cs.Length == 0)
                    return;
                mainTabControl = cs[0] as TabControl;
            }
            catch
            {
                // that's life, just move on.
                return;
            }

            if (mainTabControl == null) return;

            var dbSettingsUserControl = new DatabaseSettingsUserControl(_host.MainWindow.ActiveDatabase);

            TabPage keeTabPage = new TabPage("KeePassFerry");
            dbSettingsUserControl.Dock = DockStyle.Fill;
            keeTabPage.Controls.Add(dbSettingsUserControl);
            if (mainTabControl.ImageList == null)
                mainTabControl.ImageList = new ImageList();
            int imageIndex = mainTabControl.ImageList.Images.Add(Resources.FerryIcon64, Color.Transparent);
            keeTabPage.ImageIndex = imageIndex;
            mainTabControl.TabPages.Add(keeTabPage);
        }

        private void editGroupFormShown(object sender, EventArgs e)
        {
            GroupForm form = sender as GroupForm;
            PwGroup group = null;
            TabControl mainTabControl = null;
            //This might not work, especially in .NET 2.0 RTM, a shame but more
            //up to date users might as well use the feature if possible.
            try
            {
                FieldInfo fi = typeof(GroupForm).GetField("m_pwGroup", BindingFlags.NonPublic | BindingFlags.Instance);
                group = (PwGroup)fi.GetValue(form);

                Control[] cs = form.Controls.Find("m_tabMain", true);
                if (cs.Length == 0)
                    return;
                mainTabControl = cs[0] as TabControl;
            }
            catch
            {
                // that's life, just move on.
                return;
            }

            if (group == null)
                return;

            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AttachToGroupDialog(this, group, mainTabControl);
            }
        }

        private void editEntryFormShown(object sender, EventArgs e)
        {
            PwEntryForm form = sender as PwEntryForm;
            PwEntry entry = null;
            TabControl mainTabControl = null;
            CustomListViewEx advancedListView = null;
            ProtectedStringDictionary strings = null;
            StringDictionaryEx customData = null;

            //This might not work, but might as well use the feature if possible.
            try
            {
                entry = form.EntryRef;
                strings = form.EntryStrings;
                FieldInfo fi = typeof(PwEntryForm).GetField("m_sdCustomData", BindingFlags.NonPublic | BindingFlags.Instance);
                customData = (StringDictionaryEx)fi.GetValue(form);

                Control[] cs = form.Controls.Find("m_tabMain", true);
                if (cs.Length == 0)
                    return;
                mainTabControl = cs[0] as TabControl;

                //TODO: After migration to config v2 we won't need to rely on this form item being available for our tab to work correctly.
                Control[] cs2 = form.Controls.Find("m_lvStrings", true);
                if (cs2.Length == 0)
                    return;
                advancedListView = cs2[0] as CustomListViewEx;
            }
            catch
            {
                // that's life, just move on.
                return;
            }

            if (entry == null)
                return;

            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AttachToEntryDialog(this, entry, mainTabControl, form, advancedListView, strings, customData);
            }
        }

        private void OnToolsOptions(object sender, EventArgs e)
        {
            ShowOptions(false);
        }

        private OptionsForm _optionsForm;

        // fromBrowser: KeePass-Fenster zuerst nach vorne holen (sonst öffnet sich der Dialog hinter dem Browser)
        internal void ShowOptions(bool fromBrowser)
        {
            if (_optionsForm != null)
            {
                _optionsForm.Activate();
                return;
            }
            // Auch aus dem Infobereich bzw. minimiert: KeePass zeigt und aktiviert sein Hauptfenster
            if (fromBrowser) _host.MainWindow.EnsureVisibleForegroundWindow(true, true);
            using (_optionsForm = new OptionsForm(_host, this))
                _optionsForm.ShowDialog(_host.MainWindow);
            _optionsForm = null;
        }

        private string[] getStandardIconsBase64(ImageList il)
        {
            string[] icons = new string[il.Images.Count];

            for (int i = 0; i < il.Images.Count; i++)
            {
                Image image = il.Images[i];
                using (MemoryStream ms = new MemoryStream())
                {
                    image.Save(ms, ImageFormat.Png);
                    icons[i] = Convert.ToBase64String(ms.ToArray());
                }
            }
            return icons;
        }

        public delegate object GetIconDelegate(int iconIndex);


        public Image GetIcon(int iconIndex)
        {
            Image im = _host.MainWindow.ClientIcons.Images[iconIndex];
            // can't do this until we drop support for KP <2.28: if (DpiUtil.ScalingRequired)
            im = DpiFix.ScaleImageTo16x16(im, false);
            return im;
        }


        public delegate object GetCustomIconDelegate(PwUuid uuid);


        public Image GetCustomIcon(PwUuid uuid)
        {
            return _host.Database.GetCustomIcon(uuid);
        }

        private void EnsureDBIconIsInIconCache()
        {
            string cachedBase64 = IconCache<string>
                .GetIconEncoding(_host.Database.IOConnectionInfo.Path);
            if (string.IsNullOrEmpty(cachedBase64))
            {
                // the icon wasn't in the cache so lets calculate its base64 encoding and then add it to the cache
                using (MemoryStream ms = new MemoryStream())
                using (Image originalImage = _host.MainWindow.Icon.ToBitmap())
                using (Image imgNew = new Bitmap(originalImage, new Size(16, 16)))
                {
                    imgNew.Save(ms, ImageFormat.Png);
                    string imageData = Convert.ToBase64String(ms.ToArray());
                    IconCache<string>
                        .AddIcon(_host.Database.IOConnectionInfo.Path, imageData);
                }
            }
        }

        private void CreateClientManagers()
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers.Add("general", new GeneralRPCClientManager());
            }
        }

        public override ToolStripMenuItem GetMenuItem(PluginMenuType t)
        {
            // Provide a menu item for the main location(s)
            if (t == PluginMenuType.Main)
            {
                ToolStripMenuItem tsmi = new ToolStripMenuItem("KeePassFerry");
                tsmi.Image = Resources.FerryIcon64;
                ToolStripMenuItem options = new ToolStripMenuItem(FerryText.T("Optionen …", "Options …"));
                options.Click += OnToolsOptions;
                ToolStripMenuItem update = new ToolStripMenuItem(FerryText.T("Nach Updates suchen …", "Check for updates …"));
                update.Click += OnCheckForUpdates;
                tsmi.DropDownItems.Add(options);
                tsmi.DropDownItems.Add(update);
                return tsmi;
            }

            return null;
        }

        // Menü "Nach Updates suchen": neueste Version zeigen und auf Wunsch per Setup aktualisieren
        internal void OnCheckForUpdates(object sender, EventArgs e)
        {
            string latest = FerryUpdater.LatestVersion();
            string installed = FerryUpdater.InstalledVersion;
            if (latest == null)
            {
                MessageBox.Show(FerryText.T("Die neueste Version konnte nicht abgerufen werden. Bitte prüfe die Internetverbindung.",
                    "Could not retrieve the latest version. Please check your internet connection."), "KeePassFerry",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!FerryUpdater.IsNewer(latest, installed))
            {
                MessageBox.Show(FerryText.T("KeePassFerry " + installed + " ist aktuell.", "KeePassFerry " + installed + " is up to date."),
                    "KeePassFerry", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (MessageBox.Show(FerryText.T(
                    "KeePassFerry " + latest + " ist verfügbar (installiert: " + installed + ").\r\n\r\nJetzt aktualisieren? KeePass wird dafür kurz beendet und danach wieder gestartet. Speichere vorher offene Änderungen.",
                    "KeePassFerry " + latest + " is available (installed: " + installed + ").\r\n\r\nUpdate now? KeePass will close briefly and restart. Save open changes first."),
                    "KeePassFerry", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            FerryUpdater.ReportResult(FerryUpdater.Run(false));
        }

        /// <summary>
        /// Free resources
        /// </summary>
        public override void Terminate()
        {
            terminating = true;
            if (_registrationTimer != null) _registrationTimer.Dispose();
            if (Hibp != null) Hibp.Dispose();
            FerryTempFiles.CleanUp();
            if (_RPCServer != null)
                _RPCServer.Stop();
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                    manager.Terminate();
                _RPCClientManagers.Clear();
            }

            // remove event listeners
            _host.MainWindow.FileOpened -= OnKPDBOpen;
            _host.MainWindow.FileClosed -= OnKPDBClose;
            _host.MainWindow.FileCreated -= OnKPDBCreated;
            _host.MainWindow.FileSaving -= OnKPDBSaving;
            _host.MainWindow.FileSaved -= OnKPDBSaved;
            _host.MainWindow.DocumentManager.ActiveDocumentSelected -= OnKPDBSelected;

            GlobalWindowManager.WindowAdded -= GwmWindowAddedHandler;

            // terminate _BackgroundWorker
            _BackgroundWorkerAutoResetEvent.Set();

            if (logger != null)
                logger.Close();
        }

        private void OnKPDBSelected(object sender, EventArgs e)
        {
            SignalAllManagedRPCClients(Signal.DATABASE_SELECTED);
        }

        private void OnKPDBCreated(object sender, FileCreatedEventArgs e)
        {
            // Keine Standard-Einstellungen in die neue Datenbank schreiben: ohne eigene gilt ohnehin der Standard
            EnsureDBIconIsInIconCache();
            //FerryService.ensureDBisOpenEWH.Set(); // signal that DB is now open so any waiting JSONRPC thread can go ahead
            SignalAllManagedRPCClients(Signal.DATABASE_OPEN);
        }

        private delegate void dlgSaveDB(PwDatabase databaseToSave);

        private void saveDB(PwDatabase databaseToSave)
        {
            // save active database & update UI appearance
            if (_host.MainWindow.UIFileSave(true))
                _host.MainWindow.UpdateUI(false, null, true, null, true, null, false);

        }

        private void OnKPDBOpen(object sender, FileOpenedEventArgs e)
        {
            EnsureDBIconIsInIconCache();
            EnsureHostRegistration();

            // Einmalig: Einstellungen aus Kee/KeePassRPC übernehmen; danach speichern, wenn sonst nichts offen war
            PwDatabase openedDb = e.Database;
            bool wasModified = openedDb.Modified;
            string importSummary;
            if (Extensions.ImportKeeSettingsOnce(openedDb, out importSummary))
            {
                if (RPCService != null) RPCService.FerryDiagLog(new[] { "plugin kee-import " + importSummary });
                if (!wasModified)
                    _host.MainWindow.BeginInvoke(new MethodInvoker(delegate
                    {
                        if (openedDb.IsOpen && !openedDb.Modified) openedDb.Modified = true;
                        if (openedDb.IsOpen) _host.MainWindow.SaveDatabase(openedDb, null);
                    }));
            }

            SignalAllManagedRPCClients(Signal.DATABASE_OPEN);
        }


        private void OnKPDBClose(object sender, FileClosedEventArgs e)
        {
            // Auch beim Sperren: geöffnete Anhang-Kopien entfernen
            FerryTempFiles.CleanUp();
            SignalAllManagedRPCClients(Signal.DATABASE_CLOSED);
        }

        private void OnKPDBSaving(object sender, FileSavingEventArgs e)
        {
            SignalAllManagedRPCClients(Signal.DATABASE_SAVING);
        }

        private void OnKPDBSaved(object sender, FileSavedEventArgs e)
        {
            EnsureDBIconIsInIconCache();
            SignalAllManagedRPCClients(Signal.DATABASE_SAVED);
        }

        internal void SignalAllManagedRPCClients(Signal signal)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                    manager.SignalAll(signal);
            }
        }

        internal void AddRPCClientConnection(FerryClientConnection keePassRPCClient)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AddRPCClientConnection(keePassRPCClient);
            }
        }

        internal void RemoveRPCClientConnection(FerryClientConnection keePassRPCClient)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                // this generally only happens at connection shutdown time so think we get away with a search like this
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                    foreach (FerryClientConnection connection in manager.CurrentRPCClientConnections)
                        if (connection == keePassRPCClient)
                            manager.RemoveRPCClientConnection(keePassRPCClient);
            }
        }

        internal void AddRPCClientConnection(IClientTransport transport)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AddRPCClientConnection(new FerryClientConnection(transport));
            }
        }

        internal void RemoveRPCClientConnection(IClientTransport transport)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                // this generally only happens at conenction shutdown time so think we get away with a search like this
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                    foreach (FerryClientConnection connection in manager.CurrentRPCClientConnections)
                        if (connection.Transport == transport)
                        {
                            manager.RemoveRPCClientConnection(connection);
                            return;
                        }
            }
        }

        internal void MessageRPCClientConnection(IClientTransport transport, string message, FerryService service)
        {
            FerryClientConnection connection = null;

            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                {
                    foreach (FerryClientConnection conn in manager.CurrentRPCClientConnections)
                    {
                        if (conn.Transport == transport)
                        {
                            connection = conn;
                            break;
                        }
                    }
                    if (connection != null)
                        break;
                }
            }

            if (connection != null)
                connection.ReceiveMessage(message, service);
            else
                transport.Close();
        }

        internal List<FerryClientConnection> GetConnectedRPCClients()
        {
            List<FerryClientConnection> clients = new List<FerryClientConnection>();
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (FerryClientManager manager in _RPCClientManagers.Values)
                    foreach (FerryClientConnection connection in manager.CurrentRPCClientConnections)
                        if (connection.Authorised)
                            clients.Add(connection);
            }
            return clients;
        }

        public string GetPwEntryString(PwEntry pwe, string name, PwDatabase db)
        {
            return pwe.Strings.ReadSafe(name);
        }

        public string GetPwEntryStringFromDereferencableValue(PwEntry pwe, string name, PwDatabase db)
        {
            return SprEngine.Compile(name, new SprContext(pwe, db, SprCompileFlags.All & ~SprCompileFlags.Run, false, false));
        }

        internal void SaveConfigSoon()
        {
            try
            {
                _host.MainWindow.BeginInvoke((MethodInvoker)delegate { _host.MainWindow.SaveConfig(); });
            }
            catch (Exception)
            {
            }
        }

        /// <summary>
        /// Fragt im KeePass-Fenster, ob ein neuer Browser gekoppelt werden soll (Prüfcode vergleichen).
        /// Läuft auf dem UI-Thread; der aufrufende Pipe-Thread wartet auf die Entscheidung.
        /// </summary>
        internal bool ConfirmFerryPairing(string clientName, string code)
        {
            bool accepted = false;
            try
            {
                _host.MainWindow.Invoke((MethodInvoker)delegate
                {
                    using (var form = new Forms.FerryPairingForm(clientName, code))
                        accepted = form.ShowDialog(_host.MainWindow) == DialogResult.OK;
                });
            }
            catch (Exception ex)
            {
                if (logger != null) logger.WriteLine("Pairing dialog failed: " + ex.Message);
                return false;
            }
            if (accepted) SaveConfigSoon();
            return accepted;
        }

        public void InvokeMainThread(Delegate method, params object[] args)
        {
            _BackgroundWorker.ReportProgress(0, (MethodInvoker)delegate
            {
                method.DynamicInvoke(args);
            });
        }

        private void _BackgroundWorker_ProgressChanged(object sender, ProgressChangedEventArgs e)
        {
            ((MethodInvoker)e.UserState).Invoke();
        }
    }

    public class LockManager
    {
        public int HeldBy;
    }

}