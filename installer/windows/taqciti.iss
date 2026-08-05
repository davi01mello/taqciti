; Instalador Windows do TaqCITi.
;
; Compila para um .exe único que embute o conteúdo de dist/ (build de
; produção da extensão) e, ao rodar, copia esses arquivos para uma pasta
; fixa na Área de Trabalho do usuário, copia o caminho para a área de
; transferência, abre o Google Chrome especificamente em
; chrome://extensions e abre o guia visual de instalação.
;
; Por que Chrome especificamente, e não "o navegador padrão": a extensão
; só funciona no Chrome (é carregada via chrome://extensions), então abrir
; "o navegador padrão" nunca fez sentido — e na prática quebrou: numa
; máquina com Edge como padrão, o Windows tentava resolver "chrome"
; genericamente e mostrava "não instalado, procure na Microsoft Store",
; mesmo com o Chrome de fato instalado. Ver FindChromeExe/InitializeSetup
; no [Code] abaixo. Se o Chrome não for encontrado, a instalação inteira é
; abortada antes de copiar qualquer arquivo (nenhuma extensão sem Chrome
; faz sentido pela metade).
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
var
  { Resolvido uma única vez em InitializeSetup e reaproveitado depois em
    CurStepChanged — se estivesse vazio nesse ponto, a instalação já
    teria sido abortada, então todo uso posterior pode supor que está
    preenchido. }
  ChromeExePath: String;

function GetInstallPath(): String;
begin
  Result := ExpandConstant('{app}');
end;

{ Localiza o executável do Google Chrome especificamente — não "o
  navegador padrão do Windows" (ver comentário no topo do arquivo sobre
  por que essa distinção importa). Ordem de busca, do mais para o menos
  confiável:
  1. Chave "App Paths" do Chrome em HKLM — instalação por máquina (todos
     os usuários), o caso mais comum.
  2. A mesma chave em HKCU — instalação só para o usuário atual.
  3. Caminhos fixos mais comuns, como último recurso, cobrindo instalações
     que por algum motivo não registraram a chave App Paths.

  Nota sobre a declaração: o Pascal Script do Inno Setup não suporta
  seção "const" local dentro de function/procedure — só "var" é permitido
  como bloco de declaração antes do "begin" (documentado em
  jrsoftware.org/ishelp/topic_scriptintro.htm: "No local const or type
  declarations. Only var and label blocks are allowed before begin.").
  Por isso AppPathsKey é var, atribuído logo no início do corpo, em vez
  de const — era exatamente isso que quebrava a compilação antes. }
function FindChromeExe(): String;
var
  ChromePath: String;
  AppPathsKey: String;
begin
  AppPathsKey := 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe';
  Result := '';

  if RegQueryStringValue(HKLM, AppPathsKey, '', ChromePath) and FileExists(ChromePath) then
  begin
    Result := ChromePath;
    Exit;
  end;

  if RegQueryStringValue(HKCU, AppPathsKey, '', ChromePath) and FileExists(ChromePath) then
  begin
    Result := ChromePath;
    Exit;
  end;

  ChromePath := ExpandConstant('{pf}\Google\Chrome\Application\chrome.exe');
  if FileExists(ChromePath) then
  begin
    Result := ChromePath;
    Exit;
  end;

  ChromePath := ExpandConstant('{pf32}\Google\Chrome\Application\chrome.exe');
  if FileExists(ChromePath) then
  begin
    Result := ChromePath;
    Exit;
  end;

  ChromePath := ExpandConstant('{localappdata}\Google\Chrome\Application\chrome.exe');
  if FileExists(ChromePath) then
  begin
    Result := ChromePath;
    Exit;
  end;
end;

{ Roda antes de qualquer página do assistente ou cópia de arquivo.
  Retornar False aqui aborta a instalação inteira imediatamente — nada é
  copiado, nenhuma pasta é criada. É o único lugar cedo o suficiente pra
  bloquear a instalação por completo se o Chrome não existir, em vez de
  descobrir isso só depois de já ter copiado tudo. }
function InitializeSetup(): Boolean;
begin
  ChromeExePath := FindChromeExe();
  if ChromeExePath = '' then
  begin
    MsgBox(
      'O Google Chrome não foi encontrado nesta máquina.' + #13#10 + #13#10 +
      'A extensão TaqCITi só funciona no Chrome (é carregada via ' +
      'chrome://extensions), então a instalação não pode continuar sem ele.' + #13#10 + #13#10 +
      'Instale o Chrome e rode este instalador de novo:' + #13#10 +
      'https://www.google.com/chrome/',
      mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
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
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    InstallPath := GetInstallPath();

    CopyPathToClipboard(InstallPath);

    { A pasta LocalAppData\TaqCITi\guide já existe neste ponto: o [Files]
      acima instala index.html ali durante a etapa de cópia de arquivos,
      que roda antes de ssPostInstall. }
    GuideDir := ExpandConstant('{localappdata}\TaqCITi\guide');
    WriteInstallPathScript(GuideDir, InstallPath);

    { ChromeExePath já foi resolvido (e validado) em InitializeSetup — se
      estivesse vazio, a instalação teria sido abortada antes de chegar
      aqui, então não precisa checar de novo.

      As duas URLs vão numa ÚNICA chamada Exec, não em duas separadas:
      com o Chrome ainda não aberto, dois "Exec(ChromeExePath, ...)"
      consecutivos (mesmo com ewNoWait) disparam dois processos chrome.exe
      que competem pra virar a instância principal — o que perde a
      corrida cai no seletor de perfil ("Quem está usando o Chrome?") em
      vez de abrir a URL pretendida. Isso foi reproduzido de verdade num
      teste manual. Passando as duas URLs como argumentos da mesma
      invocação, só um processo chrome.exe é iniciado, e ele abre as duas
      como abas da mesma janela — sem corrida nenhuma. }
    Exec(ChromeExePath,
      '"chrome://extensions" "' + GuideDir + '\index.html"',
      '', SW_SHOWNORMAL, ewNoWait, ResultCode);
  end;
end;
