// Contagem de prazos processuais — usada pelo sistema Processos.
//
// Regras (CPC, salvo indicação):
//  • publicação no DJEN = 1º dia útil após a disponibilização (art. 224, § 2º);
//  • o prazo começa no 1º dia útil após a publicação/intimação (art. 224, § 3º) — exclui o dia do começo;
//  • dias úteis (art. 219; Juizados: Lei 13.728/2018; CLT art. 775) ou corridos (penal, CPP art. 798; prazos materiais);
//  • se o início ou o vencimento cair em dia sem expediente ou com expediente reduzido, passa para o 1º dia útil
//    seguinte (art. 224, § 1º);
//  • 20/12 a 20/01 os prazos não correm (art. 220; CPP art. 798-A; CLT art. 775-A); 20/12 a 06/01 sem expediente;
//  • feriados nacionais, Carnaval, Sexta-feira Santa e Corpus Christi; nos tribunais federais e superiores,
//    também os da Lei 5.010/66 (quarta e quinta da Semana Santa, 11/08, 01/11 e 08/12);
//  • feriados locais e suspensões avulsas vêm da tabela "feriados" (padrão do sistema + os cadastrados pelo usuário).
// Datas no formato 'AAAA-MM-DD' (sem fuso).
(function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = (s) => new Date(s.slice(0, 10) + 'T00:00:00Z');
  const somar = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const diaSemana = (s) => parse(s).getUTCDay();
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const br = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
  const brSemana = (s) => (s ? `${SEMANA[diaSemana(s)]}, ${br(s)}` : '—');
  const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  /** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${ano}-${pad(mes)}-${pad(dia)}`;
  }

  // tribunais da União (Justiça Federal, do Trabalho, Eleitoral, Militar e superiores): Lei 5.010/66, art. 62
  const FEDERAL = /^(TRF|TRT|TRE|TST|TSE|STM|STJ|STF|CJF|CSJT|TNU|TRU|JF|JT)/i;
  const ehFederal = (t) => FEDERAL.test(String(t || '').trim());
  const PESO = { feriado: 3, suspensao: 2, parcial: 1 };

  const cacheAuto = new Map();
  /** Dias especiais calculados para o ano: Map('AAAA-MM-DD' → {tipo, motivo}). */
  function automaticos(ano, tribunal) {
    const chave = ano + (ehFederal(tribunal) ? 'F' : 'E');
    if (cacheAuto.has(chave)) return cacheAuto.get(chave);
    const m = new Map();
    const por = (data, tipo, motivo) => { const x = m.get(data); if (!x || PESO[tipo] > PESO[x.tipo]) m.set(data, { tipo, motivo }); };
    const fixo = (md, motivo) => por(`${ano}-${md}`, 'feriado', motivo);
    fixo('01-01', 'Confraternização Universal'); fixo('04-21', 'Tiradentes'); fixo('05-01', 'Dia do Trabalho');
    fixo('09-07', 'Independência do Brasil'); fixo('10-12', 'Nossa Senhora Aparecida'); fixo('11-02', 'Finados');
    fixo('11-15', 'Proclamação da República'); fixo('11-20', 'Dia da Consciência Negra (Lei 14.759/2023)'); fixo('12-25', 'Natal');
    const p = pascoa(ano);
    por(somar(p, -48), 'feriado', 'Carnaval (segunda-feira)');
    por(somar(p, -47), 'feriado', 'Carnaval (terça-feira)');
    por(somar(p, -46), 'parcial', 'Quarta-feira de Cinzas (expediente reduzido)');
    por(somar(p, -2), 'feriado', 'Sexta-feira Santa');
    por(somar(p, 60), 'feriado', 'Corpus Christi');
    if (ehFederal(tribunal)) {
      por(somar(p, -4), 'feriado', 'Quarta-feira Santa (Lei 5.010/66)');
      por(somar(p, -3), 'feriado', 'Quinta-feira Santa (Lei 5.010/66)');
      fixo('08-11', 'Dia dos cursos jurídicos (Lei 5.010/66)');
      fixo('11-01', 'Todos os Santos (Lei 5.010/66)');
      fixo('12-08', 'Imaculada Conceição (Lei 5.010/66)');
    }
    // recesso: sem expediente de 20/12 a 06/01; de 07/01 a 20/01 há expediente, mas os prazos seguem suspensos
    for (let d = `${ano}-12-20`; d <= `${ano}-12-31`; d = somar(d, 1)) por(d, 'feriado', 'Recesso forense (20/12 a 06/01)');
    for (let d = `${ano}-01-01`; d <= `${ano}-01-06`; d = somar(d, 1)) por(d, 'feriado', 'Recesso forense (20/12 a 06/01)');
    for (let d = `${ano}-01-07`; d <= `${ano}-01-20`; d = somar(d, 1)) por(d, 'suspensao', 'Prazos suspensos até 20/01 (CPC art. 220)');
    cacheAuto.set(chave, m);
    return m;
  }

  // feriados da tabela (padrão do sistema + do usuário)
  let cadastrados = [];
  const setFeriados = (lista) => { cadastrados = lista || []; };
  const mesmoTribunal = (a, b) => !a || String(a).trim().toUpperCase() === String(b || '').trim().toUpperCase();
  function dosCadastrados(data, tribunal) {
    let r = null;
    for (const f of cadastrados) {
      if (!mesmoTribunal(f.tribunal, tribunal)) continue;
      let ini = f.data, fim = f.ate || f.data;
      if (f.anual) { const ano = data.slice(0, 4); ini = ano + f.data.slice(4); fim = ano + (f.ate || f.data).slice(4); }
      if (data >= ini && data <= fim && (!r || PESO[f.tipo] > PESO[r.tipo])) r = { tipo: f.tipo, motivo: f.descricao + (f.tribunal ? ` (${f.tribunal})` : '') };
    }
    return r;
  }

  /** O que há de especial no dia: null (dia útil comum) ou {tipo: feriado|suspensao|parcial, motivo}. */
  function info(data, tribunal) {
    const ds = diaSemana(data);
    if (ds === 0) return { tipo: 'feriado', motivo: 'domingo', fds: true };
    if (ds === 6) return { tipo: 'feriado', motivo: 'sábado', fds: true };
    const a = automaticos(+data.slice(0, 4), tribunal).get(data) || null;
    const c = dosCadastrados(data, tribunal);
    if (a && c) return PESO[c.tipo] >= PESO[a.tipo] ? c : a;
    return a || c;
  }
  const temExpediente = (d, t) => { const i = info(d, t); return !i || i.tipo !== 'feriado'; };
  const diaUtilPleno = (d, t) => !info(d, t);                 // pode começar ou terminar prazo
  const proximo = (d, ok) => { let x = d; for (let n = 0; n < 800 && !ok(x); n++) x = somar(x, 1); return x; };

  /**
   * Calcula o prazo.
   * base_tipo: 'disponibilizacao' (data do DJEN) | 'publicacao' (publicação, intimação ou ciência) | 'inicio' (1º dia já conhecido)
   * Retorna { publicacao, inicio, vencimento, total, pulados: [{data, motivo}], prorrogado: {de, motivo} | null }.
   */
  function calcular({ base_tipo = 'disponibilizacao', base_data, dias, contagem = 'uteis', em_dobro = false, tribunal = '' }) {
    if (!base_data || !(dias > 0)) return null;
    const t = tribunal;
    let publicacao = null, inicio;
    if (base_tipo === 'disponibilizacao') publicacao = proximo(somar(base_data, 1), (d) => temExpediente(d, t));
    else if (base_tipo === 'publicacao') publicacao = base_data;
    if (base_tipo === 'inicio') inicio = base_data;
    else inicio = proximo(somar(publicacao, 1), (d) => diaUtilPleno(d, t));

    const total = dias * (em_dobro ? 2 : 1);
    const conta = contagem === 'corridos'
      ? (d) => { const i = info(d, t); return !i || i.tipo !== 'suspensao'; }
      : (d) => { const i = info(d, t); return !i || i.tipo === 'parcial'; };
    const pulados = [];
    let d = inicio, n = 1;
    while (n < total) {
      d = somar(d, 1);
      if (conta(d)) n++;
      else { const i = info(d, t); if (!i.fds) pulados.push({ data: d, motivo: i.motivo }); }
    }
    let vencimento = d, prorrogado = null;
    if (!diaUtilPleno(vencimento, t)) {
      prorrogado = { de: vencimento, motivo: info(vencimento, t).motivo };
      vencimento = proximo(somar(vencimento, 1), (x) => diaUtilPleno(x, t));
    }
    return { publicacao, inicio, vencimento, total, pulados, prorrogado };
  }

  /** Resumo dos dias pulados: agrupa sequências com o mesmo motivo (ex.: recesso). */
  function resumoPulados(lista) {
    const g = [];
    for (const p of lista) {
      const u = g[g.length - 1];
      if (u && u.motivo === p.motivo && somar(u.ate, 1) <= p.data && p.data <= somar(u.ate, 3)) u.ate = p.data;
      else g.push({ de: p.data, ate: p.data, motivo: p.motivo });
    }
    return g.map((x) => (x.de === x.ate ? `${br(x.de)} — ${x.motivo}` : `${br(x.de)} a ${br(x.ate)} — ${x.motivo}`));
  }

  /** Dias de calendário entre hoje e a data (0 = hoje). */
  const diasAte = (s) => Math.round((parse(s) - parse(hojeLocal())) / 864e5);
  /** Dias úteis que faltam (contando hoje, se útil) até o vencimento. */
  function uteisAte(venc, tribunal) {
    const h = hojeLocal(); if (venc < h) return -1;
    let n = 0; for (let d = h; d <= venc && n < 800; d = somar(d, 1)) if (diaUtilPleno(d, tribunal) || info(d, tribunal)?.tipo === 'parcial') n++;
    return n;
  }
  function rotulo(venc) {
    const n = diasAte(venc);
    if (n < 0) return n === -1 ? 'venceu ontem' : `venceu há ${-n} dias`;
    return n === 0 ? 'vence HOJE' : n === 1 ? 'vence amanhã' : `vence em ${n} dias`;
  }
  const urgencia = (venc) => { const n = diasAte(venc); return n < 0 ? 'vencido' : n <= 2 ? 'urgente' : n <= 5 ? 'perto' : 'longe'; };

  // ---------------- sugestão a partir da publicação ----------------
  const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    doze: 12, quinze: 15, vinte: 20, trinta: 30, 'quarenta e cinco': 45, 'quarenta e oito': 48, sessenta: 60, noventa: 90, 'setenta e duas': 72, 'vinte e quatro': 24 };
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const limpo = (t) => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

  /**
   * Sugere o prazo de uma publicação do DJEN (sempre para o advogado conferir).
   * Retorna { dias, contagem, descricao, motivo, semPrazo, horas, audiencia: 'AAAA-MM-DDTHH:MM' | null, em_dobro: false }.
   */
  function sugerir(pub) {
    const texto = semAcento(limpo(pub.texto));
    const tipoDoc = semAcento([pub.tipo_documento, pub.tipo_comunicacao].join(' '));
    const classe = semAcento(pub.nome_classe), orgao = semAcento(pub.nome_orgao), sigla = String(pub.sigla_tribunal || '').toUpperCase();
    const trabalho = /^(TRT|TST)/.test(sigla);
    const juizado = /juizado|turma recursal/.test(orgao + ' ' + classe);
    const penal = /penal|criminal|crime|inquerito|habeas|execucao da pena/.test(classe);
    const contagem = penal ? 'corridos' : 'uteis';
    const r = { contagem, semPrazo: false, horas: false, audiencia: null, em_dobro: false };

    // audiência marcada no texto (ex.: "Audiência:04/02/2027 13:00" ou "audiência ... para o dia 04/02/2027, às 13h00")
    const au = texto.match(/audiencia[^0-9]{0,80}?(\d{2})\/(\d{2})\/(\d{4})(?:[^0-9]{1,12}(\d{1,2})\s*[:h]\s*(\d{2})?)?/);
    if (au) r.audiencia = `${au[3]}-${au[2]}-${au[1]}T${pad(au[4] || 0)}:${au[5] || '00'}`;

    // prazo escrito no texto
    const palavras = Object.keys(NUMEROS).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`(?:prazo(?:\\s+\\w+){0,2}\\s+de|no prazo de|dentro de|em ate|em)\\s+(\\d{1,3}|${palavras})\\s*(?:\\([a-z\\s]+\\)\\s*)?(dias?|horas?)(?:\\s+(uteis|corridos))?`);
    const ex = texto.match(re);
    let explicito = null;
    if (ex) {
      const n = /^\d+$/.test(ex[1]) ? +ex[1] : NUMEROS[ex[1]];
      if (n > 0 && n <= 365) {
        if (ex[2].startsWith('hora')) { r.horas = true; explicito = Math.max(1, Math.ceil(n / 24)); r.contagem = 'corridos'; }
        else { explicito = n; if (ex[3] === 'corridos') r.contagem = 'corridos'; }
      }
    }

    const tem = (rx) => rx.test(texto) || rx.test(tipoDoc);
    let dias, descricao, base;
    if (tem(/sentenca/) && !tem(/cumprimento de sentenca/)) {
      if (trabalho) [dias, descricao, base] = [8, 'Recurso ordinário', 'CLT art. 895'];
      else if (penal) [dias, descricao, base] = [5, 'Apelação criminal', 'CPP art. 593'];
      else if (juizado) [dias, descricao, base] = [10, 'Recurso inominado', 'Lei 9.099/95, art. 42'];
      else [dias, descricao, base] = [15, 'Apelação', 'CPC art. 1.003, § 5º'];
      base += ' · embargos de declaração: ' + (penal ? '2 dias (CPP art. 619)' : trabalho ? '5 dias (CLT art. 897-A)' : '5 dias (CPC art. 1.023)');
    } else if (tem(/acordao/)) {
      if (trabalho) [dias, descricao, base] = [8, 'Recurso de revista', 'CLT art. 896'];
      else [dias, descricao, base] = [15, 'Recurso especial / extraordinário', 'CPC art. 1.003, § 5º'];
      base += ' · embargos de declaração: ' + (penal ? '2 dias (CPP art. 619)' : '5 dias');
    } else if (tem(/contrarraz/)) [dias, descricao, base] = trabalho ? [8, 'Contrarrazões', 'CLT'] : juizado ? [10, 'Contrarrazões', 'Lei 9.099/95, art. 42, § 2º'] : [15, 'Contrarrazões', 'CPC art. 1.010, § 1º'];
    else if (tem(/embargos de declaracao/)) [dias, descricao, base] = [5, 'Manifestação sobre embargos de declaração', 'CPC art. 1.023, § 2º'];
    else if (tem(/contestar|contestacao|cite-se|citacao|citado/)) [dias, descricao, base] = [15, 'Contestação', 'CPC art. 335'];
    else if (tem(/replica|sobre a contestacao/)) [dias, descricao, base] = [15, 'Réplica', 'CPC arts. 350 e 351'];
    else if (tem(/emend\w* (a )?(peticao )?inicial/)) [dias, descricao, base] = [15, 'Emenda à inicial', 'CPC art. 321'];
    else if (tem(/art\.?\s*523|pagamento voluntario|pagar o debito|efetuar o pagamento/)) [dias, descricao, base] = [15, 'Pagamento voluntário', 'CPC art. 523'];
    else if (tem(/impugna/)) [dias, descricao, base] = [15, 'Impugnação', 'CPC art. 525'];
    else if (tem(/especifi\w+ (as )?provas/)) [dias, descricao, base] = [5, 'Especificação de provas', 'CPC art. 218, § 3º (se o juiz não fixou)'];
    else [dias, descricao, base] = [5, 'Manifestação', 'CPC art. 218, § 3º — prazo não indicado no texto'];

    if (explicito) { r.motivo = `Prazo indicado no texto: ${ex[0].trim()}.` + (r.horas ? ' Prazo em horas: conferir o horário.' : ''); dias = explicito; }
    else r.motivo = `Sugestão pelo tipo de ato: ${descricao} — ${base}.`;
    if (penal) r.motivo += ' Processo penal: dias corridos (CPP art. 798).';
    // intimação só para audiência, sem prazo no texto
    if (r.audiencia && !explicito && !tem(/sentenca|acordao|contestar|contestacao|manifest/)) {
      r.semPrazo = true;
      r.motivo = 'A publicação marca audiência e não indica prazo. Confira se há algo a cumprir antes dela.';
    }
    return { ...r, dias, descricao };
  }

  window.Prazos = { pascoa, automaticos, info, calcular, resumoPulados, setFeriados, sugerir, diasAte, uteisAte, rotulo, urgencia,
    br, brSemana, somar, hojeLocal, ehFederal };
})();
