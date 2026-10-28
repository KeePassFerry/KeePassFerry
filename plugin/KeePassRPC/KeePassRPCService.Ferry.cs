using System;
using Jayrock.JsonRpc;
using KeePassLib;
using KeePassLib.Security;
using KeePassLib.Utility;

namespace KeePassFerry
{
    /// <summary>
    /// Zusätzliche RPC-Methoden von KeePassFerry (OTP, später Passkeys und Anhänge)
    /// </summary>
    public partial class KeePassRPCService
    {
        /// <summary>
        /// Aktueller TOTP-Code eines Eintrags; null, wenn der Eintrag kein TOTP hat.
        /// Das Secret verlässt KeePass nicht.
        /// </summary>
        [JsonRpcMethod]
        public TotpResult GetTotp(string uuid, string dbFileName)
        {
            if (!EnsureDBisOpen()) return null;
            if (string.IsNullOrEmpty(uuid)) return null;

            PwDatabase db = SelectDatabase(dbFileName);
            if (db == null) return null;

            PwEntry entry = GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (entry == null || !Totp.HasTotp(entry)) return null;

            return Totp.Compute(entry, db, DateTime.UtcNow);
        }

        /// <summary>
        /// Schreibt eine otpauth-URI (KeePassXC-Format) in das Feld "otp" eines bestehenden Eintrags.
        /// Vorher wandert der alte Stand in die Eintragshistorie. Ein vorhandenes TOTP wird nur mit overwrite ersetzt.
        /// Ergebnis: status "ok" (mit erstem Code), "exists", "invalid" oder "notfound".
        /// </summary>
        [JsonRpcMethod]
        public SetTotpResult SetTotp(string uuid, string dbFileName, string otpauthUri, bool overwrite)
        {
            if (!EnsureDBisOpen()) return null;

            string uri = (otpauthUri ?? "").Trim();
            if (!uri.StartsWith("otpauth://totp/", StringComparison.OrdinalIgnoreCase)
                || Totp.ComputeFromUri(uri, DateTime.UtcNow) == null)
                return new SetTotpResult { status = "invalid" };

            PwDatabase db = SelectDatabase(dbFileName);
            PwEntry entry = (db == null || string.IsNullOrEmpty(uuid))
                ? null
                : GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (entry == null)
                return new SetTotpResult { status = "notfound" };

            if (Totp.HasTotp(entry) && !overwrite)
                return new SetTotpResult { status = "exists" };

            entry.CreateBackup(db);
            entry.Strings.Set(Totp.OtpField, new ProtectedString(true, uri));
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);

