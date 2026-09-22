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
-- `revogado_em` em vez de DELETE para a página Conexões poder mostrar
-- histórico ("revogado em tal dia") em vez de um sumiço silencioso.
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
