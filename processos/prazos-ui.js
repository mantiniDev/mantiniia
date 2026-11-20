// Prazos processuais dentro do sistema Processos: aba "Prazos", seção no processo, sugestão a partir das
// publicações do DJEN (sempre com confirmação), botão "Cumprido" e calendário de feriados por tribunal.
// A contagem fica em ../assets/prazos.js (window.Prazos).
(function () {
  'use strict';
  const A = window.ProcApp;           // utilitários expostos por app.js
  const P = window.Prazos;
  const { sb, esc } = A;
  const $ = (id) => document.getElementById(id);
  const TRIBUNAIS_BASE = ['TJRJ', 'TRF2', 'TRT1', 'STJ', 'STF', 'TST'];
  const TIPO_TXT = { feriado: 'sem expediente', suspensao: 'prazos suspensos', parcial: 'expediente reduzido' };
  const BASE_TXT = { disponibilizacao: 'Disponibilização no DJEN', publicacao: 'Publicação / intimação / ciência', inicio: 'Início do prazo (1º dia)' };

  let feriados = [];
  async function carregarFeriados() {
    const { data, error } = await sb.from('feriados').select('*').order('data');
    if (error) return A.fail(error);
    feriados = data; P.setFeriados(data);
  }

  // ---------------- aparência ----------------
  const cdPrazo = (p) => p.cumprido_em
    ? `<span class="cd passou">cumprido em ${P.br(p.cumprido_em)}</span>`
    : `<span class="cd ${({ vencido: 'urgente', urgente: 'urgente', perto: 'perto', longe: 'longe' })[P.urgencia(p.vencimento)]}">${P.rotulo(p.vencimento)}</span>`;
  const contTxt = (p) => `${p.dias}${p.em_dobro ? ' ×2' : ''} dia(s) ${p.contagem === 'corridos' ? 'corridos' : 'úteis'}`;
  function linhaPrazo(p, comProcesso) {
    const proc = p.processos;
    return `<li data-prazo="${p.id}" class="${p.cumprido_em ? 'done' : ''}">
      <span class="when">${esc(P.brSemana(p.vencimento))}</span>
      ${cdPrazo(p)}
      <span class="info"><b>${esc(p.descricao)}</b> · ${contTxt(p)}${p.tribunal ? ' · ' + esc(p.tribunal) : ''}
        ${comProcesso && proc ? `<div class="small"><a href="#/p/${p.processo_id}">${esc(proc.numero)}</a>${proc.titulo ? ' · ' + esc(proc.titulo) : ''}</div>` : ''}
        <div class="small muted">${p.data_publicacao ? `publicação ${P.br(p.data_publicacao)} · ` : ''}início ${P.br(p.inicio)}${p.observacao ? ' · ' + esc(p.observacao) : ''}</div></span>
      <span class="acts">
        ${p.cumprido_em ? '<button data-zact="reabrir">Reabrir</button>' : '<button data-zact="cumprido" class="primary">Cumprido</button><button data-zact="ics" title="Baixar para Outlook / Apple / celular, com lembretes">📅 Agenda</button>'}
        <button data-zact="editar">Editar</button> <button class="danger" data-zact="del">×</button>
      </span></li>`;
  }

  // ---------------- aba Prazos ----------------
  let listaAba = [];
  async function carregarAba() {
    await feriadosProntos;
    const filtro = $('prz-filtro').value;
    let q = sb.from('prazos').select('*, processos(numero, titulo, tribunal, excluido_em)');
    if (filtro === 'abertos') q = q.is('cumprido_em', null).order('vencimento');
    else if (filtro === 'cumpridos') q = q.not('cumprido_em', 'is', null).order('cumprido_em', { ascending: false }).limit(300);
    else q = q.order('vencimento', { ascending: false }).limit(500);
    const { data, error } = await q;
    if (error) return A.fail(error);
    listaAba = data.filter((p) => !p.processos?.excluido_em);
    $('prz-lista').innerHTML = listaAba.map((p) => linhaPrazo(p, true)).join('')
      || `<li class="muted">${filtro === 'abertos' ? 'Nenhum prazo em aberto.' : 'Nenhum prazo.'}</li>`;
    await carregarPendentes();
  }

  // publicações recentes do DJEN ainda sem decisão sobre prazo
  let pendentes = [];
  async function carregarPendentes() {
    const desde = P.somar(P.hojeLocal(), -30);
    const { data, error } = await sb.from('publicacoes')
      .select('id, processo_id, texto, tipo_documento, tipo_comunicacao, nome_classe, nome_orgao, sigla_tribunal, data_disponibilizacao, numero_mascara, numero_processo, processos(numero, titulo, tribunal, excluido_em)')
      .is('prazo_status', null).gte('data_disponibilizacao', desde).order('data_disponibilizacao', { ascending: false }).limit(200);
    if (error) return A.fail(error);
    pendentes = data.filter((x) => x.processo_id && !x.processos?.excluido_em);
    const box = $('prz-pendentes');
    box.classList.toggle('hidden', !pendentes.length);
    box.innerHTML = pendentes.length ? `<h3 style="margin:0 0 6px">📥 ${pendentes.length} publicação(ões) do DJEN aguardando definição de prazo</h3>
      <p class="small muted" style="margin:0 0 8px">Últimos 30 dias. A sugestão é automática; confira antes de salvar.</p>
      <ul class="aud-list">${pendentes.map((x) => {
        const s = P.sugerir(x);
        const c = s.semPrazo ? null : P.calcular({ base_data: x.data_disponibilizacao, dias: s.dias, contagem: s.contagem, tribunal: tribunalDe(x) });
        return `<li data-pend="${x.id}">
          <span class="when">${P.br(x.data_disponibilizacao)}</span>
          <span class="info"><b>${esc([x.tipo_comunicacao, x.tipo_documento].filter(Boolean).join(' – ') || 'Publicação')}</b> ·
            <a href="#/p/${x.processo_id}">${esc(x.numero_mascara || x.numero_processo)}</a>${x.processos?.titulo ? ' · ' + esc(x.processos.titulo) : ''}
            <div class="small muted">Sugestão: ${s.semPrazo ? 'sem prazo' + (s.audiencia ? ` (audiência em ${P.br(s.audiencia)} ${s.audiencia.slice(11, 16)})` : '') : `${esc(s.descricao)} · ${s.dias} dia(s) ${s.contagem === 'corridos' ? 'corridos' : 'úteis'} → vence <b>${P.brSemana(c.vencimento)}</b>`}</div></span>
          <span class="acts"><button class="primary" data-pact="conferir">Conferir</button><button data-pact="semprazo">Sem prazo</button></span>
        </li>`; }).join('')}</ul>` : '';
    contar();
  }

  async function contar() {
    const ate = P.somar(P.hojeLocal(), 2);
    const [{ data: urg }, { count: pend }] = await Promise.all([
      sb.from('prazos').select('id, vencimento, descricao, processo_id, processos(numero, titulo, excluido_em)').is('cumprido_em', null).lte('vencimento', ate).order('vencimento'),
      sb.from('publicacoes').select('id', { count: 'exact', head: true }).is('prazo_status', null).gte('data_disponibilizacao', P.somar(P.hojeLocal(), -30)).not('processo_id', 'is', null),
    ]);
    const urgentes = (urg || []).filter((p) => !p.processos?.excluido_em);
    const n = (pend || 0) + urgentes.length;
    $('prazos-qtd').textContent = n || ''; $('prazos-qtd').classList.toggle('hidden', !n);
    const al = $('alert-prazos');
    al.classList.toggle('hidden', !urgentes.length);
    al.innerHTML = urgentes.length ? `⏳ <b>Prazos</b> vencidos ou vencendo até ${P.br(ate)}:<ul style="margin:6px 0 0">` + urgentes.map((p) =>
      `<li><b>${P.rotulo(p.vencimento)}</b> (${P.brSemana(p.vencimento)}) — ${esc(p.descricao)} · <a href="#/p/${p.processo_id}">${esc(p.processos?.titulo || p.processos?.numero || '')}</a></li>`).join('') + '</ul>' : '';
  }

  // ---------------- seção no processo ----------------
  let listaProc = [];
  async function detalhe(proc) {
    await feriadosProntos;
    const { data, error } = await sb.from('prazos').select('*').eq('processo_id', proc.id).order('vencimento');
    if (error) return A.fail(error);
    listaProc = [...data.filter((p) => !p.cumprido_em), ...data.filter((p) => p.cumprido_em).sort((a, b) => b.cumprido_em.localeCompare(a.cumprido_em))];
    $('d-prazos').innerHTML = listaProc.map((p) => linhaPrazo(p, false)).join('') || '<li class="muted">Nenhum prazo cadastrado.</li>';
    const ab = listaProc.find((p) => !p.cumprido_em);
    $('d-proxprazo').innerHTML = ab ? `${esc(P.br(ab.vencimento))} ${cdPrazo(ab)}` : '—';
  }

  // ---------------- diálogo do prazo ----------------
  let ctx = null;   // { prazo?, pub?, processo }
  const tribunalDe = (pub, proc) => (proc?.tribunal || pub?.processos?.tribunal || pub?.sigla_tribunal || '').trim();

  async function abrir({ prazo = null, pub = null, processo = null }) {
    await feriadosProntos;
    if (!processo) {
      const id = prazo?.processo_id || pub?.processo_id;
      const { data, error } = await sb.from('processos').select('id, numero, titulo, tribunal').eq('id', id).single();
      if (error) return A.fail(error);
      processo = data;
    }
    ctx = { prazo, pub, processo };
    $('pz-titulo').textContent = prazo ? 'Editar prazo' : 'Novo prazo';
    $('pz-proc').innerHTML = `Processo <b>${esc(processo.numero)}</b>${processo.titulo ? ' · ' + esc(processo.titulo) : ''}`;
    const sug = pub && !prazo ? P.sugerir(pub) : null;
    // texto da publicação (para conferir)
    $('pz-pub').classList.toggle('hidden', !pub);
    if (pub) {
      $('pz-pub-cab').textContent = `${P.br(pub.data_disponibilizacao)} · ${[pub.tipo_comunicacao, pub.tipo_documento].filter(Boolean).join(' – ') || 'Publicação'} · ${[pub.sigla_tribunal, pub.nome_orgao].filter(Boolean).join(' · ')}`;
      $('pz-pub-txt').textContent = A.textoLimpo(pub.texto) || '(sem texto)';
    }
    const sb_ = $('pz-sug');
    sb_.classList.toggle('hidden', !sug);
    if (sug) {
      sb_.innerHTML = `💡 ${esc(sug.motivo)}` + (sug.audiencia ? `<div style="margin-top:6px">📅 Audiência no texto: <b>${P.br(sug.audiencia)} ${sug.audiencia.slice(11, 16)}</b> <button type="button" id="pz-cad-aud">Cadastrar audiência</button></div>` : '');
      $('pz-cad-aud')?.addEventListener('click', () => cadastrarAudiencia(sug.audiencia));
    }
    $('pz-desc').value = prazo?.descricao ?? sug?.descricao ?? '';
    $('pz-base').value = prazo?.base_tipo ?? (pub ? 'disponibilizacao' : 'publicacao');
    $('pz-data').value = prazo?.base_data ?? pub?.data_disponibilizacao ?? P.hojeLocal();
    $('pz-dias').value = prazo?.dias ?? sug?.dias ?? 15;
    $('pz-cont').value = prazo?.contagem ?? sug?.contagem ?? 'uteis';
    $('pz-dobro').checked = !!prazo?.em_dobro;
    $('pz-trib').value = prazo?.tribunal ?? tribunalDe(pub, processo);
    $('pz-obs').value = prazo?.observacao ?? '';
    $('pz-sem').classList.toggle('hidden', !pub || !!prazo);
    $('pz-sem').classList.toggle('primary', !!sug?.semPrazo);
    previa();
    $('dlg-prazo').showModal();
  }

  function valores() {
    return { base_tipo: $('pz-base').value, base_data: $('pz-data').value, dias: Math.round(+$('pz-dias').value),
      contagem: $('pz-cont').value, em_dobro: $('pz-dobro').checked, tribunal: $('pz-trib').value.trim().toUpperCase() };
  }
  function previa() {
    const v = valores();
    const r = P.calcular(v);
    if (!r) { $('pz-prev').innerHTML = '<span class="muted">Informe a data e a quantidade de dias.</span>'; return null; }
    const pul = P.resumoPulados(r.pulados);
    $('pz-prev').innerHTML = `
      ${r.publicacao && v.base_tipo === 'disponibilizacao' ? `<div>Publicação: <b>${P.brSemana(r.publicacao)}</b> <span class="muted small">(1º dia útil após a disponibilização)</span></div>` : ''}
      <div>Início do prazo: <b>${P.brSemana(r.inicio)}</b>${v.base_tipo !== 'inicio' ? ' <span class="muted small">(1º dia útil seguinte)</span>' : ''}</div>
      <div style="font-size:18px;margin-top:4px">Vencimento: <b>${P.brSemana(r.vencimento)}</b>, até 23h59 ${cdPrazo({ vencimento: r.vencimento })}</div>
      <div class="small muted">${r.total} dia(s) ${v.contagem === 'corridos' ? 'corridos' : 'úteis'}${v.em_dobro ? ' (em dobro)' : ''}${v.tribunal ? ' · calendário ' + esc(v.tribunal) + (P.ehFederal(v.tribunal) ? ' (Lei 5.010/66)' : '') : ''}</div>
      ${r.prorrogado ? `<div class="small">↪ Terminaria em ${P.br(r.prorrogado.de)} (${esc(r.prorrogado.motivo)}); prorrogado para o 1º dia útil seguinte.</div>` : ''}
      ${pul.length ? `<details class="small" style="margin-top:4px"><summary>Dias que não contaram (${r.pulados.length}, além de fins de semana)</summary><ul style="margin:4px 0 0">${pul.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
    return r;
  }
  ['pz-base', 'pz-data', 'pz-dias', 'pz-cont', 'pz-dobro', 'pz-trib'].forEach((id) => $(id).addEventListener('input', previa));

  let salvando = false;   // evita prazo em dobro por clique duplo
  $('form-prazo').addEventListener('submit', async (ev) => {
    const acao = ev.submitter?.value;
    if (acao === 'cancel') return;
    ev.preventDefault();
    if (acao === 'sem') return semPrazo(ctx.pub.id, true);
    const v = valores(); const r = previa();
    const descricao = $('pz-desc').value.trim();
    if (!r || !descricao) return A.toast('Preencha a descrição, a data e os dias.', true);
    if (salvando) return; salvando = true; setTimeout(() => { salvando = false; }, 1500);
    const row = { ...v, tribunal: v.tribunal || null, descricao, observacao: $('pz-obs').value.trim() || null,
      data_publicacao: r.publicacao || (v.base_tipo === 'publicacao' ? v.base_data : null), inicio: r.inicio, vencimento: r.vencimento };
    const q = ctx.prazo ? sb.from('prazos').update(row).eq('id', ctx.prazo.id)
      : sb.from('prazos').insert({ ...row, processo_id: ctx.processo.id, publicacao_id: ctx.pub?.id || null });
    const { error } = await q;
    if (error) return A.fail(error);
    if (ctx.pub && !ctx.prazo) {
      const { error: e2 } = await sb.from('publicacoes').update({ prazo_status: 'definido', lida: true }).eq('id', ctx.pub.id);
      if (e2) return A.fail(e2);
    }
    $('dlg-prazo').close();
    A.toast(`Prazo salvo — vence ${P.brSemana(r.vencimento)}.`);
    atualizarTudo();
  });

  async function semPrazo(pubId, fecharDialogo) {
    const { error } = await sb.from('publicacoes').update({ prazo_status: 'sem_prazo', lida: true }).eq('id', pubId);
    if (error) return A.fail(error);
    if (fecharDialogo) $('dlg-prazo').close();
    A.toastAcao('Publicação marcada como sem prazo.', 'Desfazer', async () => {
      await sb.from('publicacoes').update({ prazo_status: null }).eq('id', pubId); atualizarTudo();
    });
    atualizarTudo();
  }

  async function cadastrarAudiencia(quando) {
    const iso = new Date(quando).toISOString();
    const { data: ja } = await sb.from('audiencias').select('id').eq('processo_id', ctx.processo.id).eq('data_hora', iso);
    if (ja?.length) return A.toast('Essa audiência já está cadastrada.');
    const { error } = await sb.from('audiencias').insert({ processo_id: ctx.processo.id, data_hora: iso, tipo: null, observacao: 'Cadastrada a partir da publicação do DJEN' });
    if (error) return A.fail(error);
    A.toast('Audiência cadastrada.');
    const b = $('pz-cad-aud'); if (b) { b.disabled = true; b.textContent = 'Cadastrada ✓'; }
  }

  function atualizarTudo() {
    if (!$('aba-prazos').classList.contains('hidden')) carregarAba(); else contar();
    A.reabrir(); A.recarregarPubs();
  }

  // ---------------- ações nas listas ----------------
  async function acaoLista(ev, lista) {
    const b = ev.target.closest('button[data-zact]'); if (!b) return;
    const p = lista().find((x) => x.id === b.closest('li').dataset.prazo);
    const act = b.dataset.zact;
    if (act === 'editar') return abrir({ prazo: p });
    if (act === 'ics') return baixarIcs(p);
    if (act === 'cumprido') { ctxCumprido = p; $('cp-data').value = P.hojeLocal(); $('cp-data').max = P.hojeLocal(); $('cp-desc').textContent = `${p.descricao} — vencimento ${P.brSemana(p.vencimento)}`; $('dlg-cumprido').showModal(); return; }
    if (act === 'reabrir') { const { error } = await sb.from('prazos').update({ cumprido_em: null }).eq('id', p.id); if (error) return A.fail(error); return atualizarTudo(); }
    if (act === 'del') {
      if (!confirm(`Apagar o prazo "${p.descricao}" (vence ${P.br(p.vencimento)})?`)) return;
      const { error } = await sb.from('prazos').delete().eq('id', p.id);
      if (error) return A.fail(error);
      if (p.publicacao_id) await sb.from('publicacoes').update({ prazo_status: null }).eq('id', p.publicacao_id);
      atualizarTudo();
    }
  }
  $('prz-lista').addEventListener('click', (ev) => acaoLista(ev, () => listaAba));
  $('d-prazos').addEventListener('click', (ev) => acaoLista(ev, () => listaProc));
  $('prz-filtro').addEventListener('change', carregarAba);
  $('d-novo-prazo').addEventListener('click', () => abrir({ processo: A.atual() }));
  $('prz-pendentes').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-pact]'); if (!b) return;
    const pub = pendentes.find((x) => x.id === b.closest('li').dataset.pend);
    if (b.dataset.pact === 'semprazo') return semPrazo(pub.id, false);
    abrir({ pub });
  });

  let ctxCumprido = null;
  $('form-cumprido').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const d = $('cp-data').value; if (!d) return;
    const obs = $('cp-obs').value.trim();
    const row = { cumprido_em: d };
    if (obs) row.observacao = [ctxCumprido.observacao, obs].filter(Boolean).join(' · ');
    const { error } = await sb.from('prazos').update(row).eq('id', ctxCumprido.id);
    if (error) return A.fail(error);
    $('dlg-cumprido').close(); $('cp-obs').value = '';
    A.toast(d > ctxCumprido.vencimento ? '⚠️ Marcado como cumprido — depois do vencimento.' : 'Prazo cumprido. ✅', d > ctxCumprido.vencimento);
    atualizarTudo();
  });

  // abrir a partir de um cartão de publicação (aba Publicações ou processo)
  async function daPublicacao(id) {
    const { data: pub, error } = await sb.from('publicacoes').select('*, processos(numero, titulo, tribunal)').eq('id', id).single();
    if (error) return A.fail(error);
    if (pub.prazo_status === 'definido') {
      const { data: pz } = await sb.from('prazos').select('*').eq('publicacao_id', id).limit(1);
      if (pz?.length) return abrir({ prazo: pz[0] });
    }
    if (!pub.processo_id) return A.toast('Esta publicação não está ligada a um processo.', true);
    abrir({ pub });
  }

  // ---------------- agenda (.ics / Google) ----------------
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  async function baixarIcs(p) {
    const proc = p.processos || (await sb.from('processos').select('numero, titulo').eq('id', p.processo_id).single()).data || {};
    const d = p.vencimento.replace(/-/g, ''), d2 = P.somar(p.vencimento, 1).replace(/-/g, '');
    const alarm = (t, txt) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${t}`, `DESCRIPTION:${icsEsc(txt)}`, 'END:VALARM'];
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mantini.ia.br//Processos//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:prazo-${p.id}@mantini.ia.br`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
      `SUMMARY:${icsEsc(`⏳ Prazo: ${p.descricao} — ${proc.titulo || proc.numero}`)}`,
      `DESCRIPTION:${icsEsc(`Processo ${proc.numero}\nVence ${P.brSemana(p.vencimento)} às 23h59\nInício ${P.br(p.inicio)} · ${contTxt(p)}`)}`,
      ...alarm('-P2D', 'Prazo vence em 2 dias'), ...alarm('PT8H', 'Prazo vence hoje'),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    el.download = `prazo_${String(proc.numero || '').replace(/\D/g, '')}_${p.vencimento}.ics`;
    document.body.appendChild(el); el.click(); setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 1000);
  }

  // ---------------- feriados ----------------
  async function abrirFeriados() {
    const ano = new Date().getFullYear();
    $('fr-ano').innerHTML = [ano - 1, ano, ano + 1].map((a) => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('');
    const { data: procs } = await sb.from('processos').select('tribunal').is('excluido_em', null);
    const tribs = [...new Set([...TRIBUNAIS_BASE, ...(procs || []).map((p) => (p.tribunal || '').trim().toUpperCase()).filter(Boolean)])].sort();
    $('fr-trib').innerHTML = tribs.map((t) => `<option ${t === 'TJRJ' ? 'selected' : ''}>${esc(t)}</option>`).join('');
    $('fr-novo-trib').innerHTML = '<option value="">Todos os tribunais</option>' + tribs.map((t) => `<option>${esc(t)}</option>`).join('');
    renderFeriados();
    $('dlg-feriados').showModal();
  }
  function renderFeriados() {
    const ano = +$('fr-ano').value, t = $('fr-trib').value;
    const linhas = [];
    for (const [data, x] of P.automaticos(ano, t)) linhas.push({ data, tipo: x.tipo, motivo: x.motivo, origem: 'automático' });
    for (const f of feriados) {
      if (f.tribunal && f.tribunal.toUpperCase() !== t) continue;
      const ini = f.anual ? ano + f.data.slice(4) : f.data;
      if (!f.anual && ini.slice(0, 4) !== String(ano) && (f.ate || f.data).slice(0, 4) !== String(ano)) continue;
      const fim = f.ate ? (f.anual ? ano + f.ate.slice(4) : f.ate) : null;
      linhas.push({ data: ini, ate: fim, tipo: f.tipo, motivo: f.descricao + (f.anual ? ' (todo ano)' : ''), origem: f.user_id ? 'seu' : 'padrão', id: f.user_id ? f.id : null, trib: f.tribunal });
    }
    // recesso: mostra uma linha por período em vez de um dia por linha
    const agrup = [];
    for (const l of linhas.sort((a, b) => a.data.localeCompare(b.data))) {
      const u = agrup[agrup.length - 1];
      if (u && u.origem === 'automático' && l.origem === 'automático' && u.motivo === l.motivo && P.somar(u.ate || u.data, 1) === l.data) u.ate = l.data;
      else agrup.push({ ...l });
    }
    $('fr-body').innerHTML = agrup.map((l) => `<tr>
      <td class="small" style="white-space:nowrap">${P.brSemana(l.data)}${l.ate && l.ate !== l.data ? ` a ${P.br(l.ate)}` : ''}</td>
      <td>${esc(l.motivo)}</td><td class="small">${TIPO_TXT[l.tipo]}</td><td class="small muted">${l.origem}${l.trib ? '' : l.origem !== 'automático' ? ' · todos' : ''}</td>
      <td class="actions">${l.id ? `<button class="danger" data-fdel="${l.id}">×</button>` : ''}</td></tr>`).join('');
  }
  $('fr-ano').addEventListener('change', renderFeriados);
  $('fr-trib').addEventListener('change', renderFeriados);
  $('fr-body').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-fdel]'); if (!b) return;
    if (!confirm('Apagar este feriado/suspensão? Prazos já salvos não mudam (edite-os para recalcular).')) return;
    const { error } = await sb.from('feriados').delete().eq('id', b.dataset.fdel);
    if (error) return A.fail(error);
    await carregarFeriados(); renderFeriados();
  });
  $('form-feriado').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const row = { data: $('fr-data').value, ate: $('fr-ate').value || null, tribunal: $('fr-novo-trib').value || null,
      tipo: $('fr-tipo').value, descricao: $('fr-desc').value.trim(), anual: $('fr-anual').checked };
    if (!row.data || !row.descricao) return;
    const { error } = await sb.from('feriados').insert(row);
    if (error) return A.fail(error);
    $('fr-data').value = ''; $('fr-ate').value = ''; $('fr-desc').value = ''; $('fr-anual').checked = false;
    await carregarFeriados(); renderFeriados();
    A.toast('Cadastrado. Prazos já salvos não mudam: abra e salve de novo para recalcular.');
  });
  $('btn-feriados').addEventListener('click', abrirFeriados);
  $('fr-fechar').addEventListener('click', () => $('dlg-feriados').close());

  const feriadosProntos = carregarFeriados();
  window.PrazosUI = { carregarAba, detalhe, daPublicacao, contar };
})();
