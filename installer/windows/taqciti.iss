; Instalador Windows do TaqCITi.
;
; Compila para um .exe único que embute o conteúdo de dist/ (build de
; produção da extensão) e, ao rodar, copia esses arquivos para uma pasta
; fixa na Área de Trabalho do usuário, copia o caminho para a área de
; transferência, e abre o guia visual de instalação no navegador
; escolhido. NÃO tenta abrir chrome://extensions/edge://extensions sozinho
; — ver o comentário em CurStepChanged no [Code] abaixo sobre por que isso
; foi removido (o navegador ignora esse esquema de URL quando vem via
; linha de comando de outro processo).
;
; A extensão roda tanto no Google Chrome quanto no Microsoft Edge (os dois
; são Chromium e aceitam "Carregar sem compactação" do mesmo jeito), então
; o instalador procura os dois (FindChromeExe/FindEdgeExe no [Code]
; abaixo). Se achar só um, usa esse direto, sem perguntar nada. Se achar os
; dois, pergunta numa página própria do assistente (BrowserChoicePage) —
; é a única interação manual que existe neste instalador, e só aparece
; quando há ambiguidade de verdade. Se não achar nenhum dos dois, a
; instalação inteira é abortada antes de copiar qualquer arquivo (a
; extensão não faz sentido pela metade sem um navegador Chromium pra
; carregá-la).
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
  { Resolvidos uma única vez em InitializeSetup. Ao contrário da versão
    anterior (só Chrome), um dos dois PODE estar vazio aqui — só os dois
    vazios ao mesmo tempo aborta a instalação (ver InitializeSetup). }
  ChromeExePath: String;
  EdgeExePath: String;
  { Resolvido em CurStepChanged(ssInstall), a partir dos dois acima e da
    escolha do usuário (se houve escolha) — é o que CurStepChanged
    (ssPostInstall) usa pra abrir o guia, no lugar do antigo ChromeExePath
    fixo. }
  BrowserExePath: String;
  { 'chrome' ou 'edge' — grava em window.TAQCITI_BROWSER (via
    WriteInstallPathScript) pra o guia saber com certeza qual navegador foi
    escolhido, sem precisar adivinhar pela navigator.userAgent. }
  BrowserKind: String;
  BrowserChoicePage: TWizardPage;
  ChromeRadio: TNewRadioButton;
  EdgeRadio: TNewRadioButton;

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

{ Mesma lógica de FindChromeExe, trocando só o executável e as pastas
  padrão — o Edge é Chromium e registra a própria chave "App Paths" do
  mesmo jeito que o Chrome. }
function FindEdgeExe(): String;
var
  EdgePath: String;
  AppPathsKey: String;
begin
  AppPathsKey := 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe';
  Result := '';

  if RegQueryStringValue(HKLM, AppPathsKey, '', EdgePath) and FileExists(EdgePath) then
  begin
    Result := EdgePath;
    Exit;
  end;

  if RegQueryStringValue(HKCU, AppPathsKey, '', EdgePath) and FileExists(EdgePath) then
  begin
    Result := EdgePath;
    Exit;
  end;

  // ATENÇÃO ao comentar constantes do Inno aqui: comentário de chaves NÃO
  // aninha, então um "{pf32}" dentro de um bloco { ... } fecha o comentário
  // no primeiro "}" e o resto da frase vira código. Foi exatamente o que
  // quebrou a compilação da v2.0.0 ("Unknown identifier 'costuma'"). Use
  // "//" em qualquer comentário que precise citar uma constante.
  //
  // O instalador oficial do Edge Stable é 32-bit mesmo em Windows 64-bit,
  // então {pf32} costuma ser o caminho de verdade — mas checa {pf} primeiro
  // porque instalações via MSI corporativo podem ir para lá.
  EdgePath := ExpandConstant('{pf}\Microsoft\Edge\Application\msedge.exe');
  if FileExists(EdgePath) then
  begin
    Result := EdgePath;
    Exit;
  end;

  EdgePath := ExpandConstant('{pf32}\Microsoft\Edge\Application\msedge.exe');
  if FileExists(EdgePath) then
  begin
    Result := EdgePath;
    Exit;
  end;

  EdgePath := ExpandConstant('{localappdata}\Microsoft\Edge\Application\msedge.exe');
  if FileExists(EdgePath) then
  begin
    Result := EdgePath;
    Exit;
  end;
end;

{ Roda antes de qualquer página do assistente ou cópia de arquivo.
  Retornar False aqui aborta a instalação inteira imediatamente — nada é
  copiado, nenhuma pasta é criada. É o único lugar cedo o suficiente pra
  bloquear a instalação por completo se nem Chrome nem Edge existirem, em
  vez de descobrir isso só depois de já ter copiado tudo. }
