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

; Guia visual — copiado bytes-a-bytes pelo próprio instalador do Inno (sem
; passar pelo Pascal Script) para uma pasta separada e persistente, fora da
; pasta "não apagar" da extensão. Fica intocado: o caminho de instalação é
; injetado à parte, num arquivo install-path.js escrito do zero pelo
; [Code] abaixo — assim o HTML (com acentos e emoji em UTF-8) nunca
; precisa ser lido de volta e regravado em Pascal Script.
Source: "..\guide\index.html"; DestDir: "{localappdata}\TaqCITi\guide"; Flags: ignoreversion

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

{ Escreve, do zero, um arquivinho JS com o caminho real de instalação —
  não lê nem reescreve o guia (index.html), que é copiado bytes-a-bytes
  pelo [Files] acima, fora do Pascal Script.

  Por que não reaproveitar StringChangeEx/Copy/Pos para editar o HTML
  direto: a assinatura real de StringChangeEx é "function StringChangeEx
  (var S: String; const FromStr, ToStr: String; ...)" — "var S: String"
  exige o tipo IDÊNTICO no chamador (parâmetro var não tem conversão
  implícita), então passar um "Content: AnsiString" ali era exatamente o
  "Type mismatch" que o ISCC acusou. Isso por si só teria um conserto
  simples (usar um Content: String). O problema mais sério é que, mesmo
  corrigindo isso, tanto StringChangeEx quanto a própria doc de Copy
  ("function Copy(S: AnyString...): String") sugerem que o resultado pode
  passar por String (Unicode) mesmo quando a entrada é AnsiString — o que
  reintroduziria a conversão via code page do Windows que o uso de
  AnsiString em LoadStringFromFile/SaveStringToFile existe justamente para
  evitar, corrompendo acentos e o emoji de aviso (⚠️) do guia. Escrever um
  arquivo novo, pequeno, só com bytes ASCII + o caminho já em UTF-8
  (concatenados com "+", que em AnsiString é anexação de bytes crua, sem
  Copy/Pos no meio) evita esse risco por completo. }
procedure WriteInstallPathScript(const DestDir, InstallPath: String);
var
  ScriptContent: AnsiString;
begin
  ScriptContent := 'window.TAQCITI_INSTALL_PATH = "' +
    Utf8Encode(JsEscape(InstallPath)) + '";';
  SaveStringToFile(DestDir + '\install-path.js', ScriptContent, False);
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
  InstallPath, GuideDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    InstallPath := GetInstallPath();

    CopyPathToClipboard(InstallPath);

    { {localappdata}\TaqCITi\guide já existe neste ponto: o [Files] acima
      instala index.html ali durante a etapa de cópia de arquivos, que
      roda antes de ssPostInstall. }
    GuideDir := ExpandConstant('{localappdata}\TaqCITi\guide');
    WriteInstallPathScript(GuideDir, InstallPath);

    OpenWithDefaultBrowser('chrome://extensions');
    OpenWithDefaultBrowser(GuideDir + '\index.html');
  end;
end;
