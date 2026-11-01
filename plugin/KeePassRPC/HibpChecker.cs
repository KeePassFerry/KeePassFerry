using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using KeePass.App;
using KeePass.Plugins;
using KeePass.UI;
using KeePassLib;
using KeePassLib.Security;

namespace KeePassFerry
{
    /// <summary>
    /// Prüft Passwörter im Hintergrund bei "Have I Been Pwned" (nur wenn eingeschaltet, KeePassFerry.Hibp.Enabled).
    /// k-Anonymität: gesendet werden nur die ersten 5 Zeichen des SHA-1-Hashes, verglichen wird lokal.
    /// Ergebnis im selben Feld und Format wie das Plugin "HIBP Offline Check" (beide verstehen es); Prüfzeitpunkt
    /// unsichtbar in den CustomData des Eintrags. Geleakte Passwörter werden nicht erneut geprüft (die Liste wächst nur),
    /// andere alle 30 Tage, geänderte Einträge sofort. Kein Chronik-Eintrag, kein neues Änderungsdatum.
    /// Abbruch (Netz weg, KeePass zu, Datenbank gesperrt) ist unkritisch: Ungeprüftes kommt beim nächsten Mal dran,
    /// ein Fehler wird nie als "sicher" eingetragen.
    /// </summary>
    internal sealed class HibpChecker : IDisposable
    {
        internal const string ConfigEnabled = "KeePassFerry.Hibp.Enabled";
        private const string CheckedKey = "KeePassFerry.HibpChecked";
        private const string RangeUrl = "https://api.pwnedpasswords.com/range/";
        private static readonly TimeSpan RecheckAfter = TimeSpan.FromDays(30);
        private const int BatchSize = 40;
        private const int TickMs = 30 * 1000;
        private const int RequestTimeoutMs = 10000;
        private const int MaxParallel = 4;
        private const int MaxResponseLines = 10000;

        private readonly IPluginHost _host;
        private readonly System.Windows.Forms.Timer _timer;
        private volatile bool _busy;
        private bool _manual;
        private int _manualChecked;
        private readonly List<string> _manualLeaked = new List<string>();
        // Im Hintergrund neu gefundene Lecks: gesammelt und erst gemeldet, wenn nichts mehr fällig ist (eine Meldung je
        // Durchlauf statt einer je Paket)
        private readonly List<string> _passLeaked = new List<string>();
        // Datenbanken mit neuen Ergebnissen; gespeichert wird am Ende des Durchlaufs (nicht nach jedem Paket)
        private readonly HashSet<PwDatabase> _pendingSave = new HashSet<PwDatabase>();
        private bool _disposed;

        private sealed class Item
        {
            public PwDatabase Db;
            public PwEntry Entry;
            public string Hash;
            public bool WasLeaked;
            public int Count = -1;
        }

        internal HibpChecker(IPluginHost host)
        {
            _host = host;
            _timer = new System.Windows.Forms.Timer { Interval = TickMs };
            _timer.Tick += delegate { RunBatch(); };
            _timer.Start();
        }

        internal bool Enabled
        {
            get { return _host.CustomConfig.GetBool(ConfigEnabled, false); }
            set
            {
                _host.CustomConfig.SetBool(ConfigEnabled, value);
                if (value) Kick();
            }
        }

        // Bald prüfen (z. B. nach dem Einschalten oder einer Passwortänderung)
        internal void Kick()
        {
            if (_disposed) return;
            var once = new System.Windows.Forms.Timer { Interval = 3000 };
            once.Tick += delegate
            {
                once.Stop();
                once.Dispose();
                RunBatch();
            };
            once.Start();
        }

        // Menü "Passwörter jetzt prüfen": alles Fällige nacheinander, am Ende eine Zusammenfassung
        internal void CheckAllNow()
        {
            if (_busy) return;
            _manual = true;
            _manualChecked = 0;
            _manualLeaked.Clear();
            RunBatch();
        }

