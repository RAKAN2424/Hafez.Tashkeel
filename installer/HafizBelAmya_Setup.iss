; Inno Setup 6 Script for Hafiz Bel'Amya (Egyptian Studio Pro)
; Optional alternative if Inno Setup 6 (iscc.exe) is installed on Windows.

[Setup]
AppName=Hafiz Bel'Amya Studio
AppVersion=1.4.0
AppPublisher=Abdelrahman Amr
DefaultDirName=C:\HafizBelAmya
DefaultGroupName=Hafiz Bel'Amya Studio
OutputDir=..
OutputBaseFilename=HafizBelAmya-Inno-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Files]
Source: "..\*"; DestDir: "{app}"; Excludes: "node_modules\*,.venv\*,dist\*,.git\*,*.exe"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\models"

[Icons]
Name: "{group}\Hafiz Bel'Amya Studio"; Filename: "{app}\start_hafiz.bat"; WorkingDir: "{app}"
Name: "{group}\Models Folder"; Filename: "{app}\models"
Name: "{autodesktop}\Hafiz Bel'Amya Studio"; Filename: "{app}\start_hafiz.bat"; WorkingDir: "{app}"
Name: "{autodesktop}\Hafiz Models Folder"; Filename: "{app}\models"

[Run]
Filename: "{app}\Hafiz_Online_Setup.bat"; Description: "Download missing Node/Python/FFmpeg & CUDA AI backends from Internet now"; Flags: postinstall shellexec skipifsilent
Filename: "explorer.exe"; Parameters: """{app}\models"""; Description: "Open 'models' folder to drop your AI models inside"; Flags: postinstall nowait skipifsilent