function InitializeSetup(): Boolean;
begin
  ChromeExePath := FindChromeExe();
  EdgeExePath := FindEdgeExe();
  if (ChromeExePath = '') and (EdgeExePath = '') then
  begin
    MsgBox(
      'Não encontramos o Google Chrome nem o Microsoft Edge nesta máquina.' + #13#10 + #13#10 +
      'A extensão TaqCITi precisa de um navegador baseado em Chromium ' +
      '(Chrome ou Edge) para funcionar, então a instalação não pode ' +
      'continuar sem um dos dois.' + #13#10 + #13#10 +
      'Instale um deles e rode este instalador de novo:' + #13#10 +
      'https://www.google.com/chrome/' + #13#10 +
      'https://www.microsoft.com/edge',
      mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;

{ Cria a página de escolha de navegador. Roda depois de InitializeSetup
  (ChromeExePath/EdgeExePath já resolvidos), então os dois Enabled abaixo
  já sabem o que existe de verdade na máquina. wpWelcome como âncora não
  importa muito — DisableWelcomePage tira essa página da fila, então esta
  é a primeira que o assistente mostra de qualquer forma (quando não é
  pulada, ver ShouldSkipPage). }
procedure InitializeWizard();
begin
  BrowserChoicePage := CreateCustomPage(wpWelcome,
    'Escolha o navegador',
    'O TaqCITi funciona no Google Chrome ou no Microsoft Edge. Qual dos dois você usa?');

  ChromeRadio := TNewRadioButton.Create(BrowserChoicePage);
  ChromeRadio.Parent := BrowserChoicePage.Surface;
  ChromeRadio.Caption := 'Google Chrome';
  ChromeRadio.Top := 0;
  ChromeRadio.Width := BrowserChoicePage.SurfaceWidth;
  ChromeRadio.Enabled := ChromeExePath <> '';
  ChromeRadio.Checked := ChromeExePath <> '';

  EdgeRadio := TNewRadioButton.Create(BrowserChoicePage);
  EdgeRadio.Parent := BrowserChoicePage.Surface;
  EdgeRadio.Caption := 'Microsoft Edge';
  EdgeRadio.Top := ChromeRadio.Top + ChromeRadio.Height + 8;
  EdgeRadio.Width := BrowserChoicePage.SurfaceWidth;
  EdgeRadio.Enabled := EdgeExePath <> '';
  { Só marca Edge de início se Chrome não existir — Chrome é o padrão
    quando os dois existem (menor mudança de comportamento pra quem já
    usava o instalador antes desta versão). }
  if (ChromeExePath = '') and (EdgeExePath <> '') then
    EdgeRadio.Checked := True;
end;

{ Pula a página de escolha quando não há escolha de verdade: só um dos
  dois foi encontrado (o outro Enabled := False não impediria o clique em
  "Avançar" sozinho, então pular a página de propósito é o que mantém o
  instalador silencioso no caso comum de hoje — só Chrome instalado). Se
  nenhum dos dois existisse, InitializeSetup já teria abortado antes de
  chegar aqui. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = BrowserChoicePage.ID then
    Result := (ChromeExePath = '') or (EdgeExePath = '');
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
procedure WriteInstallPathScript(const DestDir, InstallPath, BrowserKindValue: String);
var
  ScriptContent: AnsiString;
begin
  ScriptContent := 'window.TAQCITI_INSTALL_PATH = "' +
    Utf8Encode(JsEscape(InstallPath)) + '";' + #13#10 +
    { O guia (installer/guide/index.html) usa isto pra saber com certeza
      qual navegador vai abrir — mais confiável que adivinhar pela
      navigator.userAgent, porque é exatamente o navegador que o Exec
      abaixo está prestes a abrir, escolhido pelo usuário ou resolvido
      sozinho quando só um existia. }
    'window.TAQCITI_BROWSER = "' + Utf8Encode(JsEscape(BrowserKindValue)) + '";';
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
  if CurStep = ssInstall then
  begin
    { Resolvido aqui, cedo, e reaproveitado em ssPostInstall abaixo. Os
      dois radio buttons só existem de verdade (não nil) quando a página
      não foi pulada — ShouldSkipPage já garante isso: ela só pula quando
      um dos dois caminhos está vazio, e nesse caso o if/else abaixo nem
      olha pros radios. }
    if (ChromeExePath <> '') and (EdgeExePath <> '') then
    begin
      if EdgeRadio.Checked then
      begin
        BrowserExePath := EdgeExePath;
        BrowserKind := 'edge';
      end
      else
      begin
        BrowserExePath := ChromeExePath;
        BrowserKind := 'chrome';
      end;
    end
    else if EdgeExePath <> '' then
    begin
      BrowserExePath := EdgeExePath;
      BrowserKind := 'edge';
    end
    else
    begin
      BrowserExePath := ChromeExePath;
      BrowserKind := 'chrome';
    end;
  end;

  if CurStep = ssPostInstall then
  begin
    InstallPath := GetInstallPath();

    CopyPathToClipboard(InstallPath);

    { A pasta LocalAppData\TaqCITi\guide já existe neste ponto: o [Files]
      acima instala index.html ali durante a etapa de cópia de arquivos,
      que roda antes de ssPostInstall. }
    GuideDir := ExpandConstant('{localappdata}\TaqCITi\guide');
    WriteInstallPathScript(GuideDir, InstallPath, BrowserKind);

    { BrowserExePath já foi resolvido em ssInstall, a partir de caminhos
      validados em InitializeSetup — não precisa checar de novo.

      Só abrimos o guia aqui — NÃO tentamos mais abrir chrome://extensions
      (ou edge://extensions) via Exec. Em testes manuais reais, com
      abordagens de código diferentes, o guia sempre abriu certo, mas o
      esquema de URL interno do navegador nunca abriu. Isso não é bug do
      nosso Exec: o navegador parece filtrar/ignorar essas URLs quando
      recebidas como argumento de linha de comando de um processo
      externo, por segurança. Não tem workaround confiável — o guia
      instrui a pessoa a abrir uma aba nova e colar o endereço (já
      copiado por um botão dedicado), em vez de prometer que a aba abre
      sozinha. }
    Exec(BrowserExePath, '"' + GuideDir + '\index.html"', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
  end;
end;
