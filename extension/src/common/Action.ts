export const enum Action {
    CloseAllPanels = "closeAllPanels",
    DetectForms = "detectForms",
    ResetForms = "resetForms",
    GetPasswordProfiles = "getPasswordProfiles",
    GeneratePassword = "generatePassword",
    ManualFill = "manualFill",
    Primary = "primary",
    ShowMatchedLoginsPanel = "showMatchedLoginsPanel",
    PageHide = "pageHide",
    OpenKeePass = "openkeepass",
    CreateEntry = "createEntry",
    UpdateEntry = "updateEntry",
    ShowSaveNotice = "showSaveNotice",
    OpenSavePopup = "openSavePopup",
    DismissSaveNotice = "dismissSaveNotice",
    RequestOtp = "requestOtp",
    FillOtp = "fillOtp",
    EntryFilled = "entryFilled",
    OtpSetupCandidate = "otpSetupCandidate",
    ShowOtpSetupNotice = "showOtpSetupNotice",
    HideOtpSetupNotice = "hideOtpSetupNotice",
    OpenOtpSetupPopup = "openOtpSetupPopup",
    DismissOtpSetup = "dismissOtpSetup",
    QueryUnlocked = "queryUnlocked",
    UnlockState = "unlockState",
    WebAuthnRequest = "webAuthnRequest",
    QueryFields = "queryFields",
    FillField = "fillField",
    FillContextTarget = "fillContextTarget",
    // Popup (Diagnoseprotokoll an): Aufbau der Anmeldefelder jedes Frames ins Protokoll schreiben
    CapturePageAnalysis = "capturePageAnalysis",
    // Seite: Anmeldung mit unverändert eingetragenen Daten abgeschickt
    FilledLoginSubmitted = "filledLoginSubmitted",
    // Seite: "Passwort aktualisieren" nicht gezeigt, das Anmeldeformular blieb stehen (Anmeldung fehlgeschlagen)
    PasswordUpdateNotShown = "passwordUpdateNotShown",
    // Hintergrund: offenes Angebot zum Speichern bzw. Aktualisieren ist erledigt, Hinweis schließen
    WithdrawSaveNotice = "withdrawSaveNotice",
    // Hintergrund: Passwort des gerade ausgefüllten Eintrags läuft bald ab bzw. ist abgelaufen
    ShowExpiryNotice = "showExpiryNotice",
    // Seite: aus diesem Hinweis "Passwort ändern" bzw. "Später"
    OpenChangePassword = "openChangePassword",
    DismissExpiryNotice = "dismissExpiryNotice",
    // Hintergrund: Eintrag gespeichert (kurze Bestätigung auf der Seite)
    ShowSavedNotice = "showSavedNotice"
}
