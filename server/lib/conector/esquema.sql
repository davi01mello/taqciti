-- O acervo, no Postgres.
--
-- Aplicado inteiro, do zero ou por cima de si mesmo: todo comando é
-- `if not exists`. Não há framework de migração e não precisa haver enquanto
-- o schema couber numa tela — o servidor já evita dependência que rende uma
-- linha (ver o cabeçalho de `vitest.config.mts`), e um framework para cinco
-- tabelas seria mais máquina do que trabalho. Quando a primeira alteração
-- destrutiva aparecer, é aqui que se troca de estratégia.
--
-- ── Duas decisões que valem explicação ─────────────────────────────────────
--
-- 1. O CONTEÚDO É JSONB, não tabelas normalizadas.
--
--    A alternativa era uma tabela `fala` com (pessoa_id, reuniao_id, ordem,
--    falante, texto). Ela só se paga se alguém consultar falas isoladamente —
--    e ninguém consulta: todo acesso é "me dá a reunião", porque quem fatia é
--    `conteudo`, em memória, para poder aplicar o orçamento. Normalizar
--    custaria um join e uma ordenação para reconstruir o que já estava
--    pronto.
--
-- 2. A BUSCA É SOBRE TEXTO JÁ DOBRADO PELA APLICAÇÃO, com a configuração
--    `simple`.
--
--    O caminho óbvio seria `to_tsvector('portuguese', …)` com a extensão
--    `unaccent`. Não é o que está aqui, por uma razão de correção: o
--    ranqueamento fino roda em TypeScript (`busca.ts`), porque é ele que
--    devolve a POSIÇÃO do acerto — e nenhum índice de texto do Postgres
--    devolve isso. O banco é só peneira grossa.
--
--    Para a peneira ser segura, ela não pode descartar nada que o
--    ranqueamento aceitaria. Isso exige que os dois lados dobrem acento do
--    MESMO jeito e casem com a MESMA semântica. Duas implementações de
--    "tirar acento" (a de `dobrar()` e a do `unaccent`) concordando para
--    sempre é uma aposta; uma implementação só, usada dos dois lados, é um
--    fato. Então quem escreve grava `texto_busca` já passado por `dobrar()`,
--    e aqui só se tokeniza.
--
--    `simple` e não `portuguese` pelo mesmo motivo: o stemmer casaria
--    "deployamos" com "deploy", que o ranqueamento em TypeScript não casa.
--    Peneira mais larga que o ranqueamento é desperdício inofensivo; mais
--    estreita é resultado sumindo sem ninguém ver.

-- Nenhuma extensão é necessária: `gen_random_uuid()` é do núcleo desde o
-- PostgreSQL 13, e a busca não usa `unaccent` de propósito (ver acima). Isso
-- não é economia à toa — é o que permite o esquema rodar igual no Postgres
-- gerenciado do Railway e no PGlite dos testes, onde extensão é limitada.

-- ---------------------------------------------------------------- pessoas

-- Uma pessoa do CITi.
--
-- A chave é `google_sub`, não o e-mail: `sub` é o identificador estável que o
-- Google emite por conta, e o e-mail pode mudar (casamento, troca de alias,
-- mudança de domínio). Chavear por e-mail transformaria uma renomeação de
-- conta em perda de acervo.
create table if not exists pessoa (
  id          uuid primary key default gen_random_uuid(),
  google_sub  text        not null unique,
  email       text        not null,
  nome        text,
  criada_em   timestamptz not null default now(),
  vista_em    timestamptz not null default now()
);

-- O que a Claude/o ChatGPT apresentam para provar de quem é o acervo.
--
-- Guardamos o HASH, nunca o token — mesma regra de senha, e pelo mesmo
-- motivo: um vazamento do banco não pode virar acesso ao acervo de ninguém.
-- Revogar apaga a linha. `revogado_em` sobra de quando revogar só marcava;
-- nada mais escreve nele, e a leitura ainda ignora as linhas antigas marcadas.
create table if not exists token_do_conector (
  id           uuid primary key default gen_random_uuid(),
  pessoa_id    uuid        not null references pessoa(id) on delete cascade,
  hash         text        not null unique,
  rotulo       text,
  criado_em    timestamptz not null default now(),
  usado_em     timestamptz,
  revogado_em  timestamptz
);

create index if not exists token_por_pessoa on token_do_conector (pessoa_id);

-- ----------------------------------------------------------------- acervo

-- A chave primária é (pessoa_id, id) em todas as coleções: o `id` vem da
-- extensão (o `meetingId`, o id do documento) e só é único DENTRO de uma
-- pessoa. Chave global colidiria entre duas instalações, e a colisão
-- apareceria como a reunião de alguém aparecendo no acervo de outro.