            TotpResult first = Totp.Compute(entry, db, DateTime.UtcNow);
            return new SetTotpResult
            {
                status = "ok",
                code = first != null ? first.code : null,
                remainingSeconds = first != null ? first.remainingSeconds : 0
            };
        }
    }

    public partial class KeePassRPCService
    {
        /// <summary>
        /// Plugin per Setup aktualisieren (Knopf "Jetzt aktualisieren" in der Erweiterung). Prüft nur kurz, ob es eine
        /// neuere Version gibt, und antwortet sofort. Download, Signaturprüfung und Setup-Start laufen danach in KeePass
        /// (UI-Thread, wie "Nach Updates suchen"), damit dieser Kanal nicht blockiert; Fehler meldet KeePass selbst.
        /// Ergebnis: "started", "uptodate" oder "download_failed".
        /// </summary>
        [JsonRpcMethod]
        public string StartPluginUpdate()
        {
            FerryUpdater.Log("anfrage aus dem browser");
            string latest = FerryUpdater.LatestVersion();
            if (latest == null) return "download_failed";
            if (!FerryUpdater.IsNewer(latest, FerryUpdater.InstalledVersion)) return "uptodate";
            _host.MainWindow.BeginInvoke(new System.Windows.Forms.MethodInvoker(FerryUpdater.RunFromBrowser));
            return "started";
        }
    }

    public partial class KeePassRPCService
    {
        private const int MaxEntryTextLength = 64 * 1024;

        /// <summary>
        /// Legt ein Textfeld im Eintrag an (z. B. Wiederherstellungscode) oder hängt den Text an die Notizen an.
        /// Vorhandene Felder werden nicht überschrieben: ein belegter Name bekommt eine Nummer ("Name (2)").
        /// Vorher wandert der alte Stand in die Eintragshistorie. Gibt den Feldnamen zurück ("Notes" bei Notizen) oder null.
        /// </summary>
        [JsonRpcMethod]
        public string AddEntryText(string uuid, string dbFileName, string fieldName, string value, bool protect, bool toNotes)
        {
            if (!EnsureDBisOpen()) return null;
            if (string.IsNullOrEmpty(uuid) || string.IsNullOrEmpty(value) || value.Length > MaxEntryTextLength) return null;

            PwDatabase db = SelectDatabase(dbFileName);
            if (db == null) return null;
            PwEntry entry = GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (entry == null) return null;

            string name;
            ProtectedString text;
            if (toNotes)
            {
                name = PwDefs.NotesField;
                string notes = entry.Strings.ReadSafe(PwDefs.NotesField);
                string label = string.IsNullOrWhiteSpace(fieldName) ? "" : fieldName.Trim() + ": ";
                string added = label + value.Trim();
                text = new ProtectedString(db.MemoryProtection.ProtectNotes,
                    notes.Length > 0 ? notes.TrimEnd() + Environment.NewLine + Environment.NewLine + added : added);
            }
            else
            {
                name = UniqueStringName(entry, SafeFieldName(fieldName));
                if (name == null) return null;
                text = new ProtectedString(protect, value.Trim());
            }

            entry.CreateBackup(db);
            entry.Strings.Set(name, text);
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return name;
        }

        /// <summary>
        /// Eigene Textfelder (ohne Standard- und interne Felder) und Anhänge eines Eintrags, für die Liste
        /// "Im Eintrag gespeichert" im Bearbeiten-Fenster. Werte geschützter Felder werden nicht mitgeschickt.
        /// </summary>
        [JsonRpcMethod]
        public EntryExtras GetEntryExtras(string uuid, string dbFileName)
        {
            if (!EnsureDBisOpen()) return null;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return null;

            var fields = new System.Collections.Generic.List<EntryExtraField>();
            foreach (var kv in entry.Strings)
            {
                if (IsReservedStringName(kv.Key)) continue;
                fields.Add(new EntryExtraField
                {
                    name = kv.Key,
                    isProtected = kv.Value.IsProtected,
                    value = kv.Value.IsProtected ? null : kv.Value.ReadString()
                });
            }
            var attachments = new System.Collections.Generic.List<EntryExtraAttachment>();
            foreach (var kv in entry.Binaries)
                attachments.Add(new EntryExtraAttachment { name = kv.Key, size = (int)kv.Value.Length });
            return new EntryExtras
            {
                fields = fields.ToArray(),
                attachments = attachments.ToArray(),
                notes = entry.Strings.ReadSafe(PwDefs.NotesField)
            };
        }

        /// <summary>Inhalt eines Anhangs (Base64) zum Anzeigen oder Speichern im Browser; null, wenn nicht vorhanden</summary>
        [JsonRpcMethod]
        public string GetEntryAttachment(string uuid, string dbFileName, string name)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name)) return null;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return null;
            var binary = entry.Binaries.Get(name);
            if (binary == null) return null;
            byte[] data = binary.ReadData();
            try
            {
                return Convert.ToBase64String(data);
            }
            finally
            {
                if (binary.IsProtected) MemUtil.ZeroByteArray(data);
            }
        }

        /// <summary>
        /// Öffnet einen Anhang (Bild, PDF, Text) im Standardprogramm von Windows, z. B. Fotos.
        /// Temporäre Kopie und Aufräumen: FerryTempFiles (ohne den Import-Dialog von KeePass).
        /// </summary>
        [JsonRpcMethod]
        public bool OpenEntryAttachmentExternally(string uuid, string dbFileName, string name)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name) || !FerryTempFiles.IsViewable(name)) return false;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return false;
            ProtectedBinary binary = entry.Binaries.Get(name);
            if (binary == null) return false;

            byte[] data = binary.ReadData();
            try
            {
                FerryTempFiles.Open(name, data);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                if (binary.IsProtected) MemUtil.ZeroByteArray(data);
            }
        }

        /// <summary>
        /// Öffnet die Notizen als Textdatei im Standard-Editor (temporäre Kopie wie bei Anhängen, FerryTempFiles).
        /// fileName kommt aus der Erweiterung (übersetzt), die Endung ist immer .txt.
        /// </summary>
        [JsonRpcMethod]
        public bool OpenEntryNotesExternally(string uuid, string dbFileName, string fileName)
        {
            if (!EnsureDBisOpen()) return false;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return false;
            string notes = entry.Strings.ReadSafe(PwDefs.NotesField);
            if (notes.Length == 0) return false;

            // Titel enthalten oft Punkte ("mailferry.de") oder Schrägstriche: nicht als Pfad/Endung deuten
            string name = (fileName ?? "").Replace('/', '-').Replace('\\', '-').Trim();
            if (name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);
            if (name.Length > 100) name = name.Substring(0, 100).Trim();
            if (name.Length == 0) name = "Notes";
            // Mit BOM, damit jeder Editor Umlaute richtig erkennt; Zeilenenden wie unter Windows
            byte[] data = new System.Text.UTF8Encoding(true).GetPreamble();
            byte[] text = System.Text.Encoding.UTF8.GetBytes(notes.Replace("\r\n", "\n").Replace("\n", "\r\n"));
            byte[] all = new byte[data.Length + text.Length];
            Buffer.BlockCopy(data, 0, all, 0, data.Length);
            Buffer.BlockCopy(text, 0, all, data.Length, text.Length);
            try
            {
                FerryTempFiles.Open(name + ".txt", all);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                MemUtil.ZeroByteArray(text);
                MemUtil.ZeroByteArray(all);
            }
        }

        /// <summary>Wert eines eigenen Felds, auch eines geschützten (Auge im Browser); null bei Standard- und internen Feldern</summary>
        [JsonRpcMethod]
        public string GetEntryFieldValue(string uuid, string dbFileName, string name)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name) || IsReservedStringName(name)) return null;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return null;
            var value = entry.Strings.Get(name);
            return value == null ? null : value.ReadString();
        }

        /// <summary>
        /// Ändert den Wert eines vorhandenen eigenen Felds (Schutz bleibt wie er ist) oder ersetzt die Notizen (toNotes).
        /// Vorher wandert der alte Stand in die Eintragshistorie. Standard- und interne Felder bleiben unberührt.
        /// </summary>
        [JsonRpcMethod]
        public bool UpdateEntryText(string uuid, string dbFileName, string name, string value, bool toNotes)
        {
            if (!EnsureDBisOpen() || value == null || value.Length > MaxEntryTextLength) return false;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return false;

            ProtectedString text;
            if (toNotes)
            {
                name = PwDefs.NotesField;
                text = new ProtectedString(db.MemoryProtection.ProtectNotes, value.Trim());
            }
            else
            {
                if (string.IsNullOrEmpty(name) || IsReservedStringName(name) || value.Trim().Length == 0) return false;
                ProtectedString old = entry.Strings.Get(name);
                if (old == null) return false;
                text = new ProtectedString(old.IsProtected, value.Trim());
            }

            entry.CreateBackup(db);
            entry.Strings.Set(name, text);
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return true;
        }

        /// <summary>
        /// Schaltet den Schutz eines vorhandenen eigenen Felds um ("Wert im Speicher schützen" in KeePass).
        /// Vorher wandert der alte Stand in die Eintragshistorie. Standard- und interne Felder bleiben unberührt.
        /// </summary>
        [JsonRpcMethod]
        public bool SetEntryFieldProtection(string uuid, string dbFileName, string name, bool protect)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name) || IsReservedStringName(name)) return false;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return false;
            ProtectedString old = entry.Strings.Get(name);
            if (old == null) return false;
            if (old.IsProtected == protect) return true;

            entry.CreateBackup(db);
            entry.Strings.Set(name, old.WithProtection(protect));
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return true;
        }

        /// <summary>
        /// Entfernt ein eigenes Textfeld (kind "field"), einen Anhang (kind "attachment") oder leert die Notizen (kind "notes").
        /// Vorher wandert der alte Stand in die Eintragshistorie. Standard- und interne Felder bleiben unberührt.
        /// </summary>
        [JsonRpcMethod]
        public bool RemoveEntryExtra(string uuid, string dbFileName, string kind, string name)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name)) return false;
            PwDatabase db;
            PwEntry entry = FindFerryEntry(uuid, dbFileName, out db);
            if (entry == null) return false;

            if (kind == "field")
            {
                if (IsReservedStringName(name) || !entry.Strings.Exists(name)) return false;
                entry.CreateBackup(db);
                entry.Strings.Remove(name);
            }
            else if (kind == "attachment")
            {
                if (entry.Binaries.Get(name) == null) return false;
                entry.CreateBackup(db);
                entry.Binaries.Remove(name);
            }
            else if (kind == "notes")
            {
                if (entry.Strings.ReadSafe(PwDefs.NotesField).Length == 0) return false;
                entry.CreateBackup(db);
                entry.Strings.Set(PwDefs.NotesField, new ProtectedString(db.MemoryProtection.ProtectNotes, ""));
            }
            else return false;

            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return true;
        }

        private PwEntry FindFerryEntry(string uuid, string dbFileName, out PwDatabase db)
        {
            db = SelectDatabase(dbFileName);
            if (db == null || string.IsNullOrEmpty(uuid)) return null;
            return GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
        }

        // Feldname ohne Steuerzeichen, höchstens 64 Zeichen; Standard- und interne Felder sind tabu
        private static string SafeFieldName(string requested)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in (requested ?? "").Trim())
                if (!char.IsControl(c)) sb.Append(c);
            string name = sb.ToString().Trim();
            if (name.Length > 64) name = name.Substring(0, 64).Trim();
            return name.Length == 0 ? "Notiz" : name;
        }

        private static bool IsReservedStringName(string name)
        {
            return PwDefs.IsStandardField(name)
                || name.Equals(Totp.OtpField, StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("TimeOtp-", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("HmacOtp-", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("KPRPC", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("KPEX_", StringComparison.OrdinalIgnoreCase);
        }

        private static string UniqueStringName(PwEntry entry, string name)
        {
            for (int i = 1; i < 100; i++)
            {
                string candidate = i == 1 ? name : name + " (" + i + ")";
                if (!IsReservedStringName(candidate) && !entry.Strings.Exists(candidate)) return candidate;
            }
            return null;
        }
    }

    public partial class KeePassRPCService
    {
        private const int MaxAttachmentBytes = 20 * 1024 * 1024;

        /// <summary>
        /// Hängt ein Bild (PNG, JPEG, GIF, WebP, BMP) als Anhang an einen Eintrag, z. B. einen Screenshot
        /// der Sicherheitsfragen. Vorher wandert der alte Stand in die Eintragshistorie.
        /// Gibt den gespeicherten Dateinamen zurück oder null.
        /// </summary>
        [JsonRpcMethod]
        public string AddImageAttachment(string uuid, string dbFileName, string fileName, string dataBase64)
        {
            if (!EnsureDBisOpen()) return null;
            if (string.IsNullOrEmpty(uuid) || string.IsNullOrEmpty(dataBase64)) return null;

            byte[] data;
            try
            {
                data = Convert.FromBase64String(dataBase64);
            }
            catch (FormatException)
            {
                return null;
            }
            if (data.Length == 0 || data.Length > MaxAttachmentBytes) return null;

            string extension = ImageExtension(data);
            if (extension == null) return null;

            PwDatabase db = SelectDatabase(dbFileName);
            if (db == null) return null;
            PwEntry entry = GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (entry == null) return null;

            string name = UniqueAttachmentName(entry, SafeFileName(fileName, extension));

            entry.CreateBackup(db);
            entry.Binaries.Set(name, new ProtectedBinary(true, data));
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return name;
        }

        // Dateityp anhand der ersten Bytes; null, wenn es kein unterstütztes Bild ist
        private static string ImageExtension(byte[] d)
        {
            if (d.Length >= 8 && d[0] == 0x89 && d[1] == 0x50 && d[2] == 0x4E && d[3] == 0x47) return ".png";
            if (d.Length >= 3 && d[0] == 0xFF && d[1] == 0xD8 && d[2] == 0xFF) return ".jpg";
            if (d.Length >= 6 && d[0] == 0x47 && d[1] == 0x49 && d[2] == 0x46 && d[3] == 0x38) return ".gif";
            if (d.Length >= 12 && d[0] == 0x52 && d[1] == 0x49 && d[2] == 0x46 && d[3] == 0x46
                && d[8] == 0x57 && d[9] == 0x45 && d[10] == 0x42 && d[11] == 0x50) return ".webp";
            if (d.Length >= 2 && d[0] == 0x42 && d[1] == 0x4D) return ".bmp";
            return null;
        }

        // Nur unkritische Zeichen, passende Endung, sonst Screenshot mit Datum und Uhrzeit
        private static string SafeFileName(string requested, string extension)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in (requested ?? "").Trim())
                if (char.IsLetterOrDigit(c) || c == ' ' || c == '-' || c == '_' || c == '.') sb.Append(c);
            string name = sb.ToString().Trim().TrimStart('.');
            if (name.Length > 80) name = name.Substring(0, 80);
            if (name.Length == 0) name = "Screenshot " + DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss");
            if (!name.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            {
                int dot = name.LastIndexOf('.');
                if (dot > 0) name = name.Substring(0, dot);
                name += extension;
            }
            return name;
        }

        private static string UniqueAttachmentName(PwEntry entry, string name)
        {
            if (entry.Binaries.Get(name) == null) return name;
            string stem = System.IO.Path.GetFileNameWithoutExtension(name);
            string ext = System.IO.Path.GetExtension(name);
            for (int i = 2; i < 1000; i++)
            {
                string candidate = stem + " (" + i + ")" + ext;
                if (entry.Binaries.Get(candidate) == null) return candidate;
            }
            return stem + " " + Guid.NewGuid().ToString("N").Substring(0, 8) + ext;
        }
    }

    public partial class KeePassRPCService
    {
        private volatile bool _ferryUnlockInProgress;
        private System.Windows.Forms.Timer _unlockWatchTimer;

        // Nach einem Entsperr-Anstoß 8 s lang (alle 0,3 s): Windows-Hello-Abfrage oder KeePass-Dialog nach vorne holen.
        // Unabhängig von Fensterereignissen, weil KeePassWinHello die Schlüsselabfrage direkt durch Hello ersetzt.
        // Läuft auf dem UI-Thread (Aufruf aus mw.Invoke).
        private void WatchUnlockWindows()
        {
            if (_unlockWatchTimer != null)
            {
                _unlockWatchTimer.Stop();
                _unlockWatchTimer.Dispose();
            }
            var timer = new System.Windows.Forms.Timer { Interval = 300 };
            _unlockWatchTimer = timer;
            DateTime until = DateTime.UtcNow.AddSeconds(8);
            System.Windows.Forms.Form lastBrought = null;
            timer.Tick += (s, e) =>
            {
                bool done = DateTime.UtcNow > until;
                try
                {
                    if (!done && FerryForeground.BringHelloPrompt()) done = true;
                    if (!done)
                    {
                        System.Windows.Forms.Form top = KeePass.UI.GlobalWindowManager.TopWindow;
                        if (top != null && top.Visible && top != lastBrought && !(top is KeePass.Forms.MainForm))
                        {
                            FerryForeground.Bring(top);
                            lastBrought = top;
                        }
                    }
                }
                catch (Exception)
                {
                    done = true;
                }
                if (done)
                {
                    timer.Stop();
                    timer.Dispose();
                    if (_unlockWatchTimer == timer) _unlockWatchTimer = null;
                }
            };
            timer.Start();
        }
        private static readonly object _diagLock = new object();
        private const long DiagMaxBytes = 2 * 1024 * 1024;

        /// <summary>
        /// Diagnoseprotokoll der Erweiterung (nur wenn dort eingeschaltet): hängt Zeilen mit Zeitstempel an
        /// Dokumente\KeePassFerry\diagnose.log an (anderer Pfad: KeePassFerry.DiagnosticLogPath in der Konfiguration).
        /// Über 2 MB wird die Datei nach diagnose.old.log verschoben.
        /// </summary>
        [JsonRpcMethod]
        public bool FerryDiagLog(string[] lines)
        {
            if (lines == null || lines.Length == 0) return true;
            try
            {
                string path = _host.CustomConfig.GetString("KeePassFerry.DiagnosticLogPath", "");
                if (string.IsNullOrEmpty(path))
                    path = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "KeePassFerry", "diagnose.log");
                lock (_diagLock)
                {
                    System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
                    var info = new System.IO.FileInfo(path);
                    if (info.Exists && info.Length > DiagMaxBytes)
                    {
                        string old = System.IO.Path.ChangeExtension(path, ".old.log");
                        if (System.IO.File.Exists(old)) System.IO.File.Delete(old);
                        System.IO.File.Move(path, old);
                    }
                    var sb = new System.Text.StringBuilder();
                    string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
                    foreach (string line in lines)
                        sb.Append(stamp).Append(' ').Append((line ?? "").Replace("\r", " ").Replace("\n", " ")).Append("\r\n");
                    System.IO.File.AppendAllText(path, sb.ToString(), new System.Text.UTF8Encoding(false));
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Entsperrt eine gesperrte Datenbank im Hintergrund über KeePass' eigene Entsperr-Routine
        /// (wie "Arbeitsbereich entsperren" im Tray-Menü): Es erscheint nur die Schlüsselabfrage, die z. B.
        /// KeePassWinHello durch die Windows-Hello-Abfrage ersetzt. Das Hauptfenster wird nicht nach vorne geholt.
        /// Ergebnis: "started", "notLocked" oder "busy". Das Entsperren selbst läuft danach asynchron.
        /// </summary>
        [JsonRpcMethod]
        public string RequestUnlock()
        {
            var mw = _host.MainWindow;
            string result = "notLocked";
            mw.Invoke((System.Windows.Forms.MethodInvoker)delegate
            {
                KeePass.UI.PwDocument locked = null;
                foreach (KeePass.UI.PwDocument doc in mw.DocumentManager.Documents)
                {
                    if (mw.IsFileLocked(doc))
                    {
                        locked = doc;
                        break;
                    }
                }
                // Keine gesperrte, aber auch keine offene Datenbank (z. B. Startdialog abgebrochen):
                // zuletzt verwendete Datenbank öffnen, es erscheint dieselbe Schlüsselabfrage
                KeePassLib.Serialization.IOConnectionInfo lastFile = null;
                if (locked == null)
                {
                    bool anyOpen = false;
                    foreach (KeePass.UI.PwDocument doc in mw.DocumentManager.Documents)
                        if (doc.Database.IsOpen) anyOpen = true;
                    var last = KeePass.Program.Config.Application.LastUsedFile;
                    if (anyOpen || last == null || string.IsNullOrEmpty(last.Path)) return;
                    lastFile = last.CloneDeep();
                }
                if (_ferryUnlockInProgress || mw.UIIsAutoUnlockBlocked() || !mw.Enabled)
                {
                    // Ein KeePass-Dialog ist schon offen (z. B. Schlüsselabfrage beim Start): diesen nach vorne holen
                    result = "busy";
                    try
                    {
                        System.Windows.Forms.Form top = KeePass.UI.GlobalWindowManager.TopWindow;
                        if (top != null && top.Visible)
                        {
                            bool fg = FerryForeground.Bring(top);
                            bool hello = FerryForeground.BringHelloPrompt();
                            // Für das Diagnoseprotokoll: welches Fenster, ob vorne, ob Hello-Abfrage gefunden
                            result = "focused:" + top.GetType().FullName + ",opacity=" + top.Opacity + ",vorne=" + fg + ",hello=" + hello;
                        }
                        else
                        {
                            result = "busy:" + (top == null ? "keinFenster" : top.GetType().FullName + ",unsichtbar")
                                     + ",inProgress=" + _ferryUnlockInProgress + ",mwEnabled=" + mw.Enabled;
                        }
                    }
                    catch (Exception)
                    {
                    }
                    return;
                }
                _ferryUnlockInProgress = true;
                result = "started";
                WatchUnlockWindows();
                mw.BeginInvoke((System.Windows.Forms.MethodInvoker)delegate
                {
                    try
                    {
                        if (locked == null)
                        {
                            mw.OpenDatabase(lastFile, null, false);
                            return;
                        }
                        mw.DocumentManager.ActiveDocument = locked;
                        // Private Entsperr-Routine von KeePass (Tray-Menü/Hotkey); Fallback: Datenbank direkt öffnen
                        var onFileLock = typeof(KeePass.Forms.MainForm).GetMethod("OnFileLock",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                        if (onFileLock != null)
                            onFileLock.Invoke(mw, new object[] { mw, EventArgs.Empty });
                        else
                            mw.OpenDatabase(locked.LockedIoc, null, false);
                    }
                    catch (Exception)
                    {
                    }
                    finally
                    {
                        _ferryUnlockInProgress = false;
                    }
                });
            });
            return result;
        }
    }

    public class EntryExtras
    {
        public EntryExtraField[] fields;
        public EntryExtraAttachment[] attachments;
        public string notes;
    }

    public class EntryExtraField
    {
        public string name;
        public bool isProtected;
        public string value;
    }

    public class EntryExtraAttachment
    {
        public string name;
        public int size;
    }

    public class SetTotpResult
    {
        public string status;
        public string code;
        public int remainingSeconds;
    }
}
