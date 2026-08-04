; Instalador Windows do TaqCITi.
;
; Compila para um .exe único que embute o conteúdo de dist/ (build de
; produção da extensão) e, ao rodar, copia esses arquivos para uma pasta
; fixa na Área de Trabalho do usuário, copia o caminho para a área de
; transferência, abre o navegador padrão em chrome://extensions e abre o
; guia visual de instalação.
;
; Pré-requisito: rodar `npm run build` (na raiz do repo) ANTES de compilar
; este script, para que dist/ exista e esteja atualizada. Ver README.md
; nesta mesma pasta para o passo a passo completo com ISCC.exe.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "TaqCITi"
#define InstallFolderName "TaqCITi (não apagar)"

[Setup]
AppId={{A1F3C9B2-7D4E-4F1A-9C6E-3B2D8E4F1A70}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=TaqCITi
DefaultDirName={userdesktop}\{#InstallFolderName}
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
PrivilegesRequired=lowest
Uninstallable=no
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
OutputDir=..\..\release
OutputBaseFilename=taqciti-instalador-windows-{#AppVersion}

[Files]
; Conteúdo de dist/ (build de produção) — vai direto para a pasta final,
; sem nenhum arquivo auxiliar do instalador junto, para a pasta ficar
; idêntica ao que o Chrome espera em "Carregar sem compactação".
Source: "..\..\dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Template do guia visual — extraído só para {tmp} (Flags: dontcopy), nunca
; vai para {app}. É lido, tem o caminho de instalação injetado, e a cópia
; final é gravada em {localappdata}\TaqCITi\guide\ pelo [Code] abaixo.
Source: "..\guide\index.html"; DestDir: "{tmp}"; Flags: dontcopy

[Code]
function GetInstallPath(): String;
begin
  Result := ExpandConstant('{app}');
end;

{ Extrai o caminho do executável de dentro de uma string de comando de
  associação de URL/arquivo do Windows, que costuma vir como
  ""C:\caminho\app.exe" -- "%1"" ou, mais raramente, sem aspas. }
function ExtractExePath(const Cmd: String): String;
var
  S: String;
  P: Integer;
begin
  Result := '';
  S := Trim(Cmd);
  if S = '' then Exit;
  if S[1] = '"' then
  begin
    S := Copy(S, 2, Length(S) - 1);
    P := Pos('"', S);
    if P > 0 then
      Result := Copy(S, 1, P - 1)
    else
      Result := S;
  end
  else
  begin
    P := Pos(' ', S);
    if P > 0 then
      Result := Copy(S, 1, P - 1)
    else
      Result := S;
  end;
end;

{ Resolve o executável do navegador padrão do Windows via as chaves de
  associação de URL do usuário (mesmo mecanismo que "Abrir com" usa).
  Funciona para Chrome e qualquer navegador baseado em Chromium (Edge,
  Brave, Opera, Vivaldi), que entendem chrome://extensions nativamente. }
function GetDefaultBrowserExe(): String;
var
  ProgId, Cmd, ExePath: String;
  Found: Boolean;
begin
  Result := '';

  Found := RegQueryStringValue(HKCU,
    'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice',
    'ProgId', ProgId);
  if not Found then
    Found := RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice',
      'ProgId', ProgId);
  if not Found then Exit;

  Found := RegQueryStringValue(HKCR, ProgId + '\shell\open\command', '', Cmd);
  if not Found then
    Found := RegQueryStringValue(HKCU, 'Software\Classes\' + ProgId + '\shell\open\command', '', Cmd);
  if not Found then Exit;

  ExePath := ExtractExePath(Cmd);
  if (ExePath <> '') and FileExists(ExePath) then
    Result := ExePath;
end;

{ Abre uma URL (ou caminho de arquivo local) no navegador padrão. Se não
  conseguir resolver o navegador padrão, cai para o ShellExec genérico do
  Windows como melhor esforço — nunca interrompe a instalação. }
procedure OpenWithDefaultBrowser(const Target: String);
var
  BrowserExe: String;
  ResultCode: Integer;
begin
  BrowserExe := GetDefaultBrowserExe();
  if BrowserExe <> '' then
    Exec(BrowserExe, '"' + Target + '"', '', SW_SHOWNORMAL, ewNoWait, ResultCode)
  else
    ShellExec('open', Target, '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;

function JsEscape(const S: String): String;
var
  R: String;
begin
  R := S;
  StringChangeEx(R, '\', '\\', True);
  StringChangeEx(R, '"', '\"', True);
  Result := R;
end;

{ Lê o template do guia (bytes crus, UTF-8) e grava uma cópia com o
  placeholder __INSTALL_PATH__ substituído pelo caminho real, já escapado
  para caber dentro de uma string JS. Tudo em AnsiString/bytes crus para
  não passar pela conversão de code page do Windows e corromper acentos. }
procedure GenerateGuideWithPath(const SrcFile, DestFile, InstallPath: String);
var
  Content: AnsiString;
begin
  if not LoadStringFromFile(SrcFile, Content) then Exit;
  StringChangeEx(Content, '__INSTALL_PATH__', Utf8Encode(JsEscape(InstallPath)), True);
  SaveStringToFile(DestFile, Content, False);
end;

{ Copia o caminho de instalação para a área de transferência via
  PowerShell (presente por padrão em qualquer Windows 10/11). O caminho é
  escrito antes num arquivo temporário em UTF-8 para não depender de
  escapar acentos/parênteses na linha de comando. }
procedure CopyPathToClipboard(const PathValue: String);
var
  TempFile: String;
  Cmd: String;
  ResultCode: Integer;
begin
  TempFile := ExpandConstant('{tmp}\taqciti-install-path.txt');
  SaveStringToFile(TempFile, Utf8Encode(PathValue), False);
  Cmd := '-NoProfile -WindowStyle Hidden -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath ''' +
    TempFile + ''' | Set-Clipboard"';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Cmd, '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  InstallPath, GuideTemplate, GuideDestDir, GuideDest: String;
begin
  if CurStep = ssPostInstall then
  begin
    InstallPath := GetInstallPath();

    CopyPathToClipboard(InstallPath);

    ExtractTemporaryFile('index.html');
    GuideTemplate := ExpandConstant('{tmp}\index.html');
    GuideDestDir := ExpandConstant('{localappdata}\TaqCITi\guide');
    ForceDirectories(GuideDestDir);
    GuideDest := GuideDestDir + '\index.html';
    GenerateGuideWithPath(GuideTemplate, GuideDest, InstallPath);

    OpenWithDefaultBrowser('chrome://extensions');
    OpenWithDefaultBrowser(GuideDest);
  end;
end;