create table if not exists reuniao (
  pessoa_id      uuid   not null references pessoa(id) on delete cascade,
  id             text   not null,
  titulo         text   not null,
  inicio_ms      bigint not null,
  duracao_s      integer not null,
  participantes  jsonb  not null default '[]'::jsonb,
  falas          jsonb  not null default '[]'::jsonb,
  texto_busca    text   not null default '',
  busca          tsvector generated always as (to_tsvector('simple', texto_busca)) stored,
  atualizada_em  timestamptz not null default now(),
  primary key (pessoa_id, id)
);

create table if not exists documento (
  pessoa_id      uuid   not null references pessoa(id) on delete cascade,
  id             text   not null,
  titulo         text   not null,
  texto          text   not null default '',
  criado_ms      bigint not null,
  atualizado_ms  bigint not null,
  tipo_gerado    text,
  reuniao_id     text,
  texto_busca    text   not null default '',
  busca          tsvector generated always as (to_tsvector('simple', texto_busca)) stored,
  atualizado_em  timestamptz not null default now(),
  primary key (pessoa_id, id)
);

create table if not exists conversa (
  pessoa_id      uuid   not null references pessoa(id) on delete cascade,
  id             text   not null,
  titulo         text   not null,
  criada_ms      bigint not null,
  atualizada_ms  bigint not null,
  mensagens      jsonb  not null default '[]'::jsonb,
  reuniao_id     text,
  texto_busca    text   not null default '',
  busca          tsvector generated always as (to_tsvector('simple', texto_busca)) stored,
  atualizada_em  timestamptz not null default now(),
  primary key (pessoa_id, id)
);

-- `id` é o id da reunião: existe no máximo uma nota por reunião.
-- `reuniao_titulo` é desnormalizado de propósito — a nota precisa ser legível
-- sozinha num resultado de busca, e a reunião pode nem estar sincronizada.
create table if not exists nota (
  pessoa_id       uuid   not null references pessoa(id) on delete cascade,
  id              text   not null,
  reuniao_id      text   not null,
  reuniao_titulo  text   not null,
  texto           text   not null default '',
  atualizada_ms   bigint not null,
  marcacoes       jsonb  not null default '{}'::jsonb,
  prints          integer not null default 0,
  texto_busca     text   not null default '',
  busca           tsvector generated always as (to_tsvector('simple', texto_busca)) stored,
  atualizada_em   timestamptz not null default now(),
  primary key (pessoa_id, id)
);

-- Os índices de texto. GIN porque a consulta é `@@`, e o acervo é
-- reescrito por sincronização inteira — leitura domina folgadamente.
create index if not exists reuniao_busca   on reuniao   using gin (busca);
create index if not exists documento_busca on documento using gin (busca);
create index if not exists conversa_busca  on conversa  using gin (busca);
create index if not exists nota_busca      on nota      using gin (busca);

-- Ordenar o índice por data é o caminho de `listar`, e ele é sempre por
-- pessoa. Índice composto, com a data já descendente.
create index if not exists reuniao_por_data   on reuniao   (pessoa_id, inicio_ms desc);
create index if not exists documento_por_data on documento (pessoa_id, criado_ms desc);
create index if not exists conversa_por_data  on conversa  (pessoa_id, criada_ms desc);
create index if not exists nota_por_data      on nota      (pessoa_id, atualizada_ms desc);

-- ------------------------------------------------ histórico dos documentos

-- O histórico de versões de um documento PERSONALIZADO (a árvore de cada
-- revisão), espelhado da extensão como backup. Uma linha por documento, com as
-- versões num jsonb: a extensão já guarda assim, no máximo 30, e o diff dela
-- manda o documento inteiro quando uma versão nova entra.
--
-- `id` é o id do documento na extensão (único só DENTRO de uma pessoa). Não há
-- chave estrangeira para `documento`: o histórico pode chegar antes do texto
-- na mesma sincronização, e apagar um é decisão separada do outro.
--
-- O conector MCP não lê esta tabela, e o histórico não é exposto à
-- IA. RLS ligada como nas demais (ver o fim do arquivo) — o servidor acessa pelo papel que a ignora,
-- e a chave pública do Supabase não alcança nada aqui.
create table if not exists historico_do_documento (
  pessoa_id      uuid    not null references pessoa(id) on delete cascade,
  id             text    not null,
  variante       text,
  fontes_ids     jsonb   not null default '[]'::jsonb,
  versoes        jsonb   not null default '[]'::jsonb,
  revisao_atual  integer not null,
  atualizado_ms  bigint  not null,
  atualizado_em  timestamptz not null default now(),
  primary key (pessoa_id, id)
);

alter table historico_do_documento enable row level security;

-- ------------------------------------------------- a cópia fiel (restauração)

-- As tabelas acima guardam a PROJEÇÃO magra que o conector serve para a IA
-- (sem prints, sem os ids das marcações, sem o html dos documentos...). Ela não
-- basta para reconstruir o storage de uma máquina nova. Esta tabela guarda o
-- registro INTEIRO como a extensão o tem, por (coleção, id), para outra máquina
-- da mesma conta trazer tudo de volta. O conector MCP NÃO lê esta tabela.
--
-- `apagado` é a lápide: apagar numa máquina precisa chegar às outras, e uma
-- linha que simplesmente some não diz nada a quem pergunta "o que mudou?".
--
-- `seq` é o cursor da leitura incremental. É uma sequência, e não o relógio,
-- porque duas escritas no mesmo milissegundo (ou um relógio que anda para
-- trás entre instâncias) fariam a leitura pular linhas sem ninguém ver. Cada
-- escrita, inclusive a lápide, ganha um `seq` novo e maior.
create sequence if not exists copia_seq;

