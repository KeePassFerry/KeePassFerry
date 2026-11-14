using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Jayrock.JsonRpc;
using KeePass.Resources;
using KeePassLib;
using KeePassLib.Security;
using KeePassLib.Utility;

namespace KeePassFerry
{
    /// <summary>
    /// Passkey eines Eintrags (für Auswahl und Anmeldung)
    /// </summary>
    public class PasskeyInfo
    {
        public string uuid;
        public string dbFileName;
        public string title;
        public string username;
        public string credentialId;
        public string userHandle;
        public bool hasPasskey;
        public bool rpMatch;
        public bool passkeyOnly;
    }

    public class PasskeyCreateResult
    {
        public string status; // ok | exists | notfound | error
        public string credentialId;
        public string attestationObject;
        public string authenticatorData;
        public string publicKey; // SubjectPublicKeyInfo (DER), Base64url
        public string entryUuid;
    }

    public class PasskeyAssertionResult
    {
        public string status; // ok | notfound | error
        public string credentialId;
        public string authenticatorData;
        public string signature;
        public string userHandle;
    }

    /// <summary>
    /// Passkeys (WebAuthn) im KeePassXC-Format KPEX_PASSKEY_*, kompatibel mit KeePassXC, KeePassium und KeePassPasskey.
    /// Algorithmus ES256 (P-256), Attestation "none", Zähler 0, Flags UP|UV|BE|BS.
    /// Private Schlüssel verlassen KeePass nie.
    /// </summary>
    public partial class FerryService
    {
        private const string FieldCredentialId = "KPEX_PASSKEY_CREDENTIAL_ID";
        private const string FieldPrivateKey = "KPEX_PASSKEY_PRIVATE_KEY_PEM";
        private const string FieldRelyingParty = "KPEX_PASSKEY_RELYING_PARTY";
        private const string FieldUserHandle = "KPEX_PASSKEY_USER_HANDLE";
        private const string FieldPasskeyUsername = "KPEX_PASSKEY_USERNAME";
        private const string FieldFlagBe = "KPEX_PASSKEY_FLAG_BE";
        private const string FieldFlagBs = "KPEX_PASSKEY_FLAG_BS";

        private static readonly Guid PasskeyGroupUuid = new Guid("4b9f3c1e-6a2d-4d0b-9c7e-2f5a8e1d3b77");

