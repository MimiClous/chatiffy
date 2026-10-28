#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PackageDir
  #error PackageDir is required
#endif
[Setup]
AppId=Chatiffy
AppName=Chatiffy
AppVersion={#AppVersion}
AppPublisher=MimiClous
AppPublisherURL=https://github.com/MimiClous/chatiffy
DefaultDirName={localappdata}\Programs\Chatiffy
DefaultGroupName=Chatiffy
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
AppMutex=Local\Chatiffy.Desktop
UninstallDisplayIcon={app}\Chatiffy.exe
OutputDir=..\dist
OutputBaseFilename=Chatiffy-{#AppVersion}-windows-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\chatiffy.ico
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Chatiffy"; Filename: "{app}\Chatiffy.exe"
Name: "{autodesktop}\Chatiffy"; Filename: "{app}\Chatiffy.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Chatiffy.exe"; Description: "{cm:LaunchProgram,Chatiffy}"; Flags: nowait postinstall skipifsilent
[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Command: String;
begin
  if CurUninstallStep = usUninstall then
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Chatiffy', Command) then
      if CompareText(Command, '"' + ExpandConstant('{app}\Chatiffy.exe') + '" --autostart') = 0 then
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Chatiffy');
end;
