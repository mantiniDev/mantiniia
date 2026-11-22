// Clientes — fichas de clientes, contratos de honorários, parcelas, recebimentos e recibo em PDF.
// Dados no Supabase (tabelas clientes / clientes_processos / contratos / parcelas / emitente, protegidas por RLS).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sb = Auth.sb;

  // ===================== Utilitários =====================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoje = () => ymd(new Date());
  const brDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
  const digitos = (s) => String(s || '').replace(/\D/g, '');
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const moeda = (v) => BRL.format(Number(v) || 0);
  /** "1.500,50" | "1500,5" | "1500.50" → 1500.5 */
  function lerValor(t) {
    let s = String(t || '').trim().replace(/[R$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 2.000 = dois mil
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  const valorTxt = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
  /** soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02) */
  function somarMeses(s, n) {
    const [a, m, d] = s.split('-').map(Number);
    const alvo = new Date(a, m - 1 + n, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    return ymd(alvo);
  }
  const diasAte = (s) => Math.round((new Date(s + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5);

  // CPF / CNPJ
  function cpfValido(c) {
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); return ((s * 10) % 11) % 10; };
    return dv(9) === +c[9] && dv(10) === +c[10];
  }
  function cnpjValido(c) {
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const dv = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const r = w.reduce((t, p, i) => t + p * +c[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +c[12] && dv(13) === +c[13];
  }
  const fmtDoc = (d) => (d?.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : d?.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d || '');
  const docRotulo = (d) => (d?.length === 14 ? 'CNPJ' : 'CPF');
  function fmtTel(t) {
    const d = digitos(t).replace(/^55(?=\d{10,11}$)/, '');
    return d.length === 11 ? d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : d.length === 10 ? d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : t || '';
  }
  const waLink = (t, msg) => { const d = digitos(t); if (d.length < 10) return null; return `https://wa.me/${d.length <= 11 ? '55' + d : d}${msg ? '?text=' + encodeURIComponent(msg) : ''}`; };

  /** valor por extenso: 1500.5 → "mil e quinhentos reais e cinquenta centavos" */
  function extenso(v) {
    const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    const ate999 = (n) => {
      if (n === 100) return 'cem';
      const c = Math.floor(n / 100), r = n % 100, p = [];
      if (c) p.push(C[c]);
      if (r) p.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : ''));
      return p.join(' e ');
    };
    const centavosTot = Math.round(Number(v) * 100), inteiro = Math.floor(centavosTot / 100), cent = centavosTot % 100;
    const nomes = [null, ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const grupos = []; for (let n = inteiro; n > 0; n = Math.floor(n / 1000)) grupos.push(n % 1000);
    const partes = [];
    for (let i = grupos.length - 1; i >= 0; i--) {
      const g = grupos[i]; if (!g) continue;
      partes.push({ g, t: i === 1 && g === 1 ? 'mil' : ate999(g) + (i ? ' ' + nomes[i][g === 1 ? 0 : 1] : '') });
    }
    let reais = partes.map((p, k) => (k === 0 ? '' : k === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? ' e ' : ' ') + p.t).join('');
    if (inteiro) reais += (inteiro >= 1e6 && inteiro % 1e6 === 0 ? ' de' : '') + (inteiro === 1 ? ' real' : ' reais');
    const cents = cent ? ate999(cent) + (cent === 1 ? ' centavo' : ' centavos') : '';
    return [reais, cents].filter(Boolean).join(' e ') || 'zero real';
  }
  window.Clientes = { extenso, cpfValido, cnpjValido, somarMeses, lerValor };   // para testes

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    t.style.background = isErr ? 'var(--danger)' : 'var(--text)';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), isErr ? 6000 : 2800);
  }
  const fail = (e) => { console.error(e); toast('Erro: ' + (e.message || e), true); };

  const FORMAS = { pix: 'PIX', transferencia: 'transferência', dinheiro: 'dinheiro', cartao: 'cartão', boleto: 'boleto', cheque: 'cheque', outro: 'outro meio' };
  const TIPOS = { fixo: 'Valor fixo', mensal: 'Mensal', exito: 'Êxito', misto: 'Fixo + êxito' };
  function situacao(p) {
    if (p.pago_em) return `<span class="pill pago">recebida ${brDate(p.pago_em)}</span>`;
    const n = diasAte(p.vencimento);
    if (n < 0) return `<span class="pill vencido">vencida há ${-n} dia${n === -1 ? '' : 's'}</span>`;
    if (n === 0) return '<span class="pill hoje">vence hoje</span>';
    return `<span class="pill ${n <= 7 ? 'breve' : ''}">em ${n} dia${n === 1 ? '' : 's'}</span>`;
  }

  // ===================== Estado =====================
  let clientes = [], processos = [], temProcessos = false, emitente = null, usuario = null;
  let atual = null, contratos = [], vinculos = [];

  async function carregarBase() {
    const [c, ac, em] = await Promise.all([
      sb.from('clientes').select('*').order('nome'),
      sb.rpc('tem_acesso', { p_sistema: 'processos' }),
      sb.from('emitente').select('*').maybeSingle(),
    ]);
    if (c.error) return fail(c.error);
    clientes = c.data; temProcessos = !!ac.data; emitente = em.data;
    if (temProcessos) {
      const { data } = await sb.from('processos').select('id, numero, titulo').is('excluido_em', null).order('numero');
      processos = data || [];
      $('lista-processos').innerHTML = processos.map((p) => `<option value="${esc(p.numero)}${p.titulo ? ' — ' + esc(p.titulo) : ''}">`).join('');
    }
  }
  const procDoTexto = (t) => { const n = digitos(String(t).split('—')[0]); return n ? processos.find((p) => digitos(p.numero) === n) : null; };
  const procTxt = (id) => { const p = processos.find((x) => x.id === id); return p ? p.numero + (p.titulo ? ' — ' + p.titulo : '') : ''; };

  // ===================== Navegação =====================
  let aba = 'painel';
  function route() {
    const m = location.hash.match(/^#\/c\/([0-9a-f-]{36})/);
    $('view-main').classList.toggle('hidden', !!m);
    $('view-cliente').classList.toggle('hidden', !m);
    if (m) return abrirCliente(m[1]);
    atual = null; document.title = 'Clientes — mantini.ia.br';
    const a = (location.hash.match(/^#\/(clientes|parcelas)/) || [])[1] || 'painel';
    mostrarAba(a);
  }
  function mostrarAba(a) {
    aba = a;
    document.querySelectorAll('#abas button[data-aba]').forEach((b) => b.classList.toggle('active', b.dataset.aba === a));
    ['painel', 'clientes', 'parcelas'].forEach((x) => $('aba-' + x).classList.toggle('hidden', x !== a));
    if (a === 'painel') carregarPainel(); else if (a === 'clientes') renderClientes(); else carregarParcelas();
  }
  window.addEventListener('hashchange', route);
  $('abas').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-aba]'); if (!b) return;
    location.hash = b.dataset.aba === 'painel' ? '#/' : '#/' + b.dataset.aba;
  });

  // parcelas com contrato e cliente (para painel e aba Parcelas)
  const SEL_PARC = '*, contratos!inner(id, descricao, cliente_id, status, clientes!inner(id, nome, telefone))';
  function linhaParcela(p, comCliente = true) {
    const ct = p.contratos, cl = ct?.clientes;
    return `<tr data-parc="${p.id}">
      <td style="white-space:nowrap">${brDate(p.vencimento)}</td>
      ${comCliente ? `<td><a href="#/c/${cl.id}">${esc(cl.nome)}</a></td>` : ''}
      <td>${esc(ct?.descricao || '')}${p.descricao ? `<div class="small muted">${esc(p.descricao)}</div>` : ''}</td>
      <td class="num">${moeda(p.pago_em ? p.valor_pago : p.valor)}</td>
      <td>${situacao(p)}</td>
      <td class="actions">${acoesParcela(p, cl)}</td></tr>`;
  }
  function acoesParcela(p, cl) {
    if (p.pago_em) return `<button data-pact="recibo">Recibo${p.recibo_numero ? ' nº ' + p.recibo_numero : ''}</button> <button data-pact="desfazer" title="Desfazer o recebimento">Desfazer</button>`;
    const cobrar = cl?.telefone && waLink(cl.telefone) ? '<button data-pact="cobrar" title="Mensagem de cobrança pelo WhatsApp">Cobrar</button> ' : '';
    return `<button class="primary" data-pact="receber">Recebido</button> ${cobrar}`;
  }

  // ===================== Painel =====================
  let painelLista = [];
  async function carregarPainel() {
    const ano = hoje().slice(0, 4), mes = hoje().slice(0, 7);
    const ate = ymd(new Date(Date.now() + 30 * 864e5));
    const [ab, pg] = await Promise.all([
      sb.from('parcelas').select(SEL_PARC).is('pago_em', null).order('vencimento'),
      sb.from('parcelas').select('valor_pago, pago_em').gte('pago_em', ano + '-01-01').lte('pago_em', ano + '-12-31'),
    ]);
    if (ab.error) return fail(ab.error);
    if (pg.error) return fail(pg.error);
    const abertas = ab.data, h = hoje();
    const venc = abertas.filter((p) => p.vencimento < h);
    const doMes = abertas.filter((p) => p.vencimento.startsWith(mes) && p.vencimento >= h);
    const recMes = pg.data.filter((p) => p.pago_em.startsWith(mes));
    const soma = (l, k = 'valor') => l.reduce((t, p) => t + Number(p[k] || 0), 0);
    $('r-vencidas').textContent = moeda(soma(venc)); $('r-vencidas-q').textContent = `${venc.length} parcela(s)`;
    $('r-mes').textContent = moeda(soma(doMes)); $('r-mes-q').textContent = `${doMes.length} parcela(s) até o fim do mês`;
    $('r-recebido-mes').textContent = moeda(soma(recMes, 'valor_pago')); $('r-recebido-mes-q').textContent = `${recMes.length} recebimento(s)`;
    $('r-recebido-ano').textContent = moeda(soma(pg.data, 'valor_pago')); $('r-recebido-ano-q').textContent = `${pg.data.length} recebimento(s) em ${ano}`;
    painelLista = abertas.filter((p) => p.vencimento <= ate);
    $('painel-body').innerHTML = painelLista.map((p) => linhaParcela(p)).join('')
      || `<tr><td colspan="6" class="vazio">${clientes.length ? 'Nada vencido nem vencendo nos próximos 30 dias. ✅' : 'Comece cadastrando um cliente e um contrato de honorários.'}</td></tr>`;
    contarVencidas(venc.length);
  }
  function contarVencidas(n) { $('venc-qtd').textContent = n || ''; $('venc-qtd').classList.toggle('hidden', !n); }

  // ===================== Clientes (lista) =====================
  let resumoCli = new Map();
  async function renderClientes() {
    const [ab, vp] = await Promise.all([
      sb.from('parcelas').select('valor, vencimento, contratos!inner(cliente_id)').is('pago_em', null),
      temProcessos ? sb.from('clientes_processos').select('cliente_id') : Promise.resolve({ data: [] }),
    ]);
    resumoCli = new Map();
    const h = hoje();
    for (const p of ab.data || []) {
      const r = resumoCli.get(p.contratos.cliente_id) || { aReceber: 0, vencido: 0, procs: 0 };
      r.aReceber += Number(p.valor); if (p.vencimento < h) r.vencido += Number(p.valor);
      resumoCli.set(p.contratos.cliente_id, r);
    }
    for (const v of vp.data || []) { const r = resumoCli.get(v.cliente_id) || { aReceber: 0, vencido: 0, procs: 0 }; r.procs++; resumoCli.set(v.cliente_id, r); }
    const q = $('q').value.trim().toLowerCase(), qd = digitos(q);
    const lista = clientes.filter((c) => ($('f-inativos').checked || c.ativo) &&
      (!q || [c.nome, c.email, c.observacoes].some((x) => String(x || '').toLowerCase().includes(q)) || (qd.length >= 3 && (digitos(c.documento).includes(qd) || digitos(c.telefone).includes(qd)))));
    $('clientes-body').innerHTML = lista.map((c) => {
      const r = resumoCli.get(c.id) || {};
      return `<tr class="click" data-id="${c.id}">
        <td><b>${esc(c.nome)}</b>${c.ativo ? '' : ' <span class="pill">inativo</span>'}</td>
        <td class="small" style="white-space:nowrap">${esc(fmtDoc(c.documento))}</td>
        <td class="small">${esc(fmtTel(c.telefone))}${c.email ? `<div class="muted">${esc(c.email)}</div>` : ''}</td>
        <td class="num">${r.procs || ''}</td>
        <td class="num">${r.aReceber ? moeda(r.aReceber) : ''}</td>
        <td class="num" style="color:var(--danger)">${r.vencido ? moeda(r.vencido) : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="vazio">${clientes.length ? 'Nenhum cliente encontrado.' : 'Nenhum cliente ainda. Clique em <b>Novo cliente</b>.'}</td></tr>`;
  }
  $('clientes-body').addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr) location.hash = '#/c/' + tr.dataset.id; });
  $('q').addEventListener('input', renderClientes);
  $('f-inativos').addEventListener('change', renderClientes);
  $('btn-export-clientes').addEventListener('click', () => {
    const rows = [['Nome', 'Tipo', 'CPF/CNPJ', 'E-mail', 'Telefone', 'Endereço', 'Ativo', 'A receber', 'Vencido', 'Observações']];
    for (const c of clientes) { const r = resumoCli.get(c.id) || {}; rows.push([c.nome, c.tipo, fmtDoc(c.documento), c.email || '', fmtTel(c.telefone), c.endereco || '', c.ativo ? 'sim' : 'não', r.aReceber || 0, r.vencido || 0, c.observacoes || '']); }
    Export.download(Export.xlsx([{ name: 'Clientes', rows }]), `clientes_${hoje()}.xlsx`);
  });

  // ===================== Parcelas (aba) =====================
  let parcLista = [];
  async function carregarParcelas() {
    const f = $('f-parc').value, mes = $('f-mes').value;
    $('f-mes-wrap').classList.toggle('hidden', f !== 'recebidas');
    let q = sb.from('parcelas').select(SEL_PARC);
    if (f === 'abertas') q = q.is('pago_em', null).order('vencimento');
    else if (f === 'vencidas') q = q.is('pago_em', null).lt('vencimento', hoje()).order('vencimento');
    else {
      q = q.not('pago_em', 'is', null).order('pago_em', { ascending: false });
      if (mes) { const fim = ymd(new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0)); q = q.gte('pago_em', mes + '-01').lte('pago_em', fim); }
    }
    const { data, error } = await q.limit(1000);
    if (error) return fail(error);
    parcLista = data;
    const total = data.reduce((t, p) => t + Number(p.pago_em ? p.valor_pago : p.valor), 0);
    $('parc-total').textContent = data.length ? `${data.length} parcela(s) · total ${moeda(total)}` : '';
    $('parc-body').innerHTML = data.map((p) => linhaParcela(p)).join('') || '<tr><td colspan="6" class="vazio">Nenhuma parcela.</td></tr>';
    if (f !== 'recebidas') contarVencidas(data.filter((p) => p.vencimento < hoje()).length);
  }
  $('f-parc').addEventListener('change', carregarParcelas);
  $('f-mes').addEventListener('change', carregarParcelas);
  $('btn-export-parcelas').addEventListener('click', () => {
    const rows = [['Vencimento', 'Cliente', 'Contrato', 'Descrição', 'Valor', 'Recebido em', 'Valor recebido', 'Forma', 'Recibo nº']];
    for (const p of parcLista) rows.push([brDate(p.vencimento), p.contratos.clientes.nome, p.contratos.descricao, p.descricao || '', Number(p.valor), p.pago_em ? brDate(p.pago_em) : '', p.valor_pago ? Number(p.valor_pago) : '', p.forma ? FORMAS[p.forma] : '', p.recibo_numero || '']);
    Export.download(Export.xlsx([{ name: 'Parcelas', rows }]), `parcelas_${$('f-parc').value}_${hoje()}.xlsx`);
  });

  // ações nas linhas de parcela (painel, aba Parcelas e ficha do cliente)
  async function acaoParcela(ev, lista) {
    const b = ev.target.closest('button[data-pact]'); if (!b) return;
    const p = lista().find((x) => x.id === b.closest('tr').dataset.parc); if (!p) return;
    const act = b.dataset.pact;
    if (act === 'receber') return abrirReceber(p);
    if (act === 'recibo') return gerarRecibo(p.id);
    if (act === 'cobrar') return cobrar(p);
    if (act === 'editar') return abrirParcela(p.contrato_id, p);
    if (act === 'desfazer') {
      if (!confirm(`Desfazer o recebimento de ${moeda(p.valor_pago)} em ${brDate(p.pago_em)}?${p.recibo_numero ? `\nO recibo nº ${p.recibo_numero} já emitido perde o efeito.` : ''}`)) return;
      const { error } = await sb.from('parcelas').update({ pago_em: null, valor_pago: null, forma: null }).eq('id', p.id);
      if (error) return fail(error);
      return atualizar();
    }
    if (act === 'del') {
      if (!confirm(`Apagar a parcela de ${moeda(p.valor)} com vencimento em ${brDate(p.vencimento)}?`)) return;
      const { error } = await sb.from('parcelas').delete().eq('id', p.id);
      if (error) return fail(error);
      return atualizar();
    }
  }
  $('painel-body').addEventListener('click', (ev) => acaoParcela(ev, () => painelLista));
  $('parc-body').addEventListener('click', (ev) => acaoParcela(ev, () => parcLista));
  function atualizar() { if (atual) abrirCliente(atual.id); else mostrarAba(aba); }

  function cobrar(p) {
    const cl = p.contratos?.clientes || atual;
    const n = diasAte(p.vencimento);
    const msg = `Olá, ${cl.nome.split(' ')[0]}! Tudo bem? Passando para lembrar da parcela de honorários de ${moeda(p.valor)}` +
      ` (${p.contratos?.descricao || contratos.find((c) => c.id === p.contrato_id)?.descricao || 'contrato'})` +
      (n < 0 ? `, vencida em ${brDate(p.vencimento)}.` : n === 0 ? ', que vence hoje.' : `, com vencimento em ${brDate(p.vencimento)}.`) +
      (emitente?.chave_pix ? ` Chave PIX: ${emitente.chave_pix}.` : '') + ' Obrigado!';
    const url = waLink(cl.telefone, msg);
    if (!url) return toast('Cadastre o telefone do cliente para enviar pelo WhatsApp.', true);
    window.open(url, '_blank', 'noopener');
  }

  // ===================== Ficha do cliente =====================
  let seqCli = 0;
  async function abrirCliente(id) {
    const seq = ++seqCli;
    let c = clientes.find((x) => x.id === id);
    if (!c) { const r = await sb.from('clientes').select('*').eq('id', id).maybeSingle(); c = r.data; }
    if (!c) { toast('Cliente não encontrado.', true); location.hash = '#/clientes'; return; }
    const [ct, vp] = await Promise.all([
      sb.from('contratos').select('*, parcelas(*), contratos_anexos(*)').eq('cliente_id', id).order('data_contrato', { ascending: false }),
      temProcessos ? sb.from('clientes_processos').select('processo_id').eq('cliente_id', id) : Promise.resolve({ data: [] }),
    ]);
    if (ct.error) return fail(ct.error);
    if (seq !== seqCli) return;   // chegou uma resposta mais nova
    atual = c; contratos = ct.data; vinculos = (vp.data || []).map((v) => v.processo_id);
    for (const k of contratos) k.contratos_anexos.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const k of contratos) k.parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
    renderCliente();
  }
  function renderCliente() {
    const c = atual;
    document.title = `${c.nome} — Clientes`;
    $('c-nome').textContent = c.nome;
    $('c-sub').innerHTML = `${c.tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}${c.documento ? ' · ' + docRotulo(c.documento) + ' ' + esc(fmtDoc(c.documento)) : ''}${c.ativo ? '' : ' · <span class="pill">inativo</span>'}`;
    const w = waLink(c.telefone); $('c-whats').classList.toggle('hidden', !w); if (w) $('c-whats').href = w;
    $('c-mail').classList.toggle('hidden', !c.email); if (c.email) $('c-mail').href = 'mailto:' + c.email;
    $('c-ficha').innerHTML = [['Telefone', fmtTel(c.telefone)], ['E-mail', c.email], ['Endereço', c.endereco], ['Observações', c.observacoes]]
      .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span>${esc(v).replace(/\n/g, '<br>')}</div>`).join('');
    // totais
    const todas = contratos.flatMap((k) => k.parcelas), h = hoje();
    const soma = (l, k = 'valor') => l.reduce((t, p) => t + Number(p[k] || 0), 0);
    // parcela recebida a menor gera um saldo à parte: conta o valor recebido, não o original
    $('c-contratado').textContent = moeda(todas.reduce((t, p) => t + Number(p.pago_em ? p.valor_pago : p.valor), 0));
    $('c-recebido').textContent = moeda(soma(todas.filter((p) => p.pago_em), 'valor_pago'));
    $('c-areceber').textContent = moeda(soma(todas.filter((p) => !p.pago_em)));
    $('c-vencido').textContent = moeda(soma(todas.filter((p) => !p.pago_em && p.vencimento < h)));
    // contratos
    $('c-contratos').innerHTML = contratos.map((k) => {
      const n = k.parcelas.length, maxN = Math.max(0, ...k.parcelas.map((p) => p.numero || 0));
      const linhas = k.parcelas.map((p) => `<tr data-parc="${p.id}">
          <td class="small">${maxN > 1 ? `${p.numero}/${maxN}` : ''}</td>
          <td style="white-space:nowrap">${brDate(p.vencimento)}</td>
          <td>${esc(p.descricao || '')}${p.pago_em ? `<div class="small muted">${FORMAS[p.forma] || ''}${p.observacao ? ' · ' + esc(p.observacao) : ''}</div>` : ''}</td>
          <td class="num">${moeda(p.valor)}${p.pago_em && Number(p.valor_pago) !== Number(p.valor) ? `<div class="small muted">recebido ${moeda(p.valor_pago)}</div>` : ''}</td>
          <td>${situacao(p)}</td>
          <td class="actions">${acoesParcela(p, atual)}${p.pago_em ? '' : ' <button data-pact="editar">Editar</button> <button class="danger" data-pact="del">×</button>'}</td></tr>`).join('');
      return `<div class="contrato ${k.status}" data-contrato="${k.id}">
        <div class="head">
          <div><h3>${esc(k.descricao)} <span class="pill">${TIPOS[k.tipo]}</span>${k.status === 'encerrado' ? ' <span class="pill">encerrado</span>' : ''}</h3>
            <div class="meta">Contrato de ${brDate(k.data_contrato)}${k.valor_total != null ? ' · ' + moeda(k.valor_total) : ''}${k.percentual_exito != null ? ` · êxito ${String(k.percentual_exito).replace('.', ',')}%` : ''}${k.processo_id ? ` · processo <a href="../processos/#/p/${k.processo_id}">${esc(procTxt(k.processo_id) || 'abrir')}</a>` : ''}${k.observacoes ? ' · ' + esc(k.observacoes) : ''}</div></div>
          <div class="row"><button class="mini" data-cact="parcela">+ Parcela</button><button class="mini" data-cact="editar">Editar</button><button class="mini danger" data-cact="del">×</button></div>
        </div>
        <div class="anexos">📎 ${k.contratos_anexos.map((a) => `<span class="anexo" data-anexo="${a.id}"><a href="#" data-aact="ver" title="Abrir">${esc(a.nome)}</a> <small class="muted">${fmtTam(a.tamanho)}</small>
            <button class="mini" data-aact="baixar" title="Baixar">⬇</button><button class="mini danger" data-aact="del" title="Apagar o arquivo">×</button></span>`).join('')
          || '<span class="muted small">Nenhum arquivo — anexe o contrato assinado (ou arraste o arquivo para cá).</span>'}
          <label class="btn mini">Anexar<input type="file" multiple hidden data-anexar accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.heic,.webp"></label></div>
        ${n ? `<div class="tabela-wrap"><table><tbody>${linhas}</tbody></table></div>` : `<p class="small muted" style="margin:8px 0 0">${k.tipo === 'exito' ? 'Quando o êxito for recebido, use “+ Parcela” para lançar o valor.' : 'Nenhuma parcela.'}</p>`}
      </div>`;
    }).join('') || '<p class="vazio">Nenhum contrato ainda. Clique em <b>Novo contrato</b>.</p>';
    // processos
    $('form-vinc').classList.toggle('hidden', !temProcessos);
    $('c-proc-sem').classList.toggle('hidden', temProcessos);
    $('c-processos').innerHTML = vinculos.map((id) => `<li data-proc="${id}"><a href="../processos/#/p/${id}">${esc(procTxt(id) || id)}</a> <button class="mini" data-desvinc>desvincular</button></li>`).join('')
      || (temProcessos ? '<li class="muted" style="list-style:none;margin-left:-18px">Nenhum processo vinculado.</li>' : '');
  }
  $('c-contratos').addEventListener('click', async (ev) => {
    const ax = ev.target.closest('[data-aact]');
    if (ax) {
      ev.preventDefault();
      const k = contratos.find((x) => x.id === ax.closest('[data-contrato]').dataset.contrato);
      const a = k.contratos_anexos.find((x) => x.id === ax.closest('[data-anexo]').dataset.anexo);
      return acaoAnexo(ax.dataset.aact, a);
    }
    if (ev.target.closest('button[data-pact]')) return acaoParcela(ev, () => contratos.flatMap((k) => k.parcelas.map((p) => ({ ...p, contratos: { descricao: k.descricao, clientes: atual } }))));
    const b = ev.target.closest('button[data-cact]'); if (!b) return;
    const k = contratos.find((x) => x.id === b.closest('[data-contrato]').dataset.contrato);
    if (b.dataset.cact === 'editar') return abrirContrato(k);
    if (b.dataset.cact === 'parcela') return abrirParcela(k.id, null);
    if (b.dataset.cact === 'del') {
      const pagas = k.parcelas.filter((p) => p.pago_em).length;
      if (!confirm(`Apagar o contrato "${k.descricao}" e as ${k.parcelas.length} parcela(s)?${pagas ? `\n\nAtenção: ${pagas} já foram recebidas e o histórico desses recebimentos será perdido.` : ''}`)) return;
      if (k.contratos_anexos.length && !confirm(`Os ${k.contratos_anexos.length} arquivo(s) anexado(s) a este contrato também serão apagados. Continuar?`)) return;
      await apagarArquivos(k.contratos_anexos);
      const { error } = await sb.from('contratos').delete().eq('id', k.id);
      if (error) return fail(error);
      abrirCliente(atual.id);
    }
  });
  $('form-vinc').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = procDoTexto($('vinc-proc').value);
    if (!p) return toast('Escolha um processo da lista.', true);
    const { error } = await sb.from('clientes_processos').insert({ cliente_id: atual.id, processo_id: p.id });
    if (error && !/duplicate/i.test(error.message)) return fail(error);
    $('vinc-proc').value = ''; abrirCliente(atual.id);
  });
  $('c-processos').addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-desvinc]')) return;
    const id = ev.target.closest('li').dataset.proc;
    const { error } = await sb.from('clientes_processos').delete().eq('cliente_id', atual.id).eq('processo_id', id);
    if (error) return fail(error);
    abrirCliente(atual.id);
  });

  // ===================== Cliente (criar / editar / excluir) =====================
  let editCli = null;
  function abrirFormCliente(c) {
    editCli = c;
    $('cli-titulo').textContent = c ? 'Editar cliente' : 'Novo cliente';
    $('cli-nome').value = c?.nome || ''; $('cli-tipo').value = c?.tipo || 'PF'; $('cli-doc').value = fmtDoc(c?.documento);
    $('cli-email').value = c?.email || ''; $('cli-tel').value = fmtTel(c?.telefone); $('cli-end').value = c?.endereco || '';
    $('cli-obs').value = c?.observacoes || ''; $('cli-ativo').checked = c ? c.ativo : true;
    dicaDoc(); $('dlg-cliente').showModal(); $('cli-nome').focus();
  }
  function dicaDoc() {
    const d = digitos($('cli-doc').value), h = $('cli-doc-hint');
    if (!d) { h.textContent = ''; return true; }
    const ok = d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false;
    h.textContent = ok ? `${docRotulo(d)} válido ✓` : d.length === 11 || d.length === 14 ? `${docRotulo(d)} inválido — confira os números` : 'CPF tem 11 dígitos; CNPJ, 14';
    h.style.color = ok ? '' : 'var(--danger)';
    if (ok) $('cli-tipo').value = d.length === 14 ? 'PJ' : 'PF';
    return ok;
  }
  $('cli-doc').addEventListener('input', dicaDoc);
  $('cli-doc').addEventListener('blur', () => { const d = digitos($('cli-doc').value); if (d.length === 11 || d.length === 14) $('cli-doc').value = fmtDoc(d); });
  $('cli-tel').addEventListener('blur', () => { $('cli-tel').value = fmtTel($('cli-tel').value); });
  $('btn-novo-cliente').addEventListener('click', () => abrirFormCliente(null));
  $('btn-novo-cliente2').addEventListener('click', () => abrirFormCliente(null));
  $('c-edit').addEventListener('click', () => abrirFormCliente(atual));
  $('form-cliente').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const doc = digitos($('cli-doc').value);
    if (doc && !dicaDoc() && !confirm('O CPF/CNPJ parece inválido. Salvar mesmo assim?')) return;
    const row = { nome: $('cli-nome').value.trim(), tipo: $('cli-tipo').value, documento: doc || null, email: $('cli-email').value.trim() || null,
      telefone: digitos($('cli-tel').value) || null, endereco: $('cli-end').value.trim() || null, observacoes: $('cli-obs').value.trim() || null, ativo: $('cli-ativo').checked };
    if (!row.nome) return;
    const q = editCli ? sb.from('clientes').update(row).eq('id', editCli.id).select().single() : sb.from('clientes').insert(row).select().single();
    const { data, error } = await q;
    if (error) return fail(/clientes_user_doc_idx|duplicate/i.test(error.message) ? new Error('Já existe um cliente com esse CPF/CNPJ.') : error);
    $('dlg-cliente').close();
    await carregarBase();
    toast('Cliente salvo.');
    if (editCli) abrirCliente(data.id); else location.hash = '#/c/' + data.id;
  });
  $('c-del').addEventListener('click', async () => {
    const n = contratos.reduce((t, k) => t + k.parcelas.length, 0);
    if (!confirm(`Excluir ${atual.nome}${contratos.length ? `, com ${contratos.length} contrato(s) e ${n} parcela(s)` : ''}?\n\nIsso não pode ser desfeito. Para só tirar da lista, edite e desmarque "Cliente ativo".`)) return;
    await apagarArquivos(contratos.flatMap((k) => k.contratos_anexos));
    const { error } = await sb.from('clientes').delete().eq('id', atual.id);
    if (error) return fail(error);
    await carregarBase(); toast('Cliente excluído.'); location.hash = '#/clientes';
  });

  // ===================== Contrato =====================
  let editCt = null;
  function abrirContrato(k) {
    editCt = k;
    $('ct-titulo').textContent = k ? 'Editar contrato' : 'Novo contrato';
    $('ct-desc').value = k?.descricao || ''; $('ct-tipo').value = k?.tipo || 'fixo'; $('ct-data').value = k?.data_contrato || hoje();
    $('ct-proc').value = k?.processo_id ? procTxt(k.processo_id) : (vinculos.length === 1 ? procTxt(vinculos[0]) : '');
    $('ct-proc-wrap').classList.toggle('hidden', !temProcessos);
    $('ct-valor').value = valorTxt(k?.valor_total); $('ct-perc').value = k?.percentual_exito != null ? String(k.percentual_exito).replace('.', ',') : '';
    $('ct-mensal').value = ''; $('ct-n').value = 1; $('ct-venc').value = hoje(); $('ct-obs').value = k?.observacoes || '';
    $('ct-gerar').classList.toggle('hidden', !!k);
    $('ct-arquivo').value = ''; $('ct-arquivo-wrap').classList.toggle('hidden', !!k);
    $('ct-status-wrap').classList.toggle('hidden', !k); $('ct-encerrado').checked = k?.status === 'encerrado';
    ajustarContrato(); $('dlg-contrato').showModal(); $('ct-desc').focus();
  }
  function planoParcelas() {
    const tipo = $('ct-tipo').value, n = Math.max(1, Math.min(120, Math.round(+$('ct-n').value || 1))), v1 = $('ct-venc').value;
    if (!v1 || tipo === 'exito') return [];
    if (tipo === 'mensal') {
      const m = lerValor($('ct-mensal').value); if (!(m > 0)) return [];
      return Array.from({ length: n }, (_, i) => ({ numero: i + 1, vencimento: somarMeses(v1, i), valor: m }));
    }
    const total = lerValor($('ct-valor').value); if (!(total > 0)) return [];
    const centavos = Math.round(total * 100), base = Math.floor(centavos / n);
    return Array.from({ length: n }, (_, i) => ({ numero: i + 1, vencimento: somarMeses(v1, i), valor: (i === n - 1 ? centavos - base * (n - 1) : base) / 100 }));
  }
  function ajustarContrato() {
    const tipo = $('ct-tipo').value;
    $('ct-valor-wrap').classList.toggle('hidden', tipo === 'mensal' || tipo === 'exito');
    $('ct-mensal-wrap').classList.toggle('hidden', tipo !== 'mensal' || !!editCt);
    $('ct-perc-wrap').classList.toggle('hidden', !(tipo === 'exito' || tipo === 'misto'));
    $('ct-n-rot').textContent = tipo === 'mensal' ? 'Nº de meses' : 'Nº de parcelas';
    $('ct-gerar').classList.toggle('hidden', !!editCt || tipo === 'exito');
    const plano = planoParcelas();
    $('ct-prev').innerHTML = plano.length
      ? `${plano.length}× · total ${moeda(plano.reduce((t, p) => t + p.valor, 0))}<br>` + plano.slice(0, 12).map((p) => `${brDate(p.vencimento)}: ${moeda(p.valor)}`).join(' · ') + (plano.length > 12 ? ' …' : '')
      : 'Informe o valor e o 1º vencimento para gerar as parcelas.';
  }
  ['ct-tipo', 'ct-valor', 'ct-mensal', 'ct-n', 'ct-venc'].forEach((id) => $(id).addEventListener('input', ajustarContrato));
  $('c-novo-contrato').addEventListener('click', () => abrirContrato(null));
  $('form-contrato').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const tipo = $('ct-tipo').value;
    const proc = $('ct-proc').value.trim() ? procDoTexto($('ct-proc').value) : null;
    if ($('ct-proc').value.trim() && !proc) return toast('Escolha o processo da lista (ou deixe em branco).', true);
    let valor = tipo === 'mensal' || tipo === 'exito' ? null : lerValor($('ct-valor').value);
    const perc = tipo === 'exito' || tipo === 'misto' ? lerValor($('ct-perc').value) : null;
    if (Number.isNaN(valor) || Number.isNaN(perc)) return toast('Confira os valores.', true);
    const plano = editCt ? [] : planoParcelas();
    if (tipo === 'mensal' && plano.length) valor = Math.round(plano.reduce((t, p) => t + p.valor, 0) * 100) / 100;
    if (!editCt && tipo !== 'exito' && !plano.length && !confirm('Nenhuma parcela será gerada (falta valor ou vencimento). Salvar assim mesmo?')) return;
    const row = { descricao: $('ct-desc').value.trim(), tipo, data_contrato: $('ct-data').value, processo_id: proc?.id || null,
      valor_total: valor ?? (editCt?.tipo === 'mensal' ? editCt.valor_total : null), percentual_exito: perc, observacoes: $('ct-obs').value.trim() || null };
    if (editCt) row.status = $('ct-encerrado').checked ? 'encerrado' : 'ativo';
    const { data, error } = editCt ? await sb.from('contratos').update(row).eq('id', editCt.id).select().single()
      : await sb.from('contratos').insert({ ...row, cliente_id: atual.id }).select().single();
    if (error) return fail(error);
    if (plano.length) {
      const { error: e2 } = await sb.from('parcelas').insert(plano.map((p) => ({ ...p, contrato_id: data.id })));
      if (e2) return fail(e2);
    }
    if (proc && !vinculos.includes(proc.id)) await sb.from('clientes_processos').insert({ cliente_id: atual.id, processo_id: proc.id });
    const arqs = [...$('ct-arquivo').files];
    $('dlg-contrato').close();
    if (arqs.length) await anexar(data.id, arqs); toast(plano.length ? `Contrato salvo com ${plano.length} parcela(s).` : 'Contrato salvo.');
    abrirCliente(atual.id);
  });

  // ===================== Parcela avulsa =====================
  let editPa = null, paContrato = null;
  function abrirParcela(contratoId, p) {
    editPa = p; paContrato = contratoId;
    $('pa-titulo').textContent = p ? 'Editar parcela' : 'Nova parcela';
    $('pa-desc').value = p?.descricao || ''; $('pa-venc').value = p?.vencimento || hoje(); $('pa-valor').value = valorTxt(p?.valor);
    $('dlg-parcela').showModal(); $('pa-valor').focus();
  }
  $('form-parcela').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const valor = lerValor($('pa-valor').value);
    if (!(valor > 0)) return toast('Informe um valor maior que zero.', true);
    const row = { descricao: $('pa-desc').value.trim() || null, vencimento: $('pa-venc').value, valor };
    const k = contratos.find((x) => x.id === paContrato);
    const { error } = editPa ? await sb.from('parcelas').update(row).eq('id', editPa.id)
      : await sb.from('parcelas').insert({ ...row, contrato_id: paContrato, numero: (k?.parcelas.length || 0) + 1 });
    if (error) return fail(error);
    $('dlg-parcela').close(); atualizar();
  });

  // ===================== Recebimento =====================
  let rcParc = null;
  function abrirReceber(p) {
    rcParc = p;
    $('rc-desc').textContent = `${p.contratos?.clientes?.nome || atual?.nome || ''} — ${p.contratos?.descricao || ''} · ${moeda(p.valor)}, vencimento ${brDate(p.vencimento)}`;
    $('rc-data').value = hoje(); $('rc-data').max = hoje(); $('rc-valor').value = valorTxt(p.valor); $('rc-obs').value = '';
    $('dlg-receber').showModal();
  }
  $('form-receber').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const valor = lerValor($('rc-valor').value);
    if (!(valor > 0)) return toast('Informe o valor recebido.', true);
    const { error } = await sb.from('parcelas').update({ pago_em: $('rc-data').value, valor_pago: valor, forma: $('rc-forma').value,
      observacao: $('rc-obs').value.trim() || rcParc.observacao || null }).eq('id', rcParc.id);
    if (error) return fail(error);
    $('dlg-receber').close();
    toast(`Recebimento de ${moeda(valor)} registrado.`);
    if (valor < Number(rcParc.valor) - 0.005 && confirm(`Recebido ${moeda(valor)} de ${moeda(rcParc.valor)}. Lançar o saldo de ${moeda(rcParc.valor - valor)} como nova parcela?`)) {
      await sb.from('parcelas').insert({ contrato_id: rcParc.contrato_id, numero: rcParc.numero, vencimento: rcParc.vencimento,
        valor: Math.round((rcParc.valor - valor) * 100) / 100, descricao: 'Saldo da parcela' + (rcParc.descricao ? ' — ' + rcParc.descricao : '') });
    }
    if ($('rc-recibo').checked) await gerarRecibo(rcParc.id);
    atualizar();
  });

  // ===================== Anexos dos contratos =====================
  const BUCKET = 'contratos', LIMITE = 50 * 1024 * 1024;
  const fmtTam = (b) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
  const nomeSeguro = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120);
  async function anexar(contratoId, arquivos) {
    let ok = 0;
    for (const f of arquivos) {
      if (f.size > LIMITE) { toast(`"${f.name}" tem ${fmtTam(f.size)}; o limite é 50 MB. Reduza o arquivo (ex.: PDF em qualidade menor) e tente de novo.`, true); continue; }
      const path = `${usuario.id}/${contratoId}/${crypto.randomUUID()}-${nomeSeguro(f.name)}`;
      toast(`Enviando ${f.name}…`);
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (up.error) { fail(up.error); continue; }
      const { error } = await sb.from('contratos_anexos').insert({ contrato_id: contratoId, nome: f.name, storage_path: path, tamanho: f.size, tipo: f.type || null });
      if (error) { await sb.storage.from(BUCKET).remove([path]); fail(error); continue; }
      ok++;
    }
    if (ok) toast(`${ok} arquivo(s) anexado(s).`);
    if (atual) abrirCliente(atual.id);
  }
  async function apagarArquivos(lista) {
    if (!lista.length) return;
    const { error } = await sb.storage.from(BUCKET).remove(lista.map((a) => a.storage_path));
    if (error) console.error('arquivos não apagados', error);
  }
  async function acaoAnexo(acao, a) {
    if (acao === 'del') {
      if (!confirm(`Apagar o arquivo "${a.nome}"?`)) return;
      const { error } = await sb.storage.from(BUCKET).remove([a.storage_path]);
      if (error) return fail(error);
      const { error: e2 } = await sb.from('contratos_anexos').delete().eq('id', a.id);
      if (e2) return fail(e2);
      toast('Arquivo apagado.'); return abrirCliente(atual.id);
    }
    // link temporário (5 min): o arquivo nunca fica público
    const janela = acao === 'ver' ? window.open('', '_blank') : null;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.storage_path, 300, acao === 'baixar' ? { download: a.nome } : undefined);
    if (error) { janela?.close(); return fail(error); }
    if (janela) janela.location = data.signedUrl; else location.href = data.signedUrl;
  }
  // botão "Anexar" e arrastar arquivo para o cartão do contrato
  $('c-contratos').addEventListener('change', (ev) => {
    const inp = ev.target.closest('input[data-anexar]'); if (!inp || !inp.files.length) return;
    anexar(inp.closest('[data-contrato]').dataset.contrato, [...inp.files]);
  });
  $('c-contratos').addEventListener('dragover', (ev) => { const c = ev.target.closest('.contrato'); if (!c) return; ev.preventDefault(); c.classList.add('soltar'); });
  $('c-contratos').addEventListener('dragleave', (ev) => { ev.target.closest('.contrato')?.classList.remove('soltar'); });
  $('c-contratos').addEventListener('drop', (ev) => {
    const c = ev.target.closest('.contrato'); if (!c) return;
    ev.preventDefault(); c.classList.remove('soltar');
    if (ev.dataTransfer.files.length) anexar(c.dataset.contrato, [...ev.dataTransfer.files]);
  });

  // ===================== Recibo em PDF =====================
  function carregarPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = '../assets/vendor/pdf-lib-1.17.1.min.js';
      s.onload = () => ok(window.PDFLib); s.onerror = () => erro(new Error('não foi possível carregar o gerador de PDF')); document.head.appendChild(s);
    });
  }
  let reciboPendente = null;
  async function gerarRecibo(parcelaId) {
    if (!emitente?.nome) { reciboPendente = parcelaId; toast('Preencha os dados do recibo (uma vez só).'); return abrirEmitente(); }
    const { data: p, error } = await sb.from('parcelas').select('*, contratos(descricao, processo_id, parcelas(id, vencimento, numero), clientes(nome, documento, tipo))').eq('id', parcelaId).single();
    if (error) return fail(error);
    if (!p.pago_em) return toast('Registre o recebimento antes de gerar o recibo.', true);
    let numero = p.recibo_numero;
    if (!numero) {
      const { data: n, error: e2 } = await sb.rpc('proximo_recibo');
      if (e2) return fail(e2);
      numero = n;
      await sb.from('parcelas').update({ recibo_numero: numero }).eq('id', p.id);
    }
    try {
      const bytes = await montarRecibo(p, numero);
      const nome = `recibo_${String(numero).padStart(4, '0')}_${p.contratos.clientes.nome.normalize('NFD').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '_').toLowerCase()}.pdf`;
      Export.download(new Blob([bytes], { type: 'application/pdf' }), nome);
    } catch (e) { fail(e); }
  }
  async function montarRecibo(p, numero) {
    const { PDFDocument, StandardFonts, rgb } = await carregarPdfLib();
    const doc = await PDFDocument.create();
    doc.setTitle(`Recibo nº ${numero}`); doc.setProducer('mantini.ia.br'); doc.setCreator('mantini.ia.br — Clientes');
    const pg = doc.addPage([595.28, 841.89]);
    const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
    const preto = rgb(0.1, 0.11, 0.13), cinza = rgb(0.42, 0.45, 0.5), verm = rgb(0.9, 0.22, 0.27);
    const M = 64, L = 595.28 - 2 * M;
    let y = 770;
    const texto = (t, x, yy, o = {}) => pg.drawText(t, { x, y: yy, size: o.size || 11, font: o.font || f, color: o.color || preto });
    function paragrafo(t, size = 12.5, lh = 20, font = f) {
      const palavras = t.split(' '); let linha = '';
      for (const w of palavras) {
        const tent = linha ? linha + ' ' + w : w;
        if (font.widthOfTextAtSize(tent, size) > L && linha) { texto(linha, M, y, { size, font }); y -= lh; linha = w; } else linha = tent;
      }
      if (linha) { texto(linha, M, y, { size, font }); y -= lh; }
    }
    // cabeçalho
    texto('RECIBO', M, y, { size: 26, font: fb });
    const nTxt = `Nº ${String(numero).padStart(4, '0')}`;
    texto(nTxt, M + L - fb.widthOfTextAtSize(nTxt, 12), y + 10, { size: 12, font: fb, color: cinza });
    const vTxt = moeda(p.valor_pago);
    pg.drawRectangle({ x: M + L - 170, y: y - 30, width: 170, height: 30, borderColor: verm, borderWidth: 1.5 });
    texto(vTxt, M + L - 85 - fb.widthOfTextAtSize(vTxt, 15) / 2, y - 20, { size: 15, font: fb });
    y -= 60;
    pg.drawLine({ start: { x: M, y }, end: { x: M + L, y }, thickness: 0.8, color: rgb(0.85, 0.86, 0.88) });
    y -= 34;
    const cl = p.contratos.clientes, ct = p.contratos;
    const parcelasCt = (ct.parcelas || []).slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
    const maxN = Math.max(0, ...parcelasCt.map((x) => x.numero || 0));
    const refParc = maxN > 1 ? `, parcela ${p.numero}/${maxN}` : '';
    const proc = ct.processo_id ? processos.find((x) => x.id === ct.processo_id) : null;
    const docCli = cl.documento ? `, inscrito(a) no ${docRotulo(cl.documento)} sob o nº ${fmtDoc(cl.documento)}` : '';
    paragrafo(`Recebi de ${cl.nome}${docCli}, a importância de ${moeda(p.valor_pago)} (${extenso(p.valor_pago)}), ` +
      `referente a honorários advocatícios — ${ct.descricao}${refParc}${p.descricao ? ' (' + p.descricao + ')' : ''}${proc ? `, processo nº ${proc.numero}` : ''}.`);
    y -= 6;
    paragrafo(`Pagamento recebido por ${FORMAS[p.forma] || 'meio não informado'} em ${brDate(p.pago_em)}.`);
    paragrafo('Para clareza, firmo o presente recibo, dando plena quitação do valor acima.');
    y -= 26;
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const [a, m, d] = p.pago_em.split('-').map(Number);
    const dataTxt = `${emitente.cidade ? emitente.cidade + ', ' : ''}${d} de ${meses[m - 1]} de ${a}.`;
    texto(dataTxt, M + L - f.widthOfTextAtSize(dataTxt, 12), y, { size: 12 });
    y -= 90;
    const cx = M + L / 2;
    pg.drawLine({ start: { x: cx - 150, y }, end: { x: cx + 150, y }, thickness: 0.8, color: preto });
    y -= 16;
    const centro = (t, o) => texto(t, cx - (o?.font || f).widthOfTextAtSize(t, o?.size || 11) / 2, y, o);
    centro(emitente.nome, { font: fb, size: 12 }); y -= 15;
    if (emitente.oab) { centro(emitente.oab, { color: cinza }); y -= 14; }
    if (emitente.documento) { const dd = digitos(emitente.documento); centro(`${docRotulo(dd)} ${fmtDoc(dd)}`, { color: cinza }); y -= 14; }
    if (emitente.endereco) { centro(emitente.endereco, { color: cinza, size: 10 }); y -= 14; }
    texto(`Recibo nº ${String(numero).padStart(4, '0')} · emitido em ${new Date().toLocaleDateString('pt-BR')}`, M, 50, { size: 8.5, color: cinza });
    return doc.save();
  }

  // ===================== Emitente =====================
  function abrirEmitente() {
    $('em-nome').value = emitente?.nome || ''; $('em-doc').value = fmtDoc(digitos(emitente?.documento));
    $('em-oab').value = emitente?.oab || ''; $('em-end').value = emitente?.endereco || '';
    $('em-cidade').value = emitente?.cidade || ''; $('em-pix').value = emitente?.chave_pix || '';
    $('dlg-emitente').showModal();
  }
  $('btn-emitente').addEventListener('click', abrirEmitente);
  $('form-emitente').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') { reciboPendente = null; return; }
    ev.preventDefault();
    const row = { nome: $('em-nome').value.trim(), documento: digitos($('em-doc').value) || null, oab: $('em-oab').value.trim() || null,
      endereco: $('em-end').value.trim() || null, cidade: $('em-cidade').value.trim() || null, chave_pix: $('em-pix').value.trim() || null, updated_at: new Date().toISOString() };
    const { data, error } = await sb.from('emitente').upsert(row, { onConflict: 'user_id' }).select().single();
    if (error) return fail(error);
    emitente = data; $('dlg-emitente').close(); toast('Dados do recibo salvos.');
    if (reciboPendente) { const id = reciboPendente; reciboPendente = null; await gerarRecibo(id); atualizar(); }
  });

  // ===================== Início =====================
  Auth.ready.then(async ({ user }) => { usuario = user; await carregarBase(); route(); });
})();
