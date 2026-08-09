
(function(){
  var canvas = document.getElementById('bg');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // rastro do quadro anterior: em vez de um preto chapado, um degradê vertical
  // construído a partir do Azul Escuro e do Roxo Escuro da paleta. Montado UMA vez
  // por resize — dentro do loop custaria o mesmo que uma cor sólida.
  var fadeGrad = null;
  function buildFade(){
    fadeGrad = ctx.createLinearGradient(0,0,0,innerHeight);
    fadeGrad.addColorStop(0.00, 'rgba(13,5,30,0.16)');    // roxo quase preto
    fadeGrad.addColorStop(0.50, 'rgba(6,2,16,0.16)');     // quase preto na altura da faixa
    fadeGrad.addColorStop(1.00, 'rgba(15,6,34,0.16)');    // roxo quase preto
  }

  function resize(){
    var dpr = Math.min(window.devicePixelRatio||1, 1.5);
    canvas.width = innerWidth*dpr;
    canvas.height = innerHeight*dpr;
    canvas.style.width = innerWidth+'px';
    canvas.style.height = innerHeight+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    buildFade();
  }
  window.addEventListener('resize', resize);
  resize();

  var mouse = { x: innerWidth/2, y: innerHeight/2, active:false, speed:0, lastX:innerWidth/2, lastY:innerHeight/2 };
  window.addEventListener('mousemove', function(e){
    var dx = e.clientX-mouse.lastX, dy = e.clientY-mouse.lastY;
    mouse.speed = Math.min(1, Math.hypot(dx,dy)/28); // 0..1
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    mouse.x=e.clientX; mouse.y=e.clientY; mouse.active=true;
  });
  window.addEventListener('mouseleave', function(){ mouse.active=false; });
  window.addEventListener('touchmove', function(e){
    if(e.touches[0]){ mouse.x=e.touches[0].clientX; mouse.y=e.touches[0].clientY; mouse.active=true; }
  }, {passive:true});

  // ---- PRNG determinístico a partir de uma "semente" ----
  // Em produção: seed = hash(transcript_da_reuniao). Aqui, uma frase de exemplo fixa.
  function hashString(str){ var h=0; for(var i=0;i<str.length;i++){ h = (Math.imul(31,h) + str.charCodeAt(i))|0; } return h; }
  function mulberry32(seed){
    return function(){
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed>>>15, 1 | seed);
      t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }
  var demoTranscript = "pauta: alinhar roadmap do trimestre e riscos do lancamento";
  var rand = mulberry32(hashString(demoTranscript));

  // ---- camada 1: fragmentos literais da reunião, digitando e dissolvendo em loop ----
  // Em produção: cada frase viria de trechos reais da transcrição, não deste pool fixo.
  var phrasesPool = [
    "alinhar roadmap do trimestre   ",
    "riscos do lancamento em producao   ",
    "proxima reuniao marcada pra sexta   ",
    "ata gerada automaticamente   ",
    "quem fica responsavel pelo followup   ",
    "pontos em aberto da sprint   ",
    "decisao tomada em conjunto   ",
    "revisar prazo com o time   ",
    "ficou definido que seguimos com a proposta   ",
    "levantar dependencias com o time de dados   ",
    "orcamento aprovado para a fase dois   ",
    "duvida registrada para a proxima daily   ",
    "cliente pediu ajuste no escopo   ",
    "validar hipotese antes de codar   ",
    "retrospectiva marcada para quinta   ",
    "bloqueio resolvido durante a call   ",
    "acordado prazo de duas semanas   ",
    "priorizar o que gera valor primeiro   ",
    "ninguem levantou objecao ao plano   ",
    "ficou de mandar o documento hoje   ",
    "checar integracao antes do deploy   ",
    "escopo fechado, sem mudanca ate sexta   ",
    "time de design entra na semana que vem   ",
    "metrica combinada: retencao em trinta dias   ",
    "sem novidades no lado do fornecedor   ",
    "decidimos adiar a migracao do banco   ",
    "feedback do usuario chegou positivo   ",
    "reduzir o tempo de resposta da api   ",
    "documentar a decisao na ata   ",
    "alinhamento rapido antes do almoco   ",
    "proposta enviada aguardando retorno   ",
    "revisao de codigo pendente desde ontem   ",
    "combinado ponto de checagem na quarta   "
  ];
  ctx.font = "14px 'SF Mono', 'Menlo', 'Consolas', monospace";

  // densidade proporcional à área: um número fixo vira parede em tela estreita
  var LINE_COUNT = Math.round(Math.min(88, Math.max(24, innerWidth*innerHeight/16000)));
  var typedLines = [];
  for(var i=0;i<LINE_COUNT;i++){
    var text = phrasesPool[Math.floor(rand()*phrasesPool.length)];
    typedLines.push({
      padded: text + " · ",
      y: 40 + rand()*(innerHeight-80),
      travelX: rand()*innerWidth*1.3 - 220, // espalhados por toda a jornada já de saída
      speed: 14 + rand()*22, // px/s viajando pra direita
      charsPerSec: 5 + rand()*4,
      windowChars: 16 + Math.floor(rand()*14),
      phaseOffset: rand()*40,
      wanderRange: 8 + rand()*14,
      wanderSpeed: 0.1 + rand()*0.15
    });
  }
  // ordena por altura e intercala as cores — garante azul e laranja espalhados
  // em toda a tela (topo incluído), em vez de depender só da sorte do random
  // as frases tangenciam TODA a paleta. Ordena por altura e percorre as cores em
  // ciclo: garante que nenhuma cor fique concentrada numa faixa da tela.
  // `boost` compensa a luminância — o roxo precisa de mais alpha que o branco
  // para ler com o mesmo peso sobre o fundo escuro.
  var LINE_COLORS = [
    {rgb:[255,255,255], boost:0.85},  // Branco
    {rgb:[ 80,122,230], boost:1.30},  // Azul CITi
    {rgb:[ 80,230,120], boost:0.95},  // Verde CITi
    {rgb:[125, 26,215], boost:1.85},  // Roxo CITi
    {rgb:[217,217,217], boost:0.90},  // Cinza claro
    {rgb:[119,189,232], boost:1.05}   // Azul ciano
  ];
  function paintLine(line, idx){
    var c = LINE_COLORS[idx % LINE_COLORS.length];
    line.ci = idx % LINE_COLORS.length;
    line.hue = c.rgb; line.boost = c.boost;
  }
  typedLines.sort(function(a,b){ return a.y-b.y; });
  typedLines.forEach(paintLine);
  function respawnLine(line){
    line.travelX = -220 - rand()*200;
    line.y = 40 + rand()*(innerHeight-80);
    line.padded = phrasesPool[Math.floor(rand()*phrasesPool.length)] + " · ";
    line.speed = 14 + rand()*22;
    paintLine(line, line.ci+1);   // troca de cor ao renascer: a mistura nunca congela
  }

  // ---- espectro espelhado em grãos finos — presente por TODA a largura o tempo ----
  // ---- todo (base orgânica), o mouse só acrescenta em cima, clique explode local ----
  var BAR_W = 5;
  var MAX_H = 32;            // era 52 — repouso muito mais contido
  var barCount = Math.ceil(innerWidth/BAR_W)+2;
  var barSeeds = [];
  var barState = []; // altura suavizada por barra — dá inércia, evita "pular"
  var barVel = [];   // velocidade por barra — mola real, permite ultrapassagem
  for(var b=0;b<barCount;b++){ barSeeds.push(rand()); barState.push(0); barVel.push(0); }
  function grainRand(a,b){
    var v = Math.sin(a*127.1 + b*311.7)*43758.5453123;
    return v - Math.floor(v);
  }
  // tabela de grão pré-calculada — evita milhares de Math.sin/Math.random por frame
  var GRAIN_N = 2048;
  var grainTable = new Float32Array(GRAIN_N);
  for(var gi=0; gi<GRAIN_N; gi++){ grainTable[gi] = rand(); }

  // ---- wavelet de Ricker pré-tabelado: (1-2u²)·e^(-u²). É a forma de um pulso
  // acústico — crista no centro e DOIS vales atrás/à frente. É o que faz o pacote
  // viajante ler como onda de som e não como um morrinho deslizando.
  var RICKER_N = 96, RICKER_MAX = 2.6;
  var rickerLUT = new Float32Array(RICKER_N+1);
  for(var rk=0; rk<=RICKER_N; rk++){
    var ru = rk/RICKER_N*RICKER_MAX, ruu = ru*ru;
    rickerLUT[rk] = (1-2*ruu)*Math.exp(-ruu);
  }

  // ---- cores pré-computadas: montar 'rgba(...)' por pixel obriga o navegador a
  // reinterpretar a cor milhares de vezes por frame. Quantizamos o alpha em 32
  // níveis (imperceptível) e reaproveitamos as strings prontas.
  var ALPHA_LEVELS = 32;
  function buildColorTable(r,g,b){
    var arr = new Array(ALPHA_LEVELS);
    for(var i=0;i<ALPHA_LEVELS;i++){ arr[i] = 'rgba('+r+','+g+','+b+','+(i/(ALPHA_LEVELS-1)).toFixed(3)+')'; }
    return arr;
  }
  // ONDA — metade de cima: Roxo CITi. Metade de baixo: Verde CITi.
  // O roxo #7D1AD7 tem luminância baixa (~0.18) contra o verde (~0.66): pintado
  // literal, a metade de cima sumiria. O corpo usa um roxo levantado em valor
  // (mesmo matiz, ~275°) para as duas metades pesarem igual; o hex exato segue
  // nos acentos de CSS, nos anéis de clique e como base da crista.
  var topBody = buildColorTable(148,58,252);   // Roxo CITi levantado
  var botBody  = buildColorTable(94,255,142);  // Verde CITi puxado pro brilho
  // crista: 8 tons de rim × 32 alphas, pré-montados — agora bem mais claros que o
  // corpo, que é o que produz a leitura de neon (corpo saturado / crista lavada)
  var RIM_LEVELS = 8;
  var topCrest = [], botCrest = [];
  for(var ri=0; ri<RIM_LEVELS; ri++){
    var rimV = ri/(RIM_LEVELS-1);
    // crista roxa: lavanda -> lavanda clara (NÃO branco: senão o topo da onda
    // lava e a leitura vira 'branco com tinta roxa' em vez de roxo neon)
    topCrest.push(buildColorTable(96+((rimV*62)|0), 18+((rimV*88)|0), 255));
    // crista verde: menta -> menta clara
    botCrest.push(buildColorTable(36+((rimV*112)|0), 255, 112+((rimV*84)|0)));
  }
  // brasas e grãos soltos: tabelas próprias (novas cores entram por buildColorTable)
  // halo: as cores mais saturadas do conjunto — é o que colore o bloom
  var topGlow = buildColorTable(88,10,255);
  var botGlow = buildColorTable(24,255,104);
  var topEmber = buildColorTable(148,54,255);    // brasas roxas (metade de cima)
  var botEmber  = buildColorTable(58,255,138);   // brasas verdes (metade de baixo)
  function aIdx(a){ var i=(a*(ALPHA_LEVELS-1))|0; return i<0?0:(i>ALPHA_LEVELS-1?ALPHA_LEVELS-1:i); }

  // silhueta base: frequências deliberadamente NÃO múltiplas entre si e fases que
  // derivam em velocidades diferentes — sem harmônicos exatos, o perfil nunca cai
  // num padrão que o olho reconheça como repetido.
  var DRIFT = 0.0022;
  var driftPhase = 0;
  function baseSilhouette(bi, t){
    var ts = t*0.001;
    // três "planos" correndo em velocidades distintas: o relevo se recombina sozinho
    var p1 = bi - driftPhase;
    var p2 = bi - driftPhase*0.63;
    var p3 = bi - driftPhase*1.37;
    var v = Math.sin(p1*0.0417 + ts*0.110)
          + Math.sin(p2*0.1063 + 1.7 + ts*0.073)*0.62
          + Math.sin(p3*0.2291 + 3.1 - ts*0.041)*0.33
          + Math.sin(p1*0.0187 + 5.2 + ts*0.026)*0.52
          + Math.sin(p2*0.3407 + 2.3 + ts*0.090)*0.22
          + Math.sin(p3*0.0731 + 4.4 - ts*0.017)*0.41
          + (barSeeds[bi]-0.5)*0.5;
    var n = (v/3.35 + 0.34);
    if(n<0) n=0;
    // n^2 * 1.9 — multiplicação em vez de pow
    n = n*n*1.9;
    // dentes rápidos por cima, em duas frequências incomensuráveis
    var d1 = Math.sin(p1*0.53); if(d1<0) d1=-d1;
    var d2 = Math.sin(p3*0.87); if(d2<0) d2=-d2;
    n += (d1*0.035 + d2*0.018)*n;

    // ZONAS: regiões da tela ficam temporariamente mais ativas que outras e migram
    // devagar pro lado — a faixa deixa de respirar em uníssono
    var zr = (Math.sin(bi*0.0089 - ts*0.047) + Math.sin(bi*0.0034 + 2.1 + ts*0.029))*0.5;
    var zone = 0.62 + 0.38*(zr*0.5 + 0.5);

    // micro-irregularidade barra a barra (fixa) + uma camada que troca bem devagar,
    // pra o contorno nunca ficar matematicamente liso
    var micro = 0.92 + grainTable[(bi*13)&(GRAIN_N-1)]*0.16;
    var micro2 = 0.92 + grainTable[((bi*7) + ((t*0.0007)|0))&(GRAIN_N-1)]*0.16;

    var breath = 0.90 + Math.sin(t*0.00019)*0.10;
    return Math.max(0.025, n) * zone * micro * micro2 * breath;
  }

  window.addEventListener('resize', function(){
    barCount = Math.ceil(innerWidth/BAR_W)+2;
    while(barSeeds.length < barCount){ barSeeds.push(rand()); barState.push(0); barVel.push(0); }
  });

  // ---- camada 3: clique = anel de choque + erupção de partículas; se cair perto
  // do espectro, injeta também um ESTILHAÇO de espinhos concentrado no ponto ----
  var ripplesClick = [];
  var bursts = [];

  // ---- brasas: pool fixo. Nenhuma alocação durante o clique, teto de vivos garantido.
  var MAX_EMBERS = 1200;
  var embers = new Array(MAX_EMBERS);
  for(var em0=0; em0<MAX_EMBERS; em0++){
    embers[em0] = {x:0,y:0,vx:0,vy:0,life:0,decay:1,warm:true,size:1};
  }
  var emberCursor = 0;
  function spawnEmber(x,y,vx,vy,decay,warm,size){
    var e = embers[emberCursor];
    emberCursor = (emberCursor+1)%MAX_EMBERS;
    e.x=x; e.y=y; e.vx=vx; e.vy=vy; e.life=1; e.decay=decay; e.warm=warm; e.size=size;
  }

  // ---- grãos permanentes que se desprendem da crista (sem clique) ----
  var MAX_MOTES = 1300;
  var motes = new Array(MAX_MOTES);
  for(var mo0=0; mo0<MAX_MOTES; mo0++){
    motes[mo0] = {x:0,y:0,vx:0,vy:0,life:0,decay:1,warm:true,size:1};
  }
  var moteCursor = 0;
  function spawnMote(x,y,vx,vy,decay,warm,size){
    var m = motes[moteCursor];
    moteCursor = (moteCursor+1)%MAX_MOTES;
    m.x=x; m.y=y; m.vx=vx; m.vy=vy; m.life=1; m.decay=decay; m.warm=warm; m.size=size;
  }

  // ---- perfil de ESTILHAÇO: pico central altíssimo e estreito + espinhos satélites
  // com posição/altura/decaimento derivados de grainTable. Montado UMA vez no clique,
  // consumido como tabela dentro do loop de desenho (nada de random por frame).
  var SPIKE_N = 11;
  function buildSpikes(seedIdx){
    var off = new Float32Array(SPIKE_N);
    var hgt = new Float32Array(SPIKE_N);
    var wid = new Float32Array(SPIKE_N);
    var dec = new Float32Array(SPIKE_N);
    off[0] = 0; hgt[0] = 7.5; wid[0] = 1.30; dec[0] = 0.0; // agulha central
    for(var i=1;i<SPIKE_N;i++){
      var g1 = grainTable[(seedIdx + i*17)&(GRAIN_N-1)];
      var g2 = grainTable[(seedIdx + i*29 + 5)&(GRAIN_N-1)];
      var g3 = grainTable[(seedIdx + i*41 + 11)&(GRAIN_N-1)];
      var side = (i&1) ? 1 : -1;
      var step = 1.6 + ((i/2)|0)*2.5 + g1*2.2;   // afastamento em barras
      off[i] = side*step;
      var fall = Math.exp(-step/5.2);            // decaimento lateral agressivo
      hgt[i] = (0.55 + g2*2.1)*fall*0.62;   // satélites bem abaixo da agulha
      wid[i] = 0.85 + g3*1.15;                   // largura de poucas barras
      dec[i] = 0.35 + g3*1.5;                    // cada espinho colapsa no seu tempo
    }
    return {off:off, hgt:hgt, wid:wid, dec:dec};
  }

  // ---- DECOMPOSIÇÃO: o impacto não fica parado no ponto. Ele se quebra em
  // componentes que saem viajando pros DOIS lados, e — como em meio dispersivo —
  // cada componente corre a uma velocidade diferente:
  //   agudos  = estreitos, rápidos, morrem cedo   (vão na frente)
  //   graves  = largos, lentos, duram             (chegam depois, mais gordos)
  // Um único clique vira, ao longo de ~3s, um pente que se abre pros dois lados.
  var SHARD_N = 22;        // 11 pares (esquerda/direita)
  var SHARD_ATTEN = 150;   // barras: comprimento de atenuação espacial
  function buildShards(seedIdx){
    var dir = new Float32Array(SHARD_N);
    var spd = new Float32Array(SHARD_N);
    var amp = new Float32Array(SHARD_N);
    var wid = new Float32Array(SHARD_N);
    var dec = new Float32Array(SHARD_N);
    var del = new Float32Array(SHARD_N);
    var HALF = (SHARD_N>>1) - 1;
    for(var i=0;i<SHARD_N;i++){
      var g1 = grainTable[(seedIdx + i*23 + 3)&(GRAIN_N-1)];
      var g2 = grainTable[(seedIdx + i*53 + 17)&(GRAIN_N-1)];
      var g3 = grainTable[(seedIdx + i*37 + 29)&(GRAIN_N-1)];
      var g4 = grainTable[(seedIdx + i*61 + 41)&(GRAIN_N-1)];
      var band = (i>>1)/HALF;                 // 0 = grave, 1 = agudo
      dir[i] = (i&1) ? 1 : -1;                // par vai pra esquerda, ímpar pra direita
      spd[i] = 42 + band*168 + g1*34;         // barras/s  (210 a 1220 px/s)
      wid[i] = 5.2 - band*3.7 + g2*1.0;       // barras
      amp[i] = (1.05 - band*0.48) * (0.55 + g3*0.80);
      dec[i] = 0.30 + band*0.72 + g4*0.34;    // agudo morre antes, mas não cedo demais
      del[i] = band*0.05 + g2*0.03;           // saem quase juntas, mas não em uníssono
    }
    return {dir:dir, spd:spd, amp:amp, wid:wid, dec:dec, del:del};
  }

  // campo do clique por barra: montado UMA vez por quadro (bursts × componentes ×
  // só as barras que cada componente toca) em vez de barras × bursts. Muito mais
  // barato agora que a energia percorre a tela inteira.
  var burstField = new Float32Array(Math.ceil(innerWidth/BAR_W)+2);
  window.addEventListener('resize', function(){
    if(burstField.length < barCount) burstField = new Float32Array(barCount+8);
  });

  var BURST_GAIN = 1.7;   // era 2.2 no original; 1.5 na versão anterior
  var BURST_LIFE = 3.6;   // s — precisa durar até o componente mais lento cruzar a tela

  window.addEventListener('click', function(e){
    if(e.target.closest('.pill') || e.target.closest('.popover')) return; // não duplica sobre botões
    ripplesClick.push({x:e.clientX, y:e.clientY, start:performance.now(), rings:3});
    var onRibbon = Math.abs(e.clientY-ribbonY) < 160;

    if(onRibbon){
      // clique na onda: estilhaço de espinhos + JATO vertical espelhado de brasas
      // (cima âmbar, baixo ciano), como se a crista tivesse arrebentado
      var seedIdx = ((e.clientX*7 + e.clientY*13 + (performance.now()|0))|0) & (GRAIN_N-1);
      bursts.push({
        barIndex: Math.round(e.clientX/BAR_W),
        start: performance.now(),
        spikes: buildSpikes(seedIdx),
        shards: buildShards(seedIdx)
      });
      // cada burst agora varre a tela inteira; segura o custo se clicarem em rajada
      while(bursts.length > 5) bursts.shift();
      var nj = 165 + Math.floor(rand()*70);   // era 64–90
      for(var j=0;j<nj;j++){
        var up = j%2===0;
        var spreadAng = (rand()-0.5)*0.85; // leque estreito, não explosão radial
        var spd = 130 + rand()*300;
        spawnEmber(
          e.clientX + (rand()-0.5)*20,
          ribbonY + (up?-6:6),
          Math.sin(spreadAng)*spd*0.55,
          (up?-1:1)*Math.cos(spreadAng)*spd,
          0.85+rand()*0.85,
          up,
          0.7+rand()*1.0                      // menores = leitura mais nítida
        );
      }
    } else {
      // erupção radial padrão
      var n = 130 + Math.floor(rand()*55);    // era 48–68
      for(var i2=0;i2<n;i2++){
        var ang = rand()*Math.PI*2;
        var spd2 = 60 + rand()*300;
        spawnEmber(
          e.clientX, e.clientY,
          Math.cos(ang)*spd2, Math.sin(ang)*spd2,
          0.5+rand()*0.6,
          rand()<0.5,
          0.7+rand()*1.0
        );
      }
    }
  });

  // posição do espectro: recalculada a partir do espaço real entre o título e os botões
  var ribbonY = innerHeight*0.5;
  function updateRibbonY(){
    var h1 = document.querySelector('.hero h1');
    var actions = document.querySelector('.actions');
    if(!h1 || !actions) return;
    var r1 = h1.getBoundingClientRect();
    var r2 = actions.getBoundingClientRect();
    ribbonY = (r1.bottom + r2.top)/2;
  }
  window.addEventListener('resize', updateRibbonY);
  updateRibbonY();

  // ---- poeira de fundo (sparkles fixos, piscando devagar) ----
  var sparkles = [];
  for(var sp=0; sp<38; sp++){
    sparkles.push({ x: rand()*innerWidth, y: rand()*innerHeight, phase: rand()*Math.PI*2, speed: 0.3+rand()*0.5 });
  }

  var sparkBuckets = [];
  var sparkColors = [];
  for(var sc=0; sc<8; sc++){
    sparkBuckets.push([]);
    sparkColors.push('rgba(205,228,252,'+(0.15+sc/8*0.35).toFixed(3)+')');
  }

  var vitality = 0;
  var mouseSpeedSmooth = 0;
  var wake = [];
  // buckets SEPARADOS por metade: as duas deixaram de ser espelhadas, então
  // cada uma precisa da sua própria altura, do seu próprio grão e da sua própria
  // lista de retângulos. Stride 4 (x,y,w,h) em vez do par interleaved de antes.
  var bodyBucketsT = [], bodyBucketsB = [], glowBucketsT = [], glowBucketsB = [];
  var crestBucketsT = [], crestBucketsB = [];
  for(var bkA=0; bkA<ALPHA_LEVELS; bkA++){
    bodyBucketsT.push([]); bodyBucketsB.push([]);
    glowBucketsT.push([]); glowBucketsB.push([]);
  }
  for(var bkR=0; bkR<RIM_LEVELS; bkR++){
    var rowT = [], rowB = [];
    for(var bkA2=0; bkA2<ALPHA_LEVELS; bkA2++){ rowT.push([]); rowB.push([]); }
    crestBucketsT.push(rowT); crestBucketsB.push(rowB);
  }
  // buckets das partículas: mesma estratégia de lote do espectro
  var emberSegW = [], emberSegC = [], emberDotW = [], emberDotC = [];
  for(var ebk=0; ebk<ALPHA_LEVELS; ebk++){
    emberSegW.push([]); emberSegC.push([]); emberDotW.push([]); emberDotC.push([]);
  }
  // ---- textura: LINHAS HORIZONTAIS, não grade ----
  // O retângulo tem a largura cheia da barra (rw = BAR_W), então barras vizinhas
  // se tocam e as fileiras correm contínuas pela tela. O vão fica só ENTRE as
  // fileiras. Antes havia vão nos dois eixos e o resultado era uma malha
  // quadriculada, que é exatamente o que fazia a onda parecer tecido e não sinal.
  var GAP = 4;       // vão escuro separando as duas metades
  var PX = 3.2;      // passo vertical entre fileiras
  var RH = 1.9;      // espessura da fileira -> 1.3px de vão, legível como scanline
  var CREST_FRAC = 0.62;
  var RIM_SCALE = 1/(1-CREST_FRAC);

  function emitHalf(up, h, bi, rx){
    var steps = (h/PX)|0;
    if(steps<1) return;
    var inv = 1/steps;
    var gBase = bi*37;
    var crestStart = (steps*CREST_FRAC)|0;
    var dir = up ? -1 : 1;
    var bodyB  = up ? bodyBucketsT  : bodyBucketsB;
    var crestB = up ? crestBucketsT : crestBucketsB;
    var dim    = up ? 1 : 0.70;   // metade de baixo recolhida, como na referência

    // CORPO PREENCHIDO com degradê vertical: quase nada junto do centro,
    // quase cheio na borda externa. É esse degradê que dá massa à onda —
    // antes o corpo era chapado e fraco, e só a crista aparecia.
    for(var k=0;k<crestStart;k++){
      var rel = k*inv;
      var u = rel/CREST_FRAC;
      var a = (0.03 + u*u*0.80) * (((k&1)===0) ? 1 : 0.82) * dim;
      if(a<0.02) continue;
      // falhas ocasionais: as fileiras viram tracejado em vez de linha cheia
      if(grainTable[(gBase+k*13)&(GRAIN_N-1)] < 0.085) continue;
      var gy = GAP + rel*h;
      var ai = (a*31)|0; if(ai>31) ai=31;
      bodyB[ai].push(rx, ribbonY + dir*gy, BAR_W, RH);
    }
    // crista: faixa fina e quente na borda externa
    for(var k2=crestStart;k2<steps;k2++){
      var rel2 = k2*inv;
      var rim = (rel2-CREST_FRAC)*RIM_SCALE;
      if(rim>1) rim=1; if(rim<0) rim=0;
      if(grainTable[(gBase+k2*7+3)&(GRAIN_N-1)] < rim*rim*0.42) continue; // esfarela só a ponta
      var a2 = (0.58 + rim*0.40) * (((k2&1)===0) ? 1 : 0.80) * dim;
      var gy2 = GAP + rel2*h;
      var rIdx = (rim*(RIM_LEVELS-1))|0; if(rIdx>RIM_LEVELS-1) rIdx=RIM_LEVELS-1;
      var ai2 = (a2*31)|0; if(ai2>31) ai2=31;
      crestB[rIdx][ai2].push(rx, ribbonY + dir*gy2, BAR_W, RH);
    }
  }

  // serra da metade de BAIXO: acompanha a deriva, então a dentição viaja junto
  // com o relevo em vez de ficar cravada na tela
  function botJag(bi){
    var q = bi - driftPhase;
    var a = Math.sin(q*0.71);      if(a<0) a=-a;
    var b2 = Math.sin(q*2.13);     if(b2<0) b2=-b2;   // dente por barra
    var c2 = Math.sin(q*1.09+2.1); if(c2<0) c2=-c2;
    return 0.46 + a*0.30 + b2*0.30 + c2*0.22;
  }

  function flushBucket(rects, color){
    if(rects.length===0) return;
    ctx.fillStyle = color;
    for(var i=0;i<rects.length;i+=4){ ctx.fillRect(rects[i],rects[i+1],rects[i+2],rects[i+3]); }
  }

  // ---- parâmetros de interação (ajuste fino aqui) ----
  var VIT_RANGE   = 190;  // era ~340 — raio VERTICAL de ativação
  var PROX_RANGE  = 125;  // era 140 — raio HORIZONTAL, estreito de propósito
  var HOVER_GAIN  = 2.6;  // era 0.85
  var SPEED_GAIN  = 1.6;  // era 0.7
  var WAKE_GAIN   = 1.8;  // era 0.9
  var AMBIENT_CAP = 4.2;  // era 1.9

  var lastT = null;
  function frame(t){
    if(lastT===null) lastT = t;
    var dt = Math.min(0.05, (t-lastT)/1000);
    lastT = t;

    ctx.fillStyle = fadeGrad;
    ctx.fillRect(0,0,innerWidth,innerHeight);

    // texto viajando da esquerda pra direita: nasce legível, vai virando linha fina
    // e morre no extremo direito — comportamento orgânico, não um fade estático
    ctx.textBaseline = 'middle';
    typedLines.forEach(function(line){
      line.travelX += line.speed*dt;
      if(line.travelX > innerWidth+250) respawnLine(line);

      var progress = Math.max(0, line.travelX/innerWidth);
      var letterAlphaScale = progress<0.6 ? 1 : Math.max(0, 1-(progress-0.6)/0.28);
      var lineAlphaScale = progress<0.5 ? 0 : Math.min(1,(progress-0.5)/0.25);
      var edgeKill = progress>0.94 ? Math.max(0,1-(progress-0.94)/0.09) : 1;

      var elapsed = t/1000 + line.phaseOffset;
      var globalIndex = Math.floor(elapsed * line.charsPerSec);
      var period = line.padded.length;
      var startIdx = Math.max(0, globalIndex - line.windowChars);
      var wander = Math.sin(elapsed*line.wanderSpeed)*line.wanderRange;
      var drawY = line.y + wander;
      var cx = line.travelX;
      var winStartX = cx, winEndX = cx;

      if(letterAlphaScale > 0.02){
        // desenha em 4 blocos de opacidade em vez de 1 fillText por letra —
        // corta ~80% das chamadas de desenho mantendo o degradê da janela
        var BLOCKS = 4;
        var total = globalIndex-startIdx;
        var perBlock = Math.ceil(total/BLOCKS);
        for(var bIdx=0; bIdx<BLOCKS; bIdx++){
          var from = startIdx + bIdx*perBlock;
          var to = Math.min(globalIndex, from+perBlock);
          if(from>=to) continue;
          var chunk = '';
          for(var k=from;k<to;k++){ chunk += line.padded[((k % period) + period) % period]; }
          var fade = (bIdx+0.5)/BLOCKS;
          var alpha = (0.022 + fade*0.105) * letterAlphaScale * edgeKill * line.boost;
          ctx.fillStyle = 'rgba('+line.hue[0]+','+line.hue[1]+','+line.hue[2]+','+alpha+')';
          ctx.fillText(chunk, cx + (from-startIdx)*8.4, drawY);
        }
        cx += total*8.4;
        winEndX = cx;
      } else {
        winEndX = cx + line.windowChars*8.4;
      }

      if(lineAlphaScale > 0.02){
        ctx.strokeStyle = 'rgba('+line.hue[0]+','+line.hue[1]+','+line.hue[2]+','+(lineAlphaScale*0.10*edgeKill*line.boost)+')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(winStartX, drawY);
        ctx.lineTo(winEndX, drawY);
        ctx.stroke();
      }
    });

    // espectro em grãos — base orgânica presente em toda a largura, mouse acrescenta,
    // clique explode local. Suavizado por barra: propagação visível, não instantânea.
    // velocidade do cursor decai quando ele para de se mover
    mouse.speed *= 0.90;
    mouseSpeedSmooth += (mouse.speed-mouseSpeedSmooth)*0.2;

    // vitalidade: SEM PISO. Longe da faixa o cursor não existe pra onda — ela segue
    // viva só pela silhueta ambiente. Curva íngreme: liga/desliga perto da faixa.
    var distToRibbon = mouse.active ? Math.abs(mouse.y-ribbonY) : 9999;
    var vRaw = 1 - distToRibbon/VIT_RANGE;
    if(vRaw<0) vRaw=0;
    var vitalityTarget = vRaw*vRaw*Math.sqrt(vRaw); // ~vRaw^2.5
    vitality += (vitalityTarget-vitality)*0.10;
    if(vitality < 0.002) vitality = 0;

    // a deriva acelera com a energia: onda alta corre mais rápido que onda em repouso
    var energy = vitality;
    for(var eb=0; eb<bursts.length; eb++){
      energy += Math.exp(-((t-bursts[eb].start)/1000)*0.95)*0.8;
    }
    driftPhase += dt*(18 + Math.min(4.5, energy)*46);

    // folga real até a borda mais próxima (a faixa é espelhada, vale a menor)
    var headroom = Math.min(ribbonY, innerHeight-ribbonY) - GAP - 6;
    var maxInfluence = Math.max(6, headroom/MAX_H);
    // joelho: acima dele a altura comprime de forma assintótica em vez de ser
    // cortada. Corte reto empilharia dezenas de barras na MESMA altura e a agulha
    // viraria um bloco de topo chapado; assim o perfil do estilhaço se preserva.
    var softKnee = maxInfluence*0.80;
    var kneeSpan = maxInfluence - softKnee;

    // buckets de retângulos por nível de cor — preenchidos no loop, desenhados
    // em lote depois (uma troca de cor por bucket em vez de uma por pixel)
    for(var ci=0; ci<ALPHA_LEVELS; ci++){
      bodyBucketsT[ci].length = 0; bodyBucketsB[ci].length = 0;
      glowBucketsT[ci].length = 0; glowBucketsB[ci].length = 0;
      for(var cr=0; cr<RIM_LEVELS; cr++){
        crestBucketsT[cr][ci].length = 0; crestBucketsB[cr][ci].length = 0;
      }
    }

    // rastro: pontos por onde o cursor passou continuam agitados por um instante.
    // Só registra quando o cursor está de fato perto da faixa — longe, nada acontece.
    if(mouse.active && vitality > 0.05 && mouseSpeedSmooth > 0.06){
      wake.push({x:mouse.x, energy:Math.min(1,mouseSpeedSmooth), born:t});
      if(wake.length>26) wake.shift();
    }
    wake = wake.filter(function(w){ return (t-w.born) < 900; });

    // sub-passos da mola: com rigidez alta no burst, um passo de 24ms explodiria
    var sub = dt > 0.034 ? 3 : (dt > 0.017 ? 2 : 1);
    var sdt = dt/sub;

    // semente de frame pros grãos da crista (determinístico, sem Math.random)
    var moteSeed = (t*0.037)|0;

    // ---- CAMPO DO CLIQUE: estilhaço parado no ponto + decomposição viajando ----
    if(burstField.length < barCount) burstField = new Float32Array(barCount+8);
    if(bursts.length){
      for(var zf=0; zf<barCount; zf++) burstField[zf] = 0;
      for(var bj=0; bj<bursts.length; bj++){
        var bu = bursts[bj];
        var age = (t-bu.start)*0.001;
        if(age > BURST_LIFE) continue;
        var cBar = bu.barIndex;

        // (1) estilhaço: fica no ponto, colapso violento nos primeiros ~300ms
        var env = 0.72*Math.exp(-age*5.20) + 0.28*Math.exp(-age*0.9);
        var sp3 = bu.spikes;
        for(var si2=0; si2<SPIKE_N; si2++){
          var hSp = sp3.hgt[si2]*env*Math.exp(-age*sp3.dec[si2]);
          if(hSp < 0.004) continue;
          var wSp = sp3.wid[si2] + age*1.7;      // alarga devagar conforme assenta
          var cSp = cBar + sp3.off[si2];
          var loS = Math.ceil(cSp-wSp), hiS = Math.floor(cSp+wSp);
          if(loS<0) loS=0; if(hiS>barCount-1) hiS=barCount-1;
          for(var xs=loS; xs<=hiS; xs++){
            var ds = xs-cSp; if(ds<0) ds=-ds;
            var us = 1-ds/wSp;
            burstField[xs] += hSp*us*us;
          }
        }

        // (2) decomposição: pacotes de Ricker correndo pros dois lados, cada um
        // na sua velocidade. O vale do wavelet cava um sulco escuro em volta da
        // crista viajante — é o que dá leitura de ONDA, não de vulto deslizando.
        var sh = bu.shards;
        for(var qi=0; qi<SHARD_N; qi++){
          var sAge = age - sh.del[qi];
          if(sAge <= 0) continue;
          var pos = sAge*sh.spd[qi];
          var aSh = sh.amp[qi]
                  * (1-Math.exp(-sAge/0.13))            // ataque: sobem depois da agulha
                  * Math.exp(-sAge*sh.dec[qi])
                  * Math.exp(-pos/SHARD_ATTEN);
          if(aSh < 0.004) continue;
          var wSh = sh.wid[qi]*(1 + sAge*0.35);  // o pacote se alarga ao viajar
          var reach = wSh*RICKER_MAX;
          var cSh = cBar + sh.dir[qi]*pos;
          var loQ = Math.ceil(cSh-reach), hiQ = Math.floor(cSh+reach);
          if(loQ<0) loQ=0; if(hiQ>barCount-1) hiQ=barCount-1;
          if(loQ>hiQ) continue;
          var scale = RICKER_N/(wSh*RICKER_MAX);
          for(var xq=loQ; xq<=hiQ; xq++){
            var dq = xq-cSh; if(dq<0) dq=-dq;
            var iq = (dq*scale)|0;
            if(iq > RICKER_N) continue;
            burstField[xq] += aSh*rickerLUT[iq];
          }
        }
      }
    }

    for(var bi=0; bi<barCount; bi++){
      var bx = bi*BAR_W;
      var dxm = bx-mouse.x;
      // influência local estreita e concentrada — a onda se puxa pro cursor
      var proximity = (mouse.active && vitality>0) ? Math.max(0, 1 - Math.abs(dxm)/PROX_RANGE) : 0;
      var hoverInfluence = proximity*proximity*Math.sqrt(proximity)*vitality; // ^2.5

      var wakeInfluence = 0;
      if(vitality > 0.02){
        for(var wi=0; wi<wake.length; wi++){
          var w = wake[wi];
          var wd = bx-w.x;
          if(wd>90 || wd<-90) continue;
          var wAge = (t-w.born)/900;
          wakeInfluence += (1-wAge)*(1-(wd<0?-wd:wd)/90)*w.energy*0.30;
        }
      }

      // estilhaço + onda viajante já resolvidos no campo, uma leitura só
      var burstInfluence = bursts.length ? burstField[bi] : 0;

      // fina e quase parada em repouso; encorpa MUITO quando o cursor chega perto.
      // Velocidade do cursor entra como energia, mas só dentro do raio (×vitality).
      var restScale = 0.42 + vitality*0.95;
      var speedKick = mouseSpeedSmooth*proximity*vitality*1.1;
      // ambiente tem teto (não vira caos sozinho), mas o CLIQUE não tem —
      // a explosão soma por fora do limite e pode subir o quanto quiser
      var ambient = Math.min(AMBIENT_CAP,
        baseSilhouette(bi,t)*restScale
        + hoverInfluence*HOVER_GAIN
        + speedKick*SPEED_GAIN
        + wakeInfluence*vitality*WAKE_GAIN);
      var target = ambient + burstInfluence*BURST_GAIN;

      // mola subamortecida: ATAQUE rápido (sensação de controle direto, <100ms)
      // e RELAXAMENTO lento (matéria viva assentando). A assimetria é o que
      // faz parecer resposta a você, e não uma animação rodando sozinha.
      // O wavelet tem VALE, então a onda também precisa saber descer depressa:
      // com burst ativo a mola fica firme nos dois sentidos (ainda assimétrica,
      // 1500 subindo × 520 descendo), fora dele volta ao relaxamento lento de sempre.
      var going = target > barState[bi];
      var bfa = burstInfluence < 0 ? -burstInfluence : burstInfluence;
      var stiffness, damping;
      if(bfa > 0.05){
        stiffness = going ? (1500 + proximity*400) : 520;
        damping = 34;
      } else if(going){
        stiffness = 300 + proximity*760; damping = 15 + (1-proximity)*10;
      } else {
        stiffness = 95; damping = 15;
      }
      for(var ss=0; ss<sub; ss++){
        var accel = (target-barState[bi])*stiffness - barVel[bi]*damping;
        barVel[bi] += accel*sdt;
        barState[bi] += barVel[bi]*sdt;
      }
      if(barState[bi] < 0){ barState[bi]=0; barVel[bi]*=-0.25; }
      var influence = barState[bi];
      if(influence < 0.02) continue;
      // limite derivado da tela, não teto artístico: a agulha usa toda a folga
      // disponível e para 6px antes da borda. Em telas altas ela sobe mais.
      if(influence > softKnee){
        influence = softKnee + kneeSpan*(1 - Math.exp(-(influence-softKnee)/kneeSpan));
      }

      var height = influence*MAX_H;
      var cx2 = bx+BAR_W/2;
      var gBase = bi*37;
      var rx = bx;

      // AS DUAS METADES DEIXARAM DE SER ESPELHADAS. Em cima, montanhas roladas
      // e lisas; embaixo, uma serra densa. Mesma energia, caráter diferente —
      // é o que faz o conjunto parecer vivo em vez de um decalque simétrico.
      var hTop = height;
      var hBot = height * botJag(bi);
      emitHalf(true,  hTop, bi, rx);
      emitHalf(false, hBot, bi, rx);

      // halo em duas camadas por metade (largo e fraco + estreito e forte);
      // somadas em modo aditivo dão queda de brilho parecida com bloom real
      if(influence>0.12){
        var glowB = Math.min(0.13, influence*0.075);
        var iB = aIdx(glowB);
        var ghT = GAP + hTop, ghB = GAP + hBot;
        glowBucketsT[iB].push(cx2-BAR_W*1.0, ribbonY-ghT-3, BAR_W*2.0, 6);
        glowBucketsB[iB].push(cx2-BAR_W*1.0, ribbonY+ghB-3, BAR_W*2.0, 6);
      }

      // grãos que se DESPRENDEM da crista o tempo todo — probabilidade proporcional
      // à altura local. É isso que dá a sensação de definição/nitidez sem clique.
      if(influence > 0.12){
        var pSpawn = influence*0.038; if(pSpawn>0.105) pSpawn=0.105;
        if(grainTable[(gBase+moteSeed)&(GRAIN_N-1)] > 1-pSpawn){
          var gA = grainTable[(gBase+moteSeed+3)&(GRAIN_N-1)];
          var gB = grainTable[(gBase+moteSeed+9)&(GRAIN_N-1)];
          spawnMote(cx2 + (gA-0.5)*BAR_W*2.2, ribbonY-(GAP+hTop), (gA-0.5)*18, -(7+gB*52), 1/(0.7+gA*1.3), true,  0.9+gB*0.7);
          spawnMote(cx2 + (gB-0.5)*BAR_W*2.2, ribbonY+(GAP+hBot), (gB-0.5)*18,  (7+gA*52), 1/(0.7+gB*1.3), false, 0.9+gA*0.7);
        }
      }
    }
    bursts = bursts.filter(function(bu){ return (t-bu.start)/1000 < BURST_LIFE; });

    // despejo em lote, em DUAS passadas.
    // (1) corpo em opacidade normal — é a massa da onda.
    for(var fi=0; fi<ALPHA_LEVELS; fi++){
      var bt = bodyBucketsT[fi];
      if(bt.length){
        ctx.fillStyle = topBody[fi];
        for(var q=0;q<bt.length;q+=4){ ctx.fillRect(bt[q],bt[q+1],bt[q+2],bt[q+3]); }
      }
      var bb2 = bodyBucketsB[fi];
      if(bb2.length){
        ctx.fillStyle = botBody[fi];
        for(var q2=0;q2<bb2.length;q2+=4){ ctx.fillRect(bb2[q2],bb2[q2+1],bb2[q2+2],bb2[q2+3]); }
      }
    }
    // (2) halo e crista SOMANDO luz. Sobreposição vira bloom colorido em vez de
    // opacidade empilhada — é o que faz a crista queimar em cima do próprio corpo.
    ctx.globalCompositeOperation = 'lighter';
    for(var fg=0; fg<ALPHA_LEVELS; fg++){
      var gt = glowBucketsT[fg];
      if(gt.length){
        ctx.fillStyle = topGlow[fg];
        for(var q3=0;q3<gt.length;q3+=4){ ctx.fillRect(gt[q3],gt[q3+1],gt[q3+2],gt[q3+3]); }
      }
      var gbb = glowBucketsB[fg];
      if(gbb.length){
        ctx.fillStyle = botGlow[fg];
        for(var q4=0;q4<gbb.length;q4+=4){ ctx.fillRect(gbb[q4],gbb[q4+1],gbb[q4+2],gbb[q4+3]); }
      }
    }
    for(var fc=0; fc<ALPHA_LEVELS; fc++){
      for(var rr=0; rr<RIM_LEVELS; rr++){
        var ct = crestBucketsT[rr][fc];
        if(ct.length){
          ctx.fillStyle = topCrest[rr][fc];
          for(var q5=0;q5<ct.length;q5+=4){ ctx.fillRect(ct[q5],ct[q5+1],ct[q5+2],ct[q5+3]); }
        }
        var cbb = crestBucketsB[rr][fc];
        if(cbb.length){
          ctx.fillStyle = botCrest[rr][fc];
          for(var q6=0;q6<cbb.length;q6+=4){ ctx.fillRect(cbb[q6],cbb[q6+1],cbb[q6+2],cbb[q6+3]); }
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // poeira de fundo, piscando devagar — agrupada por opacidade pra evitar
    // montar uma string de cor por partícula a cada frame
    for(var sl=0; sl<8; sl++){ sparkBuckets[sl].length = 0; }
    for(var si=0; si<sparkles.length; si++){
      var sp2 = sparkles[si];
      var av = 0.15 + (Math.sin(t*0.001*sp2.speed+sp2.phase)+1)*0.175;
      var sIdx = (av*8)|0; if(sIdx>7) sIdx=7; if(sIdx<0) sIdx=0;
      sparkBuckets[sIdx].push(sp2.x, sp2.y);
    }
    for(var sf=0; sf<8; sf++){
      var sb = sparkBuckets[sf];
      if(!sb.length) continue;
      ctx.fillStyle = sparkColors[sf];
      for(var sq=0; sq<sb.length; sq+=2){ ctx.fillRect(sb[sq], sb[sq+1], 1.2, 1.2); }
    }

    // anéis de choque: discretos, apenas uma insinuação do impacto
    ripplesClick = ripplesClick.filter(function(rp){ return (t-rp.start) < 1500; });
    ripplesClick.forEach(function(rp){
      for(var ring=0; ring<rp.rings; ring++){
        var age2 = (t-rp.start) - ring*110;
        if(age2<0) continue;
        var lifeFrac = age2/1400;
        if(lifeFrac>1) continue;
        var eased = 1-Math.pow(1-lifeFrac,2.4);
        var radius = eased*95;
        var alpha2 = Math.pow(1-lifeFrac,1.9)*0.2;
        var warm = ring%2===0;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, radius, 0, Math.PI*2);
        ctx.strokeStyle = warm ? 'rgba(125,26,215,'+alpha2+')' : 'rgba(80,230,120,'+alpha2+')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // ---- partículas (brasas + grãos da crista): atualização e desenho em lote ----
    for(var pb=0; pb<ALPHA_LEVELS; pb++){
      emberSegW[pb].length = 0; emberSegC[pb].length = 0;
      emberDotW[pb].length = 0; emberDotC[pb].length = 0;
    }

    // brasas: atrito + gravidade leve, com rastro curto
    for(var ei=0; ei<MAX_EMBERS; ei++){
      var em = embers[ei];
      if(em.life<=0) continue;
      var px0 = em.x, py0 = em.y;
      em.x += em.vx*dt; em.y += em.vy*dt;
      em.vx *= 0.962; em.vy = em.vy*0.962 + 38*dt;
      em.life -= em.decay*dt;
      if(em.life<=0){ em.life = 0; continue; }
      var a = em.life*0.9;
      var aH = aIdx(a), aT = aIdx(a*0.45);
      if(em.warm){
        emberSegW[aT].push(px0,py0,em.x,em.y);
        emberDotW[aH].push(em.x,em.y,em.size,em.size);
      } else {
        emberSegC[aT].push(px0,py0,em.x,em.y);
        emberDotC[aH].push(em.x,em.y,em.size,em.size);
      }
    }

    // grãos da crista: sobem/descem poucos pixels e apagam
    for(var mi=0; mi<MAX_MOTES; mi++){
      var mt = motes[mi];
      if(mt.life<=0) continue;
      mt.x += mt.vx*dt; mt.y += mt.vy*dt;
      mt.vy *= 0.94;
      mt.life -= mt.decay*dt;
      if(mt.life<=0){ mt.life = 0; continue; }
      var ma = aIdx(mt.life*0.8);
      if(mt.warm) emberDotW[ma].push(mt.x, mt.y, mt.size, mt.size);
      else        emberDotC[ma].push(mt.x, mt.y, mt.size, mt.size);
    }

    ctx.lineWidth = 0.9;
    ctx.globalCompositeOperation = 'lighter';   // brasas e grãos somam luz
    for(var fl=ALPHA_LEVELS-1; fl>=1; fl--){
      var sw = emberSegW[fl];
      if(sw.length){
        ctx.strokeStyle = topEmber[fl];
        ctx.beginPath();
        for(var z=0;z<sw.length;z+=4){ ctx.moveTo(sw[z],sw[z+1]); ctx.lineTo(sw[z+2],sw[z+3]); }
        ctx.stroke();
      }
      var scg = emberSegC[fl];
      if(scg.length){
        ctx.strokeStyle = botEmber[fl];
        ctx.beginPath();
        for(var z1=0;z1<scg.length;z1+=4){ ctx.moveTo(scg[z1],scg[z1+1]); ctx.lineTo(scg[z1+2],scg[z1+3]); }
        ctx.stroke();
      }
      var dw = emberDotW[fl];
      if(dw.length){
        ctx.fillStyle = topEmber[fl];
        for(var z2=0;z2<dw.length;z2+=4){ ctx.fillRect(dw[z2],dw[z2+1],dw[z2+2],dw[z2+3]); }
      }
      var dc = emberDotC[fl];
      if(dc.length){
        ctx.fillStyle = botEmber[fl];
        for(var z3=0;z3<dc.length;z3+=4){ ctx.fillRect(dc[z3],dc[z3+1],dc[z3+2],dc[z3+3]); }
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if(!reduceMotion) requestAnimationFrame(loop);
  }
  var lastDraw = 0;
  function loop(t){
    // teto de ~40fps: imperceptível numa animação ambiente, corta 1/3 do trabalho
    if(t-lastDraw < 24){ requestAnimationFrame(loop); return; }
    lastDraw = t;
    frame(t);
  }
  requestAnimationFrame(loop);

  // ================= TÍTULO: escrita gradual, ciclo e embaralhamento =================
  // Estados: escreve letra a letra -> repousa 5s -> apaga -> reescreve.
  // No clique, o ciclo é interrompido e a reescrita sai com as cores embaralhadas;
  // o próximo ciclo automático volta às cores originais.
  var heroLine = document.getElementById('heroLine');
  if(heroLine){
    var C_INK    = getComputedStyle(document.documentElement).getPropertyValue('--white').trim() || '#FFFFFF';
    var C_GREEN  = '#50E678';
    var C_PURPLE = '#7D1AD7';
    // paleta do embaralhamento: só as cores que sustentam leitura sobre o fundo escuro
    var SCRAMBLE = ['#FFFFFF','#D9D9D9','#50E678','#7D1AD7','#507AE6','#77BDE8'];
    // PRNG próprio: não consome a sequência determinística usada pelo canvas
    var hRand = mulberry32(0x5EED1A);

    // uma palavra por segmento: um espaço dentro de um span inline-block colapsa
    // para largura zero, então os espaços têm de ficar FORA das palavras
    var SEGMENTS = [
      { text:'Criado',      color:C_INK },
      { text:'para',        color:C_INK },
      { text:'ouvir',       color:C_GREEN },
      { text:'e',           color:C_INK },
      { text:'documentar.', color:C_PURPLE }
    ];

    var STEP_IN = 30, STEP_OUT = 13, IDLE = 5000;
    var chars = [];

    // remonta o h1: palavras em inline-block (o quebra-linha continua por palavra,
    // não no meio dela) e cada letra num span próprio
    heroLine.textContent = '';
    SEGMENTS.forEach(function(seg, si){
      if(si > 0) heroLine.appendChild(document.createTextNode(' '));
      var wordEl = document.createElement('span');
      wordEl.className = 'w';
      for(var i=0;i<seg.text.length;i++){
        var chEl = document.createElement('span');
        chEl.className = 'ch';
        chEl.textContent = seg.text[i];
        chEl.style.color = seg.color;
        wordEl.appendChild(chEl);
        chars.push({ el: chEl, base: seg.color, delay: 0 });
      }
      heroLine.appendChild(wordEl);
    });
    // ritmo: o espaço entre palavras também gasta um tempo, como numa digitação real
    (function(){
      var d = 0, k = 0;
      SEGMENTS.forEach(function(seg, si){
        if(si > 0) d += STEP_IN;
        for(var i=0;i<seg.text.length;i++){ chars[k++].delay = d; d += STEP_IN; }
      });
    })();

    var caret = document.createElement('span');
    caret.className = 'caret';

    var runId = 0, idleTimer = null, timers = [];
    function cancel(){
      runId++;
      if(idleTimer){ clearTimeout(idleTimer); idleTimer = null; }
      for(var i=0;i<timers.length;i++) clearTimeout(timers[i]);
      timers.length = 0;
    }
    function at(ms, fn){ timers.push(setTimeout(fn, ms)); }

    function pickColor(prev){
      var c;
      do { c = SCRAMBLE[(hRand()*SCRAMBLE.length)|0]; } while(c === prev);
      return c;
    }
    function dropCaret(){ if(caret.parentNode) caret.parentNode.removeChild(caret); }

    function write(scramble, done){
      var my = runId, last = null, total = 0;
      chars.forEach(function(c){
        total = Math.max(total, c.delay);
        at(c.delay, function(){
          if(my !== runId) return;
          c.el.style.color = scramble ? (last = pickColor(last)) : c.base;
          c.el.classList.add('on');
          c.el.parentNode.insertBefore(caret, c.el.nextSibling);
        });
      });
      at(total + 420, function(){
        if(my !== runId) return;
        dropCaret();
        if(done) done();
      });
    }

    function erase(done){
      var my = runId, n = chars.length;
      dropCaret();
      for(var i=n-1;i>=0;i--){
        (function(c, k){
          at((n-1-k)*STEP_OUT, function(){
            if(my !== runId) return;
            c.el.classList.remove('on');
          });
        })(chars[i], i);
      }
      at(n*STEP_OUT + 220, function(){ if(my !== runId) return; if(done) done(); });
    }

    function scheduleCycle(){
      idleTimer = setTimeout(function(){
        cancel();
        erase(function(){ write(false, scheduleCycle); });
      }, IDLE);
    }

    // clique: apaga e reescreve embaralhado, agora. Depois o ciclo automático
    // retoma e devolve as cores originais.
    heroLine.addEventListener('click', function(){
      if(reduceMotion) return;
      cancel();
      erase(function(){ write(true, scheduleCycle); });
    });

    if(reduceMotion){
      chars.forEach(function(c){ c.el.classList.add('on'); });
    } else {
      write(false, scheduleCycle);
    }
    updateRibbonY();   // as letras viraram inline-block; recalcula a altura da faixa
  }

  // ---- popover "Outros" ----
  var outrosBtn = document.getElementById('outrosBtn');
  var popover = document.getElementById('outrosPopover');
  outrosBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var isOpen = popover.classList.toggle('open');
    outrosBtn.classList.toggle('open', isOpen);
  });
  document.addEventListener('click', function(){
    popover.classList.remove('open');
    outrosBtn.classList.remove('open');
  });
  popover.addEventListener('click', function(e){ e.stopPropagation(); });

  // ---- feedback visual de clique (simulação — troca pela chamada real depois) ----
  document.querySelectorAll('[data-type]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(this.disabled) return;
      var original = this.firstChild ? this.firstChild.textContent : this.textContent;
      this.classList.add('is-loading');
      this.childNodes[0].textContent = 'Gerando...';
      setTimeout(function(btn){
        btn.classList.remove('is-loading');
        btn.childNodes[0].textContent = original;
      }, 1300, this);
    });
  });
})();