        /// <summary>
        /// Einträge, die zur RP-ID passen (Passkey dieser RP oder URL-Host passt), für die Auswahl beim Erstellen
        /// </summary>
        [JsonRpcMethod]
        public PasskeyInfo[] PasskeyCandidates(string rpId)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(rpId)) return new PasskeyInfo[0];
            var result = new List<PasskeyInfo>();
            foreach (PwDatabase db in _host.MainWindow.DocumentManager.GetOpenDatabases())
            {
                foreach (PwEntry e in GetRootPwGroup(db).GetEntries(true))
                {
                    if ((db.RecycleBinEnabled && IsInRecycleBin(db, e)) || IsHiddenExpired(e)) continue;
                    bool rpMatch = string.Equals(e.Strings.ReadSafe(FieldRelyingParty), rpId, StringComparison.OrdinalIgnoreCase);
                    bool hostMatch = UrlHostMatchesRpId(e.Strings.ReadSafe(PwDefs.UrlField), rpId);
                    if (!rpMatch && !hostMatch) continue;
                    result.Add(ToInfo(e, db, rpMatch));
                }
            }
            // Passkey dieser RP zuerst
            result.Sort((a, b) => b.rpMatch.CompareTo(a.rpMatch));
            return result.ToArray();
        }

        /// <summary>
        /// Passkeys für eine Anmeldung: alle dieser RP-ID oder nur die in allowCredentials genannten
        /// </summary>
        [JsonRpcMethod]
        public PasskeyInfo[] PasskeyFind(string rpId, string[] allowCredentialIds)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(rpId)) return new PasskeyInfo[0];
            var allowed = new HashSet<string>(allowCredentialIds ?? new string[0], StringComparer.Ordinal);
            var result = new List<PasskeyInfo>();
            foreach (PwDatabase db in _host.MainWindow.DocumentManager.GetOpenDatabases())
            {
                foreach (PwEntry e in GetRootPwGroup(db).GetEntries(true))
                {
                    if ((db.RecycleBinEnabled && IsInRecycleBin(db, e)) || IsHiddenExpired(e)) continue;
                    if (!string.Equals(e.Strings.ReadSafe(FieldRelyingParty), rpId, StringComparison.OrdinalIgnoreCase)) continue;
                    string credId = e.Strings.ReadSafe(FieldCredentialId);
                    if (string.IsNullOrEmpty(credId) || string.IsNullOrEmpty(e.Strings.ReadSafe(FieldPrivateKey))) continue;
                    if (allowed.Count > 0 && !allowed.Contains(NormalizeB64Url(credId))) continue;
                    result.Add(ToInfo(e, db, true));
                }
            }
            return result.ToArray();
        }

        /// <summary>
        /// Erzeugt einen Passkey. targetUuid leer → neuer Eintrag in der Gruppe "Passkeys" der gewählten Datenbank.
        /// Vorhandener Passkey im Ziel → status "exists", außer overwrite ist gesetzt (alter Stand in der Historie).
        /// </summary>
        [JsonRpcMethod]
        public PasskeyCreateResult PasskeyCreate(string rpId, string rpName, string userIdB64Url, string userName,
            string origin, string targetUuid, string dbFileName, bool overwrite)
        {
            return CreatePasskey(rpId, rpName, userIdB64Url, userName, origin, targetUuid, dbFileName, overwrite, null);
        }

        /// <summary>
        /// Wie PasskeyCreate; ein neuer Eintrag kommt in die Gruppe groupUuid (innerhalb der für den Browser
        /// freigegebenen Gruppe), leer → Gruppe "Passkeys". Gruppe nicht gefunden → status "notfound"
        /// </summary>
        [JsonRpcMethod]
        public PasskeyCreateResult PasskeyCreateInGroup(string rpId, string rpName, string userIdB64Url, string userName,
            string origin, string targetUuid, string dbFileName, bool overwrite, string groupUuid)
        {
            return CreatePasskey(rpId, rpName, userIdB64Url, userName, origin, targetUuid, dbFileName, overwrite, groupUuid);
        }

        private PasskeyCreateResult CreatePasskey(string rpId, string rpName, string userIdB64Url, string userName,
            string origin, string targetUuid, string dbFileName, bool overwrite, string groupUuid)
        {
            if (!EnsureDBisOpen()) return new PasskeyCreateResult { status = "error" };
            if (string.IsNullOrEmpty(rpId) || string.IsNullOrEmpty(userIdB64Url)) return new PasskeyCreateResult { status = "error" };

            PwDatabase db = SelectDatabase(dbFileName);
            if (db == null) return new PasskeyCreateResult { status = "notfound" };

            PwEntry entry = null;
            if (!string.IsNullOrEmpty(targetUuid))
            {
                entry = GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(targetUuid)), true);
                if (entry == null) return new PasskeyCreateResult { status = "notfound" };
                if (!string.IsNullOrEmpty(entry.Strings.ReadSafe(FieldCredentialId)) && !overwrite)
                    return new PasskeyCreateResult { status = "exists" };
            }

            PwGroup targetGroup = null;
            if (entry == null)
            {
                targetGroup = string.IsNullOrEmpty(groupUuid) ? PasskeyGroup(db) : FindSharedGroup(db, groupUuid);
                if (targetGroup == null) return new PasskeyCreateResult { status = "notfound" };
            }

            byte[] credentialId = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(credentialId);

            CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, null,
                new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport });
            byte[] pkcs8 = key.Export(CngKeyBlobFormat.Pkcs8PrivateBlob);
            byte[] rawPub = FerryCrypto.RawFromCngPublicBlob(key.Export(CngKeyBlobFormat.EccPublicBlob));
            key.Dispose();

            byte[] authData = PasskeyCrypto.BuildAuthData(rpId, 0x5D, credentialId, PasskeyCrypto.CoseKeyEs256(rawPub)); // UP|UV|BE|BS|AT
            byte[] attestationObject = PasskeyCrypto.AttestationObjectNone(authData);

            if (entry == null)
            {
                entry = new PwEntry(true, true);
                entry.IconId = PwIcon.Key;
                entry.Strings.Set(PwDefs.TitleField, new ProtectedString(false, string.IsNullOrEmpty(rpName) ? rpId : rpName));
                entry.Strings.Set(PwDefs.UserNameField, new ProtectedString(false, userName ?? ""));
                entry.Strings.Set(PwDefs.PasswordField, new ProtectedString(true, ""));
                entry.Strings.Set(PwDefs.UrlField, new ProtectedString(false, string.IsNullOrEmpty(origin) ? "https://" + rpId : origin));
                targetGroup.AddEntry(entry, true);
            }
            else
            {
                entry.CreateBackup(db);
                if (string.IsNullOrEmpty(entry.Strings.ReadSafe(PwDefs.UserNameField)) && !string.IsNullOrEmpty(userName))
                    entry.Strings.Set(PwDefs.UserNameField, new ProtectedString(false, userName));
                if (string.IsNullOrEmpty(entry.Strings.ReadSafe(PwDefs.UrlField)) && !string.IsNullOrEmpty(origin))
                    entry.Strings.Set(PwDefs.UrlField, new ProtectedString(false, origin));
            }

            entry.Strings.Set(FieldCredentialId, new ProtectedString(true, B64Url(credentialId)));
            entry.Strings.Set(FieldPrivateKey, new ProtectedString(true, PasskeyCrypto.ToPem(pkcs8)));
            entry.Strings.Set(FieldRelyingParty, new ProtectedString(false, rpId));
            entry.Strings.Set(FieldUserHandle, new ProtectedString(true, NormalizeB64Url(userIdB64Url)));
            entry.Strings.Set(FieldPasskeyUsername, new ProtectedString(false, userName ?? ""));
            entry.Strings.Set(FieldFlagBe, new ProtectedString(false, "1"));
            entry.Strings.Set(FieldFlagBs, new ProtectedString(false, "1"));
            Array.Clear(pkcs8, 0, pkcs8.Length);
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);

            return new PasskeyCreateResult
            {
                status = "ok",
                credentialId = B64Url(credentialId),
                attestationObject = B64Url(attestationObject),
                authenticatorData = B64Url(authData),
                publicKey = B64Url(PasskeyCrypto.SpkiP256(rawPub)),
                entryUuid = entry.Uuid.ToHexString()
            };
        }

        /// <summary>
        /// Anmeldung: signiert authenticatorData || clientDataHash mit dem Passkey des Eintrags (ES256, DER)
        /// </summary>
        [JsonRpcMethod]
        public PasskeyAssertionResult PasskeyGetAssertion(string uuid, string dbFileName, string rpId, string clientDataHashB64Url)
        {
            if (!EnsureDBisOpen()) return new PasskeyAssertionResult { status = "error" };
            PwDatabase db = SelectDatabase(dbFileName);
            PwEntry entry = db == null ? null : GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (entry == null || !string.Equals(entry.Strings.ReadSafe(FieldRelyingParty), rpId, StringComparison.OrdinalIgnoreCase))
                return new PasskeyAssertionResult { status = "notfound" };

            byte[] clientDataHash = FromB64Url(clientDataHashB64Url);
            if (clientDataHash.Length != 32) return new PasskeyAssertionResult { status = "error" };

            bool be = entry.Strings.ReadSafe(FieldFlagBe) != "0";
            bool bs = be && entry.Strings.ReadSafe(FieldFlagBs) != "0";
            byte flags = (byte)(0x01 | 0x04 | (be ? 0x08 : 0) | (bs ? 0x10 : 0)); // UP|UV|BE|BS
            byte[] authData = PasskeyCrypto.BuildAuthData(rpId, flags, null, null);

            byte[] signature;
            try
            {
                signature = PasskeyCrypto.Sign(entry.Strings.ReadSafe(FieldPrivateKey), authData, clientDataHash);
            }
            catch (Exception)
            {
                return new PasskeyAssertionResult { status = "error" };
            }

            return new PasskeyAssertionResult
            {
                status = "ok",
                credentialId = NormalizeB64Url(entry.Strings.ReadSafe(FieldCredentialId)),
                authenticatorData = B64Url(authData),
                signature = B64Url(signature),
                userHandle = NormalizeB64Url(entry.Strings.ReadSafe(FieldUserHandle))
            };
        }

        /// <summary>
        /// Entfernt einen Passkey (nach Rückfrage in der Erweiterung, z. B. auf Meldung der Website über die Signal API).
        /// Reiner Passkey-Eintrag → Papierkorb ("recycled"). Eintrag mit weiteren Daten oder ohne Papierkorb →
        /// nur die KPEX_PASSKEY_*-Felder entfernen, alter Stand in der Historie ("fields").
        /// </summary>
        [JsonRpcMethod]
        public string PasskeyRemove(string uuid, string dbFileName, string rpId, string credentialId)
        {
            if (!EnsureDBisOpen()) return "error";
            PwDatabase db;
            PwEntry entry = FindPasskeyEntry(uuid, dbFileName, rpId, credentialId, out db);
            if (entry == null) return "notfound";

            string status;
            if (IsPasskeyOnly(entry) && db.RecycleBinEnabled && entry.ParentGroup != null)
            {
                MoveToRecycleBin(db, entry);
                status = "recycled";
            }
            else
            {
                entry.CreateBackup(db);
                var names = new List<string>();
                foreach (var kv in entry.Strings)
                    if (kv.Key.StartsWith("KPEX_PASSKEY_", StringComparison.Ordinal)) names.Add(kv.Key);
                foreach (string n in names) entry.Strings.Remove(n);
                entry.Touch(true);
                status = "fields";
            }
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return status;
        }

        /// <summary>
        /// Übernimmt einen geänderten Kontonamen der Website (signalCurrentUserDetails) in den Passkey, mit Historie.
        /// Der Benutzername des Eintrags wird nur bei reinen Passkey-Einträgen mitgeändert.
        /// </summary>
        [JsonRpcMethod]
        public string PasskeyUpdateUser(string uuid, string dbFileName, string rpId, string credentialId, string name)
        {
            if (!EnsureDBisOpen() || string.IsNullOrEmpty(name)) return "error";
            PwDatabase db;
            PwEntry entry = FindPasskeyEntry(uuid, dbFileName, rpId, credentialId, out db);
            if (entry == null) return "notfound";
            string old = entry.Strings.ReadSafe(FieldPasskeyUsername);
            if (old == name) return "unchanged";

            entry.CreateBackup(db);
            entry.Strings.Set(FieldPasskeyUsername, new ProtectedString(false, name));
            if (IsPasskeyOnly(entry) && entry.Strings.ReadSafe(PwDefs.UserNameField) == old)
                entry.Strings.Set(PwDefs.UserNameField, new ProtectedString(false, name));
            entry.Touch(true);
            _host.MainWindow.BeginInvoke(new dlgSaveDB(saveDB), db);
            return "ok";
        }

        // ---------- Hilfsfunktionen ----------

        private PasskeyInfo ToInfo(PwEntry e, PwDatabase db, bool rpMatch)
        {
            string credId = e.Strings.ReadSafe(FieldCredentialId);
            string user = e.Strings.ReadSafe(FieldPasskeyUsername);
            if (string.IsNullOrEmpty(user)) user = e.Strings.ReadSafe(PwDefs.UserNameField);
            return new PasskeyInfo
            {
                uuid = e.Uuid.ToHexString(),
                dbFileName = db.IOConnectionInfo.Path,
                title = e.Strings.ReadSafe(PwDefs.TitleField),
                username = user,
                credentialId = string.IsNullOrEmpty(credId) ? null : NormalizeB64Url(credId),
                userHandle = string.IsNullOrEmpty(credId) ? null : NormalizeB64Url(e.Strings.ReadSafe(FieldUserHandle)),
                hasPasskey = !string.IsNullOrEmpty(credId),
                rpMatch = rpMatch,
                passkeyOnly = IsPasskeyOnly(e)
            };
        }

        // Eintrag enthält nur den Passkey (kein Passwort, keine Notizen, keine Anhänge, keine weiteren Felder wie OTP)
        private static bool IsPasskeyOnly(PwEntry e)
        {
            if (string.IsNullOrEmpty(e.Strings.ReadSafe(FieldCredentialId))) return false;
            if (!e.Strings.GetSafe(PwDefs.PasswordField).IsEmpty || !e.Strings.GetSafe(PwDefs.NotesField).IsEmpty) return false;
            if (e.Binaries.UCount > 0) return false;
            foreach (var kv in e.Strings)
            {
                if (PwDefs.IsStandardField(kv.Key) || kv.Key.StartsWith("KPEX_PASSKEY_", StringComparison.Ordinal)) continue;
                if (kv.Key.StartsWith("KPRPC JSON", StringComparison.Ordinal)) continue; // Altfeld aus Kee
                if (!kv.Value.IsEmpty) return false;
            }
            return true;
        }

        private PwEntry FindPasskeyEntry(string uuid, string dbFileName, string rpId, string credentialId, out PwDatabase db)
        {
            db = SelectDatabase(dbFileName);
            if (db == null || string.IsNullOrEmpty(uuid)) return null;
            PwEntry e = GetRootPwGroup(db).FindEntry(new PwUuid(MemUtil.HexStringToByteArray(uuid)), true);
            if (e == null || IsInRecycleBin(db, e)) return null;
            if (!string.Equals(e.Strings.ReadSafe(FieldRelyingParty), rpId, StringComparison.OrdinalIgnoreCase)) return null;
            if (NormalizeB64Url(e.Strings.ReadSafe(FieldCredentialId)) != NormalizeB64Url(credentialId)) return null;
            return e;
        }

        // Wie KeePass beim Löschen mit eingeschaltetem Papierkorb: Papierkorb bei Bedarf anlegen, Eintrag hinein verschieben
        private static void MoveToRecycleBin(PwDatabase db, PwEntry entry)
        {
            PwGroup recycleBin = db.RootGroup.FindGroup(db.RecycleBinUuid, true);
            if (recycleBin == null)
            {
                recycleBin = new PwGroup(true, true, KPRes.RecycleBin, PwIcon.TrashBin);
                recycleBin.EnableAutoType = false;
                recycleBin.EnableSearching = false;
                db.RootGroup.AddGroup(recycleBin, true);
                db.RecycleBinUuid = recycleBin.Uuid;
                db.RecycleBinChanged = DateTime.UtcNow;
            }
            entry.ParentGroup.Entries.Remove(entry);
            recycleBin.AddEntry(entry, true, true);
            entry.Touch(false);
        }

        private static bool IsInRecycleBin(PwDatabase db, PwEntry e)
        {
            PwGroup g = e.ParentGroup;
            while (g != null)
            {
                if (g.Uuid.Equals(db.RecycleBinUuid)) return true;
                g = g.ParentGroup;
            }
            return false;
        }

        // RP-ID passt zum Host der URL (gleich oder Subdomain davon)
        private static bool UrlHostMatchesRpId(string url, string rpId)
        {
            if (string.IsNullOrEmpty(url)) return false;
            Uri u;
            if (!Uri.TryCreate(url.Contains("://") ? url : "https://" + url, UriKind.Absolute, out u)) return false;
            string host = u.Host.ToLowerInvariant();
            string rp = rpId.ToLowerInvariant();
            return host == rp || host.EndsWith("." + rp, StringComparison.Ordinal);
        }

        // Gruppe "Passkeys" innerhalb der für den Browser freigegebenen Gruppe (ohne Freigabe: Wurzel der Datenbank)
        private PwGroup PasskeyGroup(PwDatabase db)
        {
            PwGroup root = GetRootPwGroup(db);
            var uuid = new PwUuid(PasskeyGroupUuid.ToByteArray());
            PwGroup g = root.FindGroup(uuid, true);
            if (g != null) return g;
            g = new PwGroup(true, true, "Passkeys", PwIcon.Key);
            g.Uuid = uuid;
            root.AddGroup(g, true);
            return g;
        }

        // Gruppe mit dieser UUID innerhalb der freigegebenen Gruppe (sie selbst eingeschlossen), nicht im Papierkorb
        private PwGroup FindSharedGroup(PwDatabase db, string groupUuid)
        {
            PwUuid uuid;
            try
            {
                uuid = new PwUuid(MemUtil.HexStringToByteArray(groupUuid));
            }
            catch
            {
                return null;
            }
            PwGroup root = GetRootPwGroup(db);
            PwGroup g = root.Uuid.Equals(uuid) ? root : root.FindGroup(uuid, true);
            if (g == null) return null;
            if (db.RecycleBinEnabled)
            {
                for (PwGroup p = g; p != null; p = p.ParentGroup)
                    if (p.Uuid.Equals(db.RecycleBinUuid)) return null;
            }
            return g;
        }

        private static string B64Url(byte[] b)
        {
            return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static byte[] FromB64Url(string s)
        {
            string t = (s ?? "").Replace('-', '+').Replace('_', '/');
            while (t.Length % 4 != 0) t += "=";
            return Convert.FromBase64String(t);
        }

        // Base64 oder Base64url mit/ohne Padding → Base64url ohne Padding (Vergleich unabhängig von der Schreibweise)
        private static string NormalizeB64Url(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            try
            {
                return B64Url(FromB64Url(s.Trim()));
            }
            catch (FormatException)
            {
                return s.Trim();
            }
        }
    }
}
