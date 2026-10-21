; KeePassFerry – Installationsprogramm für das KeePass-Plugin (Inno Setup 6)
; Baut die Release-Action: iscc /DAppVersion=1.2.3 /DSourceDir=..\release\KeePassFerry installer\KeePassFerry.iss
; Kopiert das Plugin nach <KeePass>\Plugins\KeePassFerry. KeePass wird über den Restart Manager beendet und
; danach wieder gestartet. Beim Deinstallieren werden auch die Native-Messaging-Einträge des Plugins entfernt.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\release\KeePassFerry"
#endif

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
RestartApplications=yes
OutputDir=..\release
OutputBaseFilename=KeePassFerry-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\branding\keepassferry.ico
UninstallDisplayIcon={app}\Plugins\KeePassFerry\KeePassFerryHost.exe
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

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}\Plugins\KeePassFerry"; Flags: ignoreversion recursesubdirs

[UninstallDelete]
Type: dirifempty; Name: "{app}\Plugins\KeePassFerry"

[Code]
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