create table if not exists copia_local (
  pessoa_id      uuid    not null references pessoa(id) on delete cascade,
  colecao        text    not null,
  id             text    not null,
  corpo          jsonb,
  apagado        boolean not null default false,
  marca_ms       bigint  not null default 0,
  seq            bigint  not null default nextval('copia_seq'),
  atualizado_em  timestamptz not null default now(),
  primary key (pessoa_id, colecao, id)
);

create index if not exists copia_por_seq on copia_local (pessoa_id, seq);

alter table copia_local enable row level security;

-- O histórico de versões também volta para a máquina nova, pelo mesmo cursor.
alter table historico_do_documento add column if not exists seq bigint not null default nextval('copia_seq');
create index if not exists historico_por_seq on historico_do_documento (pessoa_id, seq);
-- --------------------------------------------- prints, cotas e orçamento

-- Os PRINTS da aba da reunião, como binário (`bytea`): o base64 da extensão
-- cresce um terço, e a imagem (JPEG) não comprime. Imutáveis: um print nunca é
-- editado, só criado e apagado — por isso o upsert não precisa comparar nada.
-- Lápide (`apagado`, `bytes` nulo) pelo mesmo motivo de `copia_local`. O
-- conector MCP NÃO lê esta tabela: uma captura de tela é dezenas de milhares de
-- tokens (ver `tipos.ts`).
create table if not exists print_local (
  pessoa_id      uuid    not null references pessoa(id) on delete cascade,
  id             text    not null,
  reuniao_id     text    not null default '',
  mime           text    not null default 'image/jpeg',
  bytes          bytea,
  tamanho        integer not null default 0,
  largura        integer not null default 0,
  altura         integer not null default 0,
  em_ms          bigint  not null default 0,
  apagado        boolean not null default false,
  seq            bigint  not null default nextval('copia_seq'),
  atualizado_em  timestamptz not null default now(),
  primary key (pessoa_id, id)
);

create index if not exists print_por_seq on print_local (pessoa_id, seq);

alter table print_local enable row level security;

-- `tamanho` é o tamanho LÓGICO (bytes do JSON, ou da imagem). Serve a duas
-- coisas sem tocar no conteúdo: a cota por pessoa, e cortar a página da volta
-- sem buscar o corpo de tudo só para medir.
alter table copia_local add column if not exists tamanho integer not null default 0;
alter table historico_do_documento add column if not exists tamanho integer not null default 0;
update copia_local set tamanho = octet_length(corpo::text) where tamanho = 0 and corpo is not null;
update historico_do_documento set tamanho = octet_length(versoes::text) where tamanho = 0;

-- A limpeza de lápides varre por data; o índice parcial só cobre as lápides.
create index if not exists copia_lapide on copia_local (atualizado_em) where apagado;
create index if not exists print_lapide on print_local (atualizado_em) where apagado;

-- ------------------------------------------------------- uso das rotas de IA

-- Quantas chamadas a modelo cada pessoa fez no dia, e quantos caracteres
-- mandou. É a cota de `lib/cotaDeIa.ts`: sem ela, uma conta (ou um script com o
-- token de alguém) chama o modelo pago em laço até a conta do provedor secar.
-- Uma linha por (pessoa, dia), incrementada por upsert; não precisa de limpeza
-- frequente — são poucas dezenas de bytes por pessoa por dia.
create table if not exists uso_de_ia (
  pessoa_id   uuid    not null references pessoa(id) on delete cascade,
  dia         date    not null,
  chamadas    integer not null default 0,
  caracteres  bigint  not null default 0,
  primary key (pessoa_id, dia)
);

-- ----------------------------------------------------------- RLS em todas

-- O servidor fala com o banco pelo papel dono das tabelas, que ignora RLS. Quem
-- NÃO pode alcançar nada é a Data API da Supabase (PostgREST), que atende a
-- chave pública `anon` — e com RLS ligada e nenhuma policy, ela não lê nem
-- escreve linha nenhuma. Em produção isto já estava ligado à mão; aqui fica
-- versionado, para um banco recriado a partir deste arquivo nascer fechado.
alter table pessoa            enable row level security;
alter table token_do_conector enable row level security;
alter table reuniao           enable row level security;
alter table documento         enable row level security;
alter table conversa          enable row level security;
alter table nota              enable row level security;
alter table uso_de_ia         enable row level security;

-- E, por cima, nenhum privilégio para os papéis da Data API. Os papéis só
-- existem na Supabase: no PGlite dos testes e num Postgres local o bloco não faz
-- nada.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end
$$;