        // Alter Status gilt nicht mehr (Passwort über KeePassFerry geändert)
        internal static void Invalidate(PwEntry entry)
        {
            entry.CustomData.Remove(CheckedKey);
            entry.Strings.Remove(HibpStatus.ColumnName);
        }

        private void RunBatch()
        {
            if (_disposed || _busy || !Enabled) return;
            List<Item> items = CollectDue(_manual ? 200 : BatchSize);
            if (items.Count == 0)
            {
                FinishPass();
                FinishManual();
                return;
            }
            _busy = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool failed = Lookup(items);
                try
                {
                    _host.MainWindow.BeginInvoke(new Action(delegate { Apply(items, failed); }));
                }
                catch (Exception)
                {
                    _busy = false;
                }
            });
        }

        private List<Item> CollectDue(int max)
        {
            var items = new List<Item>();
            DateTime now = DateTime.UtcNow;
            foreach (PwDocument doc in _host.MainWindow.DocumentManager.Documents)
            {
                PwDatabase db = doc.Database;
                if (db == null || !db.IsOpen || _host.MainWindow.IsFileLocked(doc)) continue;
                PwGroup bin = db.RecycleBinEnabled ? db.RootGroup.FindGroup(db.RecycleBinUuid, true) : null;
                foreach (PwEntry e in db.RootGroup.GetEntries(true))
                {
                    if (items.Count >= max) return items;
                    if (bin != null && (e.ParentGroup == bin || e.ParentGroup.IsContainedIn(bin))) continue;
                    string pw = e.Strings.ReadSafe(PwDefs.PasswordField);
                    if (pw.Length == 0 || pw.IndexOf("{REF:", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                    bool leaked = HibpStatus.StatusIsLeaked(e.Strings.ReadSafe(HibpStatus.ColumnName));
                    DateTime checkedAt;
                    bool hasChecked = DateTime.TryParse(e.CustomData.Get(CheckedKey), CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out checkedAt);
                    bool due = !hasChecked
                        || e.LastModificationTime.ToUniversalTime() > checkedAt
                        || (!leaked && now - checkedAt > RecheckAfter);
                    if (!due) continue;
                    items.Add(new Item { Db = db, Entry = e, Hash = Sha1Hex(pw), WasLeaked = leaked });
                }
            }
            return items;
        }

        // Im Hintergrund: je Hash-Anfang eine Anfrage; true bei Verbindungsproblemen (dann wird nichts eingetragen)
        private static bool Lookup(List<Item> items)
        {
            var byPrefix = new Dictionary<string, List<Item>>();
            foreach (Item it in items)
            {
                string prefix = it.Hash.Substring(0, 5);
                List<Item> list;
                if (!byPrefix.TryGetValue(prefix, out list)) byPrefix[prefix] = list = new List<Item>();
                list.Add(it);
            }
            int failures = 0;
            var options = new ParallelOptions { MaxDegreeOfParallelism = MaxParallel };
            Parallel.ForEach(byPrefix, options, (pair, state) =>
            {
                Dictionary<string, int> counts = FetchRange(pair.Key) ?? FetchRange(pair.Key);
                if (counts == null)
                {
                    if (Interlocked.Increment(ref failures) >= 3) state.Stop();
                    return;
                }
                foreach (Item it in pair.Value)
                {
                    int c;
                    it.Count = counts.TryGetValue(it.Hash.Substring(5), out c) ? c : 0;
                }
            });
            return failures > 0;
        }

        private static Dictionary<string, int> FetchRange(string prefix)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                var req = (HttpWebRequest)WebRequest.Create(RangeUrl + prefix);
                req.Timeout = RequestTimeoutMs;
                req.ReadWriteTimeout = RequestTimeoutMs;
                req.UserAgent = "KeePassFerry";
                // Nur dieser Dienst: keine Umleitungen woandershin
                req.AllowAutoRedirect = false;
                // Antworten auf gleiche Länge auffüllen (Füllzeilen haben die Anzahl 0)
                req.Headers.Add("Add-Padding", "true");
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(res.GetResponseStream(), Encoding.ASCII))
                {
                    if (res.StatusCode != HttpStatusCode.OK) return null;
                    var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    string line;
                    int lines = 0;
                    while ((line = reader.ReadLine()) != null)
                    {
                        // Eine Antwort hat rund 800–2.000 Zeilen (mit Auffüllung); mehr deutet auf eine falsche Gegenstelle
                        if (++lines > MaxResponseLines) return null;
                        int i = line.IndexOf(':');
                        if (i != 35) continue;
                        int n;
                        if (int.TryParse(line.Substring(i + 1).Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out n) && n > 0)
                            result[line.Substring(0, i)] = n;
                    }
                    return result;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        // Im UI-Thread: Ergebnisse eintragen, wo das Passwort inzwischen nicht geändert wurde
        private void Apply(List<Item> items, bool failed)
        {
            try
            {
                var touched = new Dictionary<PwDatabase, bool>();
                var newlyLeaked = new List<string>();
                string stamp = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                foreach (Item it in items)
                {
                    if (it.Count < 0 || !it.Db.IsOpen) continue;
                    if (Sha1Hex(it.Entry.Strings.ReadSafe(PwDefs.PasswordField)) != it.Hash) continue;
                    if (!touched.ContainsKey(it.Db)) touched[it.Db] = it.Db.Modified;
                    bool leaked = it.Count > 0;
                    string status = leaked ? HibpStatus.LeakedText(it.Count) : HibpStatus.SecureText;
                    if (it.Entry.Strings.ReadSafe(HibpStatus.ColumnName) != status)
                        it.Entry.Strings.Set(HibpStatus.ColumnName, new ProtectedString(false, status));
                    it.Entry.CustomData.Set(CheckedKey, stamp);
                    if (leaked && !it.WasLeaked) newlyLeaked.Add(it.Entry.Strings.ReadSafe(PwDefs.TitleField));
                    if (_manual)
                    {
                        _manualChecked++;
                        if (leaked) _manualLeaked.Add(it.Entry.Strings.ReadSafe(PwDefs.TitleField));
                    }
                }
                foreach (KeyValuePair<PwDatabase, bool> pair in touched) _pendingSave.Add(pair.Key);
                if (touched.Count > 0)
                {
                    _host.MainWindow.RefreshEntriesList();
                    _host.MainWindow.UpdateUI(false, null, false, null, false, null, false);
                }
                if (!_manual) _passLeaked.AddRange(newlyLeaked);
            }
            catch (Exception)
            {
                // nächster Durchgang versucht es erneut
            }
            finally
            {
                _busy = false;
            }

            if (_manual)
            {
                if (failed)
                {
                    _manual = false;
                    Notify(FerryText.T("Keine Verbindung zu „Have I Been Pwned“. Geprüft: " + _manualChecked + " Passwörter; der Rest folgt später.",
                        "No connection to \"Have I Been Pwned\". Checked: " + _manualChecked + " passwords; the rest follows later."), ToolTipIcon.Warning);
                }
                else RunBatch();
            }
        }

        // Durchlauf im Hintergrund fertig: gesammelte neue Lecks einmal melden, nur als Benachrichtigung (kein Dialog zu
        // unerwarteter Zeit; das Popup zeigt die Warnung ohnehin)
        private void FinishPass()
        {
            SavePending();
            if (_passLeaked.Count == 0) return;
            NotifyIcon tray = _host.MainWindow.MainNotifyIcon;
            if (tray != null && tray.Visible) NotifyLeaked(new List<string>(_passLeaked));
            _passLeaked.Clear();
        }

        // Ergebnisse speichern: nur wenn der Nutzer keine eigenen ungespeicherten Änderungen offen hat (sonst landen
        // sie mit seinem nächsten Speichern in der Datei, seine halbfertige Bearbeitung wird nie mitgespeichert)
        private void SavePending()
        {
            foreach (PwDatabase db in _pendingSave)
            {
                if (!db.IsOpen) continue;
                if (db.Modified) continue;
                db.Modified = true;
                try
                {
                    _host.MainWindow.SaveDatabase(db, null);
                }
                catch (Exception)
                {
                    // bleibt als geändert markiert
                }
            }
            _pendingSave.Clear();
        }

        /// <summary>Stand für die Einstellungen: prüfbare Einträge, davon aktuell geprüft, davon geleakt, läuft gerade</summary>
        internal void Progress(out int total, out int done, out int leaked, out bool running)
        {
            total = done = leaked = 0;
            running = _busy || _manual;
            foreach (PwDocument doc in _host.MainWindow.DocumentManager.Documents)
            {
                PwDatabase db = doc.Database;
                if (db == null || !db.IsOpen || _host.MainWindow.IsFileLocked(doc)) continue;
                PwGroup bin = db.RecycleBinEnabled ? db.RootGroup.FindGroup(db.RecycleBinUuid, true) : null;
                foreach (PwEntry e in db.RootGroup.GetEntries(true))
                {
                    if (bin != null && (e.ParentGroup == bin || e.ParentGroup.IsContainedIn(bin))) continue;
                    string pw = e.Strings.ReadSafe(PwDefs.PasswordField);
                    if (pw.Length == 0 || pw.IndexOf("{REF:", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    total++;
                    DateTime checkedAt;
                    bool hasChecked = DateTime.TryParse(e.CustomData.Get(CheckedKey), CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out checkedAt);
                    if (!hasChecked || e.LastModificationTime.ToUniversalTime() > checkedAt) continue;
                    done++;
                    if (HibpStatus.StatusIsLeaked(e.Strings.ReadSafe(HibpStatus.ColumnName))) leaked++;
                }
            }
        }

        private void FinishManual()
        {
            if (!_manual) return;
            _manual = false;
            string text = _manualLeaked.Count == 0
                ? FerryText.T(_manualChecked + " Passwörter geprüft, keines in Datenlecks gefunden.",
                    _manualChecked + " passwords checked, none found in data breaches.")
                : FerryText.T(_manualChecked + " Passwörter geprüft, " + _manualLeaked.Count + " in Datenlecks gefunden: " + Names(_manualLeaked),
                    _manualChecked + " passwords checked, " + _manualLeaked.Count + " found in data breaches: " + Names(_manualLeaked));
            Notify(text, _manualLeaked.Count == 0 ? ToolTipIcon.Info : ToolTipIcon.Warning);
        }

        private void NotifyLeaked(List<string> titles)
        {
            Notify(titles.Count == 1
                ? FerryText.T("Das Passwort von „" + titles[0] + "“ wurde in Datenlecks gefunden. Ändere es auf der Website.",
                    "The password of \"" + titles[0] + "\" was found in data breaches. Change it on the website.")
                : FerryText.T(titles.Count + " Passwörter wurden in Datenlecks gefunden: " + Names(titles),
                    titles.Count + " passwords were found in data breaches: " + Names(titles)), ToolTipIcon.Warning);
        }

        private static string Names(List<string> titles)
        {
            var shown = titles.Count > 3 ? titles.GetRange(0, 3) : titles;
            return string.Join(", ", shown.ToArray()) + (titles.Count > 3 ? " …" : "");
        }

        private void Notify(string text, ToolTipIcon icon)
        {
            NotifyIcon tray = _host.MainWindow.MainNotifyIcon;
            if (tray != null && tray.Visible) tray.ShowBalloonTip(15000, "KeePassFerry", text, icon);
            else MessageBox.Show(text, "KeePassFerry", MessageBoxButtons.OK,
                icon == ToolTipIcon.Warning ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }

        private static string Sha1Hex(string text)
        {
            using (var sha = SHA1.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "");
        }

        public void Dispose()
        {
            _disposed = true;
            _timer.Stop();
            _timer.Dispose();
        }
    }
}
