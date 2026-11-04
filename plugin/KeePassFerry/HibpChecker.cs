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
    /// andere alle 30 Tage, geänderte Einträge sofort; nach dem (Wieder-)Einschalten alles einmal. Fällige Einträge
    /// laufen ohne Pause in Paketen durch (die Bereichsabfrage ist nicht begrenzt); dann alle 30 s nachsehen.
    /// Keine Meldungen in Windows: Stand, letzter Durchlauf und Verbindungsfehler zeigt die Erweiterung (Progress).
    /// Kein Chronik-Eintrag, kein neues Änderungsdatum.
    /// Abbruch (Netz weg, KeePass zu, Datenbank gesperrt) ist unkritisch: Ungeprüftes kommt beim nächsten Mal dran,
    /// ein Fehler wird nie als "sicher" eingetragen.
    /// </summary>
    internal sealed class HibpChecker : IDisposable
    {
        internal const string ConfigEnabled = "KeePassFerry.Hibp.Enabled";
        private const string CheckedKey = "KeePassFerry.HibpChecked";
        // Wann das Passwort erstmals als geleakt erkannt wurde (für den Hinweis "neu gefunden" im Popup)
        internal const string LeakedAtKey = "KeePassFerry.HibpLeakedAt";
        // Zeitpunkt des letzten Einschaltens: ältere Ergebnisse werden einmal neu geprüft (auch geleakte), weil unklar
        // ist, wie lange die Prüfung aus war
        private const string ConfigEnabledAt = "KeePassFerry.Hibp.EnabledAt";
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
        // Datenbanken mit neuen Ergebnissen; gespeichert wird am Ende des Durchlaufs (nicht nach jedem Paket)
        private readonly HashSet<PwDatabase> _pendingSave = new HashSet<PwDatabase>();
        private bool _disposed;
        // Für die Anzeige in der Erweiterung: letzter Verbindungsfehler (UTC)
        private DateTime _lastFailure = DateTime.MinValue;

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
                SetEnabledState(value);
                if (value) Kick();
            }
        }

        // Nur die Einstellung (aus jedem Thread); Kick muss im Oberflächen-Thread laufen
        internal void SetEnabledState(bool value)
        {
            bool was = Enabled;
            _host.CustomConfig.SetBool(ConfigEnabled, value);
            if (value && !was)
                _host.CustomConfig.SetString(ConfigEnabledAt, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
        }

        private DateTime EnabledAt
        {
            get
            {
                DateTime at;
                return DateTime.TryParse(_host.CustomConfig.GetString(ConfigEnabledAt, ""), CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out at) ? at : DateTime.MinValue;
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

        // Alter Status gilt nicht mehr (Passwort über KeePassFerry geändert)
        internal static void Invalidate(PwEntry entry)
        {
            entry.CustomData.Remove(CheckedKey);
            entry.CustomData.Remove(LeakedAtKey);
            entry.Strings.Remove(HibpStatus.ColumnName);
        }

        private void RunBatch()
        {
            if (_disposed || _busy || !Enabled) return;
            List<Item> items = CollectDue(BatchSize);
            if (items.Count == 0)
            {
                FinishPass();
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
            DateTime enabledAt = EnabledAt;
            foreach (PwDocument doc in _host.MainWindow.DocumentManager.Documents)
            {
                PwDatabase db = doc.Database;
                if (db == null || !db.IsOpen || _host.MainWindow.IsFileLocked(doc)) continue;
                // Schreibgeschützt (z. B. nur lesend geteilt): Ergebnis ließe sich nicht speichern
                if (FerryService.IsDatabaseReadOnly(db)) continue;
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
                        || checkedAt < enabledAt
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
                    if (leaked && !it.WasLeaked) it.Entry.CustomData.Set(LeakedAtKey, stamp);
                    else if (!leaked) it.Entry.CustomData.Remove(LeakedAtKey);
                }
                foreach (KeyValuePair<PwDatabase, bool> pair in touched) _pendingSave.Add(pair.Key);
                if (touched.Count > 0)
                {
                    _host.MainWindow.RefreshEntriesList();
                    _host.MainWindow.UpdateUI(false, null, false, null, false, null, false);
                }
            }
            catch (Exception)
            {
                // nächster Durchgang versucht es erneut
            }
            finally
            {
                _busy = false;
            }

            // Ohne Pause weiter, solange etwas fällig ist; bei Verbindungsproblemen erst wieder mit dem Takt (30 s)
            if (failed) _lastFailure = DateTime.UtcNow;
            else
            {
                _lastFailure = DateTime.MinValue;
                RunBatch();
            }
        }

        // Nichts mehr fällig: Ergebnisse speichern
        private void FinishPass()
        {
            SavePending();
        }

        // Ergebnisse speichern: nur wenn der Nutzer keine eigenen ungespeicherten Änderungen offen hat (sonst landen
        // sie mit seinem nächsten Speichern in der Datei, seine halbfertige Bearbeitung wird nie mitgespeichert)
        private void SavePending()
        {
            foreach (PwDatabase db in _pendingSave)
            {
                if (!db.IsOpen || FerryService.IsDatabaseReadOnly(db)) continue;
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

        /// <summary>
        /// Geleakte Einträge für das Popup: nur seit "since" (ISO, UTC) neu erkannte, ohne "since" alle. Nur Titel,
        /// Adresse, Anzahl und Fundzeitpunkt, nie Passwörter.
        /// </summary>
        internal List<Dictionary<string, object>> Leaks(string since)
        {
            var result = new List<Dictionary<string, object>>();
            DateTime sinceAt = DateTime.MinValue;
            bool onlyNew = !string.IsNullOrEmpty(since) && DateTime.TryParse(since, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out sinceAt);
            foreach (PwDocument doc in _host.MainWindow.DocumentManager.Documents)
            {
                PwDatabase db = doc.Database;
                if (db == null || !db.IsOpen || _host.MainWindow.IsFileLocked(doc)) continue;
                PwGroup bin = db.RecycleBinEnabled ? db.RootGroup.FindGroup(db.RecycleBinUuid, true) : null;
                foreach (PwEntry e in db.RootGroup.GetEntries(true))
                {
                    if (bin != null && (e.ParentGroup == bin || e.ParentGroup.IsContainedIn(bin))) continue;
                    int count;
                    if (!HibpStatus.IsLeaked(e, out count)) continue;
                    DateTime leakedAt;
                    bool hasLeakedAt = DateTime.TryParse(e.CustomData.Get(LeakedAtKey), CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out leakedAt);
                    if (onlyNew && (!hasLeakedAt || leakedAt <= sinceAt)) continue;
                    result.Add(new Dictionary<string, object>
                    {
                        { "uuid", KeePassLib.Utility.MemUtil.ByteArrayToHexString(e.Uuid.UuidBytes) },
                        { "dbFileName", db.IOConnectionInfo.Path },
                        { "title", e.Strings.ReadSafe(PwDefs.TitleField) },
                        { "url", e.Strings.ReadSafe(PwDefs.UrlField) },
                        { "count", count },
                        { "leakedAt", hasLeakedAt ? leakedAt.ToString("o", CultureInfo.InvariantCulture) : "" }
                    });
                }
            }
            return result;
        }

        /// <summary>Stand für die Einstellungen: prüfbare Einträge, davon aktuell geprüft, davon geleakt, läuft gerade</summary>
        internal void Progress(out int total, out int done, out int leaked, out bool running, out DateTime lastPass,
            out DateTime lastFailure)
        {
            total = done = leaked = 0;
            lastPass = DateTime.MinValue;
            lastFailure = _lastFailure;
            DateTime enabledAt = EnabledAt;
            running = _busy;
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
                    if (hasChecked && checkedAt > lastPass) lastPass = checkedAt;
                    if (!hasChecked || e.LastModificationTime.ToUniversalTime() > checkedAt || checkedAt < enabledAt) continue;
                    done++;
                    if (HibpStatus.StatusIsLeaked(e.Strings.ReadSafe(HibpStatus.ColumnName))) leaked++;
                }
            }
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
