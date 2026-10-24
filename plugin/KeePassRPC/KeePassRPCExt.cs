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
using DomainPublicSuffix;
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
        private KeePassRPCService _RPCService;

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
        public KeePassRPCService RPCService
        {
            get { return _RPCService; }
        }

        internal IPluginHost _host;

        private EventHandler<GwmWindowEventArgs> GwmWindowAddedHandler;

        private static LockManager _lockRPCClientManagers = new LockManager();
        private Dictionary<string, KeePassRPCClientManager> _RPCClientManagers = new Dictionary<string, KeePassRPCClientManager>(3);
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

                TLDRulesCache.Init(host.CustomConfig.GetString(
                    "KeePassFerry.PublicSuffixDomainCachePath",
                    GetLocalConfigLocation() + "publicSuffixDomainCache.txt"));

                // The client managers hold the connections of native messaging hosts
                CreateClientManagers();

                if (logger != null) logger.WriteLine("Client managers started.");
                //TODO2: set up language services

                _RPCService = new KeePassRPCService(host,
                    getStandardIconsBase64(host.MainWindow.ClientIcons), this);
                if (logger != null) logger.WriteLine("RPC service started.");
                FerryIdentity = new FerryIdentity(host);
                SaveConfigSoon();

                try
                {
                    _RPCServer = new NativePipeServer(RPCService, this);
                }
                catch (InvalidOperationException ex)
                {
                    Utils.ShowMonoSafeMessageBox(@"KeePassFerry is already active in another KeePass instance of this Windows user. Browser connections are only possible to that instance.

Technical detail: " + ex.Message);
                    if (logger != null) logger.WriteLine("KPRPC startup failed: " + ex);
                    _BackgroundWorkerAutoResetEvent.Set(); // terminate _BackgroundWorker
                    return false;
                }

                try
                {
                    string registrationError = NativeHostRegistration.Register();
                    if (registrationError != null && logger != null)
                        logger.WriteLine("Native messaging host not registered: " + registrationError);
                }
                catch (Exception ex)
                {
                    if (logger != null) logger.WriteLine("Native messaging host registration failed: " + ex);
                }
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
                if (logger != null) logger.WriteLine("KPRPC startup failed: " + ex);
                _BackgroundWorkerAutoResetEvent.Set(); // terminate _BackgroundWorker
                return false;
            }
            if (logger != null) logger.WriteLine("KPRPC startup succeeded.");
            return true; // Initialization successful
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
            using (OptionsForm ofDlg = new OptionsForm(_host, this))
                ofDlg.ShowDialog();
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

        private void EnsureDBIconIsInKPRPCIconCache()
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

        private static string BackupGroupName
        {
            get { return FerryText.T("KeePassFerry – generierte Passwörter", "KeePassFerry – generated passwords"); }
        }

        internal PwGroup GetAndInstallKeePasswordBackupGroup(PwDatabase pd)
        {
            PwUuid groupUuid = new PwUuid(new byte[] {
                0xea, 0x9f, 0xf2, 0xed, 0x05, 0x12, 0x47, 0x47,
                0xb6, 0x3e, 0xaf, 0xa5, 0x15, 0xa3, 0x04, 0x30});

            var keeGroup = GetKeeGroup(pd);

            PwGroup kfpbg = pd.RootGroup.FindGroup(groupUuid, true);
            if (kfpbg == null)
            {
                kfpbg = new PwGroup(false, true, BackupGroupName, PwIcon.Folder);
                kfpbg.Uuid = groupUuid;
                kfpbg.CustomIconUuid = GetFerryIcon();
                keeGroup.AddGroup(kfpbg, true);
            }
            else if (kfpbg.Name == "KeeFox Generated Password Backups" || kfpbg.Name == "Kee Generated Password Backups")
            {
                kfpbg.Name = BackupGroupName;
                kfpbg.CustomIconUuid = GetFerryIcon();
            }
            return kfpbg;
        }

        /// <summary>
        /// Gets the kee group and renames it from KeeFox if necessary.
        /// </summary>
        /// <param name="pd">The database</param>
        /// <returns>The Kee group or the root group if the group does not exist</returns>
        internal PwGroup GetKeeGroup(PwDatabase pd)
        {
            PwUuid groupUuid = new PwUuid(new byte[] {
                0xea, 0x9f, 0xf2, 0xed, 0x05, 0x12, 0x47, 0x47,
                0xb6, 0x3e, 0xaf, 0xa5, 0x15, 0xa3, 0x04, 0x23});

            PwGroup kfpg = pd.RootGroup.FindGroup(groupUuid, true);
            if (kfpg == null)
            {
                return pd.RootGroup;
            }

            return kfpg;
        }

        private PwUuid GetFerryIcon()
        {
            // KeePassFerry-Symbol (eigene UUID; das Kee-Symbol {EB9FF2ED-0512-4747-B83E-AFA515A30422} bleibt in alten Datenbanken)
            PwUuid kprpcIconUuid = new PwUuid(new byte[] {
                0xa5, 0x14, 0xd6, 0x3f, 0x69, 0x4b, 0xcb, 0x47,
                0x84, 0x98, 0xdf, 0x80, 0x88, 0xcc, 0xb3, 0xcc});

            PwCustomIcon icon = null;

            foreach (PwCustomIcon testIcon in _host.Database.CustomIcons)
            {
                if (testIcon.Uuid.Equals(kprpcIconUuid))
                {
                    icon = testIcon;
                    break;
                }
            }

            if (icon == null)
            {
                using (MemoryStream ms = new MemoryStream())
                {
                    Resources.FerryIcon64.Save(ms, ImageFormat.Png);

                    // Create a new custom icon for use with this entry
                    icon = new PwCustomIcon(kprpcIconUuid,
                        ms.ToArray());
                    _host.Database.CustomIcons.Add(icon);
                }
            }
            return kprpcIconUuid;
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
            FerryTempFiles.CleanUp();
            if (_RPCServer != null)
                _RPCServer.Stop();
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
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
            var conf = e.Database.GetKPRPCConfig();
            e.Database.SetKPRPCConfig(conf);
            EnsureDBIconIsInKPRPCIconCache();
            //KeePassRPCService.ensureDBisOpenEWH.Set(); // signal that DB is now open so any waiting JSONRPC thread can go ahead
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
            EnsureDBIconIsInKPRPCIconCache();

            if (GetConfigVersionForLegacyMigration(e.Database) > 0)
            {
                // Version 0 could indicate this DB contains KeeFox data
                // from many years ago, no config data or post 2016 config data. It's 
                // usefulness has therefore expired and we delete it to keep the kdbx
                // file contents tidy
                e.Database.CustomData.Remove("KeePassRPC.KeeFox.configVersion");
            }

            // Database config versions < 3 will be lazily updated when a v2 config
            // is first accessed and the DB next saved. This only affects the RootUUID though.

            SignalAllManagedRPCClients(Signal.DATABASE_OPEN);
        }


        private int GetConfigVersionForLegacyMigration(PwDatabase db)
        {
            if (db.CustomData.Exists("KeePassRPC.KeeFox.configVersion"))
            {
                int configVersion = 0;
                string configVersionString = db.CustomData.Get("KeePassRPC.KeeFox.configVersion");
                if (int.TryParse(configVersionString, out configVersion))
                    return configVersion;
            }
            return 0;
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
            EnsureDBIconIsInKPRPCIconCache();
            SignalAllManagedRPCClients(Signal.DATABASE_SAVED);
        }

        internal void SignalAllManagedRPCClients(Signal signal)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
                    manager.SignalAll(signal);
            }
        }

        internal void AddRPCClientConnection(KeePassRPCClientConnection keePassRPCClient)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AddRPCClientConnection(keePassRPCClient);
            }
        }

        internal void RemoveRPCClientConnection(KeePassRPCClientConnection keePassRPCClient)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                // this generally only happens at connection shutdown time so think we get away with a search like this
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
                    foreach (KeePassRPCClientConnection connection in manager.CurrentRPCClientConnections)
                        if (connection == keePassRPCClient)
                            manager.RemoveRPCClientConnection(keePassRPCClient);
            }
        }

        internal void AddRPCClientConnection(IClientTransport transport)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                _RPCClientManagers["general"].AddRPCClientConnection(new KeePassRPCClientConnection(transport));
            }
        }

        internal void RemoveRPCClientConnection(IClientTransport transport)
        {
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                // this generally only happens at conenction shutdown time so think we get away with a search like this
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
                    foreach (KeePassRPCClientConnection connection in manager.CurrentRPCClientConnections)
                        if (connection.Transport == transport)
                        {
                            manager.RemoveRPCClientConnection(connection);
                            return;
                        }
            }
        }

        internal void MessageRPCClientConnection(IClientTransport transport, string message, KeePassRPCService service)
        {
            KeePassRPCClientConnection connection = null;

            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
                {
                    foreach (KeePassRPCClientConnection conn in manager.CurrentRPCClientConnections)
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

        internal List<KeePassRPCClientConnection> GetConnectedRPCClients()
        {
            List<KeePassRPCClientConnection> clients = new List<KeePassRPCClientConnection>();
            lock (_lockRPCClientManagers)
            {
                _lockRPCClientManagers.HeldBy = Thread.CurrentThread.ManagedThreadId;
                foreach (KeePassRPCClientManager manager in _RPCClientManagers.Values)
                    foreach (KeePassRPCClientConnection connection in manager.CurrentRPCClientConnections)
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