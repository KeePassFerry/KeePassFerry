; KeePassFerry – Installationsprogramm für das KeePass-Plugin (Inno Setup 6)
; Baut die Release-Action: iscc /DAppVersion=1.2.3 /DSourceDir=..\release\KeePassFerry installer\KeePassFerry.iss
; Kopiert das Plugin nach <KeePass>\Plugins\KeePassFerry. KeePass wird über den Restart Manager beendet und
; danach vom Setup wieder gestartet (als normaler Benutzer), sofern es vorher lief. Beim Deinstallieren werden auch die Native-Messaging-Einträge des Plugins entfernt.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\release\KeePassFerry"
#endif
; Store-Seiten der Erweiterung; leer = (noch) nicht im Store, Häkchen erscheint dann nicht
#define EdgeStoreUrl "https://microsoftedge.microsoft.com/addons/detail/ghkhbdnhojpeibdjdlgojfdjhedapmhg"
#define ChromeStoreUrl "https://chromewebstore.google.com/detail/fhciciajogahdkbmeliechblahlhpmga"
#define FirefoxStoreUrl ""

[Setup]
AppId={{6E0F2F4B-6C55-4B6E-9A8E-4E4C1F1E8A2D}
AppName=KeePassFerry
AppVersion={#AppVersion}
AppVerName=KeePassFerry {#AppVersion}
AppPublisher=KeePassFerry
AppPublisherURL=https://github.com/KeePassFerry/KeePassFerry
AppSupportURL=https://github.com/KeePassFerry/KeePassFerry/issues
AppUpdatesURL=https://github.com/KeePassFerry/KeePassFerry/releases
; {app} ist der KeePass-Ordner (installiert oder portabel); das Plugin landet in {app}\Plugins\KeePassFerry
DefaultDirName={code:DefaultKeePassDir}
AppendDefaultDirName=no
DirExistsWarning=no
DisableProgramGroupPage=yes
DisableReadyPage=no
UsePreviousAppDir=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll
; KeePass meldet sich nicht beim Restart Manager an; den Neustart übernimmt [Run] (StartKeePass)
RestartApplications=no
OutputDir=..\release
OutputBaseFilename=KeePassFerry-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\branding\keepassferry.ico
; Deinstallationsprogramm im Plugin-Ordner, nicht neben dem von KeePass; es trägt das KeePassFerry-Symbol
UninstallFilesDir={app}\Plugins\KeePassFerry
UninstallDisplayIcon={uninstallexe}
UninstallDisplayName=KeePassFerry (KeePass-Plugin)
LicenseFile={#SourceDir}\LICENSE.txt
VersionInfoVersion={#AppVersion}
VersionInfoProductName=KeePassFerry

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
de.SelectKeePassDir=Wählen Sie den Ordner, in dem KeePass Password Safe 2 installiert ist (dort liegt KeePass.exe). Bei der portablen Version ist das der Ordner, in den Sie KeePass entpackt haben.
en.SelectKeePassDir=Select the folder where KeePass Password Safe 2 is installed (the folder containing KeePass.exe). For the portable version, this is the folder you extracted KeePass to.
de.NoKeePassExe=In diesem Ordner wurde keine KeePass.exe gefunden. Bitte wählen Sie den KeePass-Ordner aus.
en.NoKeePassExe=No KeePass.exe was found in this folder. Please select the KeePass folder.
de.FinishHint=Starten Sie KeePass und öffnen Sie Ihre Datenbank. Beim ersten Verbinden zeigen KeePass und der Browser denselben sechsstelligen Code – bestätigen Sie ihn in KeePass.
en.FinishHint=Start KeePass and open your database. When connecting for the first time, KeePass and the browser show the same six-digit code – confirm it in KeePass.

de.StartKeePass=KeePass wieder starten
en.StartKeePass=Start KeePass again

de.AddToEdge=KeePassFerry in Microsoft Edge hinzufügen (öffnet die Store-Seite)
en.AddToEdge=Add KeePassFerry to Microsoft Edge (opens the store page)
de.AddToChrome=KeePassFerry in Google Chrome hinzufügen (öffnet die Store-Seite)
en.AddToChrome=Add KeePassFerry to Google Chrome (opens the store page)
de.AddToFirefox=KeePassFerry in Firefox hinzufügen (öffnet die Add-on-Seite)
en.AddToFirefox=Add KeePassFerry to Firefox (opens the add-on page)

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}\Plugins\KeePassFerry"; Flags: ignoreversion recursesubdirs

[Run]
; KeePass wieder starten, wenn es vor der Installation lief (auch beim stillen Update aus dem Plugin)
Filename: "{app}\KeePass.exe"; Description: "{cm:StartKeePass}"; Flags: postinstall nowait runasoriginaluser; Check: KeePassWasRunning
; Letzte Seite: je installiertem Browser ein Häkchen; öffnet die Store-Seite in genau diesem Browser (als normaler Benutzer)
Filename: "{code:BrowserExe|msedge}"; Parameters: """{#EdgeStoreUrl}"""; Description: "{cm:AddToEdge}"; Flags: postinstall nowait skipifsilent runasoriginaluser; Check: OfferBrowser('msedge', '{#EdgeStoreUrl}')
Filename: "{code:BrowserExe|chrome}"; Parameters: """{#ChromeStoreUrl}"""; Description: "{cm:AddToChrome}"; Flags: postinstall nowait skipifsilent runasoriginaluser; Check: OfferBrowser('chrome', '{#ChromeStoreUrl}')
Filename: "{code:BrowserExe|firefox}"; Parameters: """{#FirefoxStoreUrl}"""; Description: "{cm:AddToFirefox}"; Flags: postinstall nowait skipifsilent runasoriginaluser unchecked; Check: OfferBrowser('firefox', '{#FirefoxStoreUrl}')

[UninstallDelete]
Type: dirifempty; Name: "{app}\Plugins\KeePassFerry"

[Code]
var
  KeePassRunningAtStart: Boolean;
  PreviousUninstaller: String;

// Läuft KeePass.exe gerade? (WMI; bei Fehlern: nein)
function IsKeePassRunning: Boolean;
var
  Locator, Service, Processes: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''KeePass.exe''');
    Result := Processes.Count > 0;
  except
  end;
end;

// Deinstallationsprogramm einer früheren Installation (laut Registry), sonst leer
function RegisteredUninstaller: String;
var
  Key, Value: String;
begin
  Result := '';
  Key := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{6E0F2F4B-6C55-4B6E-9A8E-4E4C1F1E8A2D}_is1';
  if RegQueryStringValue(HKLM, Key, 'UninstallString', Value) or
     RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{6E0F2F4B-6C55-4B6E-9A8E-4E4C1F1E8A2D}_is1', 'UninstallString', Value) or
     RegQueryStringValue(HKCU, Key, 'UninstallString', Value) then
    Result := RemoveQuotes(Value);
end;

// Vor dem Beenden durch den Restart Manager merken, ob KeePass lief
function InitializeSetup: Boolean;
begin
  KeePassRunningAtStart := IsKeePassRunning;
  PreviousUninstaller := RegisteredUninstaller;
  Result := True;
end;

// Versionen bis 1.0.4 legten das Deinstallationsprogramm in den KeePass-Ordner (unins001.exe o. ä.).
// Nur genau dieses, laut Registry unser eigenes, wird entfernt; das von KeePass (unins000.exe) bleibt unberührt.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Old: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Old := PreviousUninstaller;
  if (Old = '') or (CompareText(Old, ExpandConstant('{uninstallexe}')) = 0) then Exit;
  if CompareText(RemoveBackslash(ExtractFileDir(Old)), RemoveBackslash(ExpandConstant('{app}'))) <> 0 then Exit;
  if Pos('unins', Lowercase(ExtractFileName(Old))) <> 1 then Exit;
  DeleteFile(Old);
  DeleteFile(ChangeFileExt(Old, '.dat'));
  DeleteFile(ChangeFileExt(Old, '.msg'));
end;

function KeePassWasRunning: Boolean;
begin
  Result := KeePassRunningAtStart;
end;

// KeePass-Ordner aus der Installation von KeePass (Inno-Setup-Eintrag von KeePass), sonst Standardpfad
function DefaultKeePassDir(Param: String): String;
var
  Dir: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KeePassPasswordSafe2_is1', 'InstallLocation', Dir) or
     RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\KeePassPasswordSafe2_is1', 'InstallLocation', Dir) or
     RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KeePassPasswordSafe2_is1', 'InstallLocation', Dir) then
    Result := RemoveBackslashUnlessRoot(Dir);
  if (Result = '') or not FileExists(AddBackslash(Result) + 'KeePass.exe') then
  begin
    if FileExists(ExpandConstant('{commonpf}\KeePass Password Safe 2\KeePass.exe')) then
      Result := ExpandConstant('{commonpf}\KeePass Password Safe 2')
    else if FileExists(ExpandConstant('{commonpf32}\KeePass Password Safe 2\KeePass.exe')) then
      Result := ExpandConstant('{commonpf32}\KeePass Password Safe 2')
    else
      Result := ExpandConstant('{commonpf}\KeePass Password Safe 2');
  end;
end;

// Pfad eines installierten Browsers über "App Paths" (msedge, chrome, firefox); leer, wenn nicht installiert
function BrowserExe(Name: String): String;
var
  Path: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\' + Name + '.exe', '', Path) or
     RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\' + Name + '.exe', '', Path) then
  begin
    Path := RemoveQuotes(Path);
    if FileExists(Path) then Result := Path;
  end;
end;

function OfferBrowser(Name, StoreUrl: String): Boolean;
begin
  Result := (StoreUrl <> '') and (BrowserExe(Name) <> '');
end;

procedure InitializeWizard;
begin
  WizardForm.SelectDirLabel.Caption := CustomMessage('SelectKeePassDir');
  WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 + CustomMessage('FinishHint');
end;

// Nur in einen Ordner mit KeePass.exe installieren
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectDir) and not FileExists(AddBackslash(WizardDirValue) + 'KeePass.exe') then
  begin
    MsgBox(CustomMessage('NoKeePassExe'), mbError, MB_OK);
    Result := False;
  end;
end;

// Beim Deinstallieren die Registrierung des Native-Messaging-Hosts (vom Plugin angelegt) entfernen
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Microsoft\Edge\NativeMessagingHosts\keepassferry');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Google\Chrome\NativeMessagingHosts\keepassferry');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Mozilla\NativeMessagingHosts\keepassferry');
    DeleteFile(ExpandConstant('{localappdata}\KeePassFerry\keepassferry.chromium.json'));
    DeleteFile(ExpandConstant('{localappdata}\KeePassFerry\keepassferry.firefox.json'));
  end;
end;
