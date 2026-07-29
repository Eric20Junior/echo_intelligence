; Windows installer. Built by scripts/build-installer-windows.js, which fills in
; the version and paths below via /D defines, so nothing here is hardcoded to one
; release.
;
; Why an installer at all, when install.ps1 already works: install.ps1 is a
; one-line paste into PowerShell. That's fine for a developer and wrong for the
; person this app is actually for — a church volunteer, who will find the app on
; a web page and click Download. A downloaded .zip creates no shortcuts and
; leaves them hunting inside folders for an .exe; a downloaded .exe installer is
; the only artifact that behaves the way they already expect software to behave.

#define AppName "Echo Intelligence"
#define AppPublisher "Echo Intelligence"
#define AppExeName "echo-intelligence.exe"

; Passed in by the build script: MyAppVersion, SourceDir, OutputDir, OutputName.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
; A stable, never-reused GUID is what lets a later version upgrade this install
; in place (same key in Add/Remove Programs) instead of stacking a second copy
; beside it. Generated once for this app; do not regenerate.
AppId={{B4F2A6E1-3C7D-4E58-9A21-8D6F0C5B7E43}
AppName={#AppName}
AppVersion={#MyAppVersion}
AppVerName={#AppName} {#MyAppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#MyAppVersion}

; Per-user install, deliberately. `lowest` means no UAC prompt and no admin
; password — the operator installing this on a church PC very often isn't an
; administrator of it, and an elevation prompt they can't satisfy ends the
; install right there. The cost is one copy per Windows profile, which is the
; right trade for a single-operator booth machine.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

; The app writes nothing inside its own install folder (see backend/lib/paths.js
; — log.db, config.json and downloaded models all live in %USERPROFILE%\
; .echo-intelligence), so the install tree can sit in Program Files read-only.
; That's what makes the line above safe.
UninstallDisplayIcon={app}\bin\{#AppExeName}
UninstallDisplayName={#AppName} {#MyAppVersion}

OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SourceDir={#SourceDir}
SetupIconFile={#IconFile}

; LZMA2/max over the default: the payload is ~360MB, dominated by an ONNX
; runtime and a Node binary, and squeezing the download matters more than build
; time here — people install this over church wifi.
Compression=lzma2/max
SolidCompression=yes

; The app is 64-bit only (the SEA executable is a copied 64-bit node.exe, and
; better-sqlite3/onnxruntime ship x64/arm64 prebuilts), so refuse 32-bit Windows
; up front with a clear message rather than installing something that can't run.
ArchitecturesAllowed=x64compatible arm64
ArchitecturesInstallIn64BitMode=x64compatible arm64

WizardStyle=modern
DisableWelcomePage=no
LicenseFile=
; Skips the "ready to install" confirmation page. There are no options to
; review — one destination, one shortcut choice — so it's a click that asks
; nothing.
DisableReadyPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; The whole dist/ tree, preserving layout: lib/paths.js resolves data/ and
; public/ as siblings of bin/, so flattening or nesting this any differently
; breaks path resolution at runtime (see that file's header comment).
Source: "*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Both shortcuts target the .exe directly, which means launching shows a console
; window. That is deliberate and matches install.ps1: the window is the
; operator's stop button ("close it to quit") and the only place a startup error
; is visible. The app opens the operator page in the browser itself
; (backend/lib/open-browser.js).
;
; WorkingDir is bin\ for the same reason the exe is run from there manually —
; relative asset resolution is anchored to the executable's folder.
Name: "{group}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; Comment: "Live scripture detection for church services"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; Comment: "Live scripture detection for church services"; Tasks: desktopicon

[Run]
Description: "Start {#AppName} now"; Filename: "{app}\bin\{#AppExeName}"; WorkingDir: "{app}\bin"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Nothing in {app} is written at runtime, so this is only about the folder
; itself: Inno removes the files it installed but leaves the directory if
; anything unexpected remains. The operator's data in %USERPROFILE%\
; .echo-intelligence is deliberately NOT deleted — that's their detection
; history and API keys, and an uninstall (often just a reinstall's first half)
; must not silently destroy it.
Type: dirifempty; Name: "{app}\bin"
Type: dirifempty; Name: "{app}"
