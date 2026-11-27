// Resumo dos melhores momentos: analisa o som e a imagem dos vídeos e monta um MP4 curto só com os lances escolhidos.
//  - Futebol: picos de volume (gritos, comemoração) — candidatos a gol, que você confirma pelas miniaturas.
//  - Bike: velocidade do pedal (GPX/TCX exportado do Strava) alinhada pela hora da gravação; sem GPS, estimativa
//    pelo ruído de vento no microfone e pelo movimento da imagem.
// Tudo no navegador, como a junção: nada é enviado.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const J = () => window.JuntarVideos;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDur = (s) => { const neg = s < 0; s = Math.abs(Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`); };
  const num = (v, d = 1) => v.toFixed(d).replace('.', ',');

  const PASSO = 0.5;        // segundos por amostra da análise
  const PASSO_MINI = 2;     // uma miniatura a cada 2 s

  // ---------------- coleta (durante a conversão ou numa passada só de análise) ----------------
  function criarColetor() {
    const acc = [], mov = [], miniaturas = new Map(), arquivos = [];
    let temAudio = false, proxMov = 0, proxMini = 0, cinzaAnt = null, tAnt = -9, lp = 0, lpTaxa = 0, lpA = 0;
    const cMov = new OffscreenCanvas(32, 18), xMov = cMov.getContext('2d', { willReadFrequently: true });
    const cMini = new OffscreenCanvas(160, 90), xMini = cMini.getContext('2d', { alpha: false });
    return {
      inicioArquivo(file, info, t0) {
        // a câmera grava a hora do FIM do arquivo; o início é essa hora menos a duração
        arquivos.push({ nome: file.name, t0, dur: info.duracao, inicioMs: file.lastModified - info.duracao * 1000 });
        lp = 0;
      },
      /** f: amostras mono (Float32) na taxa original; tIni: segundo do vídeo juntado da primeira amostra */
      audio(f, taxa, tIni) {
        if (!f.length) return;
        temAudio = true;
        if (taxa !== lpTaxa) { lpTaxa = taxa; lpA = 1 - Math.exp(-2 * Math.PI * 200 / taxa); }   // passa-baixa 200 Hz = vento
        let b = Math.floor(tIni / PASSO), fimB = (b + 1) * PASSO, c = acc[b] || (acc[b] = [0, 0, 0]);
        for (let i = 0; i < f.length; i++) {
          const t = tIni + i / taxa;
          if (t >= fimB) { b = Math.floor(t / PASSO); fimB = (b + 1) * PASSO; c = acc[b] || (acc[b] = [0, 0, 0]); }
          const x = f[i]; lp += lpA * (x - lp);
          c[0] += x * x; c[1] += lp * lp; c[2]++;
        }
      },
      querQuadro(t) { return t >= proxMov || t >= proxMini; },
      async quadro(img, t) {
        if (t >= proxMov) {
          xMov.drawImage(img, 0, 0, 32, 18);
          const d = xMov.getImageData(0, 0, 32, 18).data, cinza = new Float32Array(576);
          for (let i = 0; i < 576; i++) cinza[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
          if (cinzaAnt && t - tAnt < 1.5) { let s = 0; for (let i = 0; i < 576; i++) s += Math.abs(cinza[i] - cinzaAnt[i]); mov[Math.floor(t / PASSO)] = s / 576; }
          cinzaAnt = cinza; tAnt = t; proxMov = (Math.floor(t / PASSO) + 1) * PASSO;
        }
        if (t >= proxMini) {
          const k = Math.floor(t / PASSO_MINI);
          xMini.drawImage(img, 0, 0, 160, 90);
          miniaturas.set(k, await cMini.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
          proxMini = (k + 1) * PASSO_MINI;
        }
      },
      fim(dur) {
        const n = Math.max(1, Math.ceil(dur / PASSO));
        const db = new Float32Array(n).fill(NaN), baixo = new Float32Array(n).fill(NaN), m = new Float32Array(n).fill(NaN);
        for (let i = 0; i < n; i++) {
          const c = acc[i];
          if (c && c[2]) { db[i] = 10 * Math.log10(c[0] / c[2] + 1e-10); baixo[i] = 10 * Math.log10(c[1] / c[2] + 1e-10); }
          if (mov[i] != null) m[i] = mov[i];
        }
        return { dur, db, baixo, mov: m, temAudio, arquivos, miniaturas };
      },
    };
  }

  // ---------------- séries ----------------
  function media(a, raio) {                    // média móvel ignorando NaN
    const n = a.length, out = new Float32Array(n).fill(NaN);
    let s = 0, k = 0;
    const add = (i, sinal) => { if (i >= 0 && i < n && !Number.isNaN(a[i])) { s += sinal * a[i]; k += sinal; } };
    for (let i = -raio; i <= raio; i++) add(i, 1);
    for (let i = 0; i < n; i++) { if (k) out[i] = s / k; add(i - raio, -1); add(i + raio + 1, 1); }
    return out;
  }
  function mediana(a, raio) {                  // mediana móvel (calculada a cada 4 amostras, basta para a "linha de base")
    const n = a.length, out = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i += 4) {
      const v = [];
      for (let j = Math.max(0, i - raio); j <= Math.min(n - 1, i + raio); j++) if (!Number.isNaN(a[j])) v.push(a[j]);
      if (!v.length) continue;
      v.sort((x, y) => x - y);
      out.fill(v[v.length >> 1], i, Math.min(n, i + 4));
    }
    return out;
  }
  function padronizar(a) {
    let s = 0, s2 = 0, k = 0;
    for (const x of a) if (!Number.isNaN(x)) { s += x; s2 += x * x; k++; }
    const m = k ? s / k : 0, dp = k ? Math.sqrt(Math.max(1e-12, s2 / k - m * m)) : 1;
    return a.map((x) => (x - m) / dp);
  }

  /** Hora real (ms, pelo relógio da câmera) do segundo t do vídeo juntado. */
  function relogio(an, t) {
    let f = an.arquivos[0];
    for (const x of an.arquivos) if (x.t0 <= t) f = x;
    return f.inicioMs + (t - f.t0) * 1000;
  }

  // ---------------- trilha do Strava (GPX ou TCX) ----------------
  function lerTrilha(texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('o arquivo não é um GPX/TCX válido');
    const pts = [];
    const txt = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent;
    for (const p of doc.getElementsByTagName('trkpt')) {
      const ms = Date.parse(txt(p, 'time'));
      if (ms) pts.push({ ms, lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon') });
    }
    if (!pts.length) for (const p of doc.getElementsByTagName('Trackpoint')) {
      const ms = Date.parse(txt(p, 'Time')), d = txt(p, 'DistanceMeters'), lat = txt(p, 'LatitudeDegrees'), lon = txt(p, 'LongitudeDegrees');
      if (ms && (d != null || lat != null)) pts.push({ ms, lat: lat != null ? +lat : NaN, lon: lon != null ? +lon : NaN, dist: d != null ? +d : null });
    }
    if (pts.length < 10) throw new Error('não há pontos com hora suficientes no arquivo');
    pts.sort((a, b) => a.ms - b.ms);
    // distância acumulada (a do arquivo, se houver; senão pela posição), ignorando saltos de GPS impossíveis
    const R = 6371000, rad = Math.PI / 180;
    let acum = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i && p.dist == null) {
        const q = pts[i - 1];
        const dLat = (p.lat - q.lat) * rad, dLon = (p.lon - q.lon) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(q.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLon / 2) ** 2;
        const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(h))), dt = (p.ms - q.ms) / 1000;
        if (Number.isFinite(d) && (dt <= 0 ? d < 5 : d / dt < 40)) acum += d;     // > 144 km/h = erro do GPS
      }
      p.d = p.dist != null ? p.dist : acum;
    }
    // velocidade a cada segundo: distância percorrida em ±2,5 s
    const inicio = pts[0].ms, fim = pts[pts.length - 1].ms, n = Math.floor((fim - inicio) / 1000) + 1;
    const distEm = new Float64Array(n).fill(NaN), vel = new Float32Array(n).fill(NaN);
    let j = 0;
    for (let s = 0; s < n; s++) {
      const ms = inicio + s * 1000;
      while (j < pts.length - 2 && pts[j + 1].ms <= ms) j++;
      const a = pts[j], b = pts[j + 1] || a;
      if (b.ms - a.ms > 10000) continue;                                       // pausa/sem sinal: sem velocidade
      distEm[s] = b.ms === a.ms ? a.d : a.d + (b.d - a.d) * (ms - a.ms) / (b.ms - a.ms);
    }
    let max = 0;
    for (let s = 0; s < n; s++) {
      const a = distEm[Math.max(0, s - 2)], b = distEm[Math.min(n - 1, s + 3)], dt = Math.min(n - 1, s + 3) - Math.max(0, s - 2);
      if (!Number.isNaN(a) && !Number.isNaN(b) && dt > 0) { vel[s] = Math.max(0, (b - a) / dt * 3.6); max = Math.max(max, vel[s]); }
    }
    return { inicio, fim, vel, max, km: pts[pts.length - 1].d / 1000 };
  }
  const velEm = (tr, ms) => { const i = Math.round((ms - tr.inicio) / 1000); return i >= 0 && i < tr.vel.length ? tr.vel[i] : NaN; };

  /** Sinal de "velocidade" tirado do próprio vídeo (vento no microfone e/ou movimento da imagem), padronizado. */
  function sinalVideo(an, raio) {
    const partes = [];
    if (an.temAudio) partes.push(padronizar(media(an.baixo, raio)));
    if (an.mov.some((x) => !Number.isNaN(x))) partes.push(padronizar(media(an.mov, raio)).map((x) => x * (an.temAudio ? 0.5 : 1)));
    if (!partes.length) return null;
    return partes[0].map((x, i) => partes.reduce((s, p) => s + (Number.isNaN(p[i]) ? 0 : p[i]), 0));
  }

  /** Procura o ajuste de relógio (s) em que a velocidade do GPS mais se parece com o sinal do vídeo. */
  function alinhar(an, tr) {
    const sv = sinalVideo(an, 6);
    if (!sv) return null;
    const D = Math.floor(an.dur), f = new Float32Array(D), w = new Int32Array(D);
    for (let t = 0; t < D; t++) { f[t] = sv[Math.min(sv.length - 1, Math.floor(t / PASSO))]; w[t] = Math.round((relogio(an, t) - tr.inicio) / 1000); }
    const N = tr.vel.length, minimo = Math.max(60, Math.min(D, N) * 0.5);
    let melhor = null;
    // todos os ajustes em que vídeo e trilha se sobrepõem, de 2 em 2 s
    for (let o = -w[D - 1]; o <= N - w[0]; o += 2) {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let t = 0; t < D; t += 2) {
        const j = w[t] + o; if (j < 0 || j >= N) continue;
        const y = tr.vel[j], x = f[t]; if (Number.isNaN(y) || Number.isNaN(x)) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      if (n * 2 < minimo) continue;
      const r = (n * sxy - sx * sy) / Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
      if (!melhor || r > melhor.r) melhor = { o, r };
    }
    return melhor;
  }

  // ---------------- escolha dos lances ----------------
  function picos(score, sep, max, minimo) {
    const ord = [...score.keys()].filter((i) => !Number.isNaN(score[i]) && score[i] >= minimo).sort((a, b) => score[b] - score[a]);
    const ok = [];
    for (const i of ord) {
      if (ok.length >= max) break;
      if (ok.every((j) => Math.abs(i - j) * PASSO >= sep)) ok.push(i);
    }
    return ok;
  }
  /** Corte para não encher o resumo de trechos comuns: só entra o que passa da mediana + 25% da distância até o máximo. */
  function limiar(score) {
    const v = [...score].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (!v.length) return Infinity;
    const med = v[v.length >> 1], max = v[v.length - 1];
    return med + 0.25 * (max - med);
  }
  function calcularLances(an, cfg) {
    const L = cfg.lance, dur = an.dur, lances = [];
    const corta = (a, b) => [Math.max(0, a), Math.min(dur, b)];
    if (cfg.tipo === 'futebol') {
      if (!an.temAudio) return { erro: 'Estes vídeos não têm som. O resumo de futebol procura os gols pelo som (gritos e comemoração): grave com o áudio ligado.' };
      const s = media(an.db, 3), base = mediana(an.db, 60);
      const score = s.map((x, i) => x - base[i]);
      for (const i of picos(score, Math.max(L, 20), 40, 3)) {
        const t = i * PASSO, [a, b] = corta(t - L * 0.7, t + L * 0.3);   // o gol vem antes do grito
        lances.push({ pico: t, a, b, valor: score[i], rotulo: `som +${num(score[i], 0)} dB` });
      }
      return { lances, nota: 'Os lances são os momentos de som mais alto em relação ao resto do jogo. Confira nas miniaturas e desmarque o que não foi gol.' };
    }
    const raio = Math.max(1, Math.round(L / 2 / PASSO));
    if (cfg.trilha) {
      const v = new Float32Array(an.db.length).fill(NaN);
      for (let i = 0; i < v.length; i++) v[i] = velEm(cfg.trilha, relogio(an, i * PASSO) + cfg.ajuste * 1000);
      if (v.every((x) => Number.isNaN(x))) return { erro: 'A trilha do Strava não cobre o horário destes vídeos. Use "Alinhar automaticamente" ou ajuste o relógio da câmera.' };
      const m = media(v, raio);
      for (const i of picos(m, Math.max(L, 20), 40, limiar(m))) {
        const t = i * PASSO, [a, b] = corta(t - L / 2, t + L / 2);
        let max = 0; for (let j = Math.floor(a / PASSO); j < Math.ceil(b / PASSO); j++) if (v[j] > max) max = v[j];
        lances.push({ pico: t, a, b, valor: m[i], rotulo: `${num(max, 0)} km/h` });
      }
      return { lances, nota: 'Trechos de maior velocidade média segundo o Strava.' };
    }
    const sv = sinalVideo(an, raio);
    if (!sv) return { erro: 'Sem som e sem análise de imagem, não há como estimar a velocidade. Envie o GPX do Strava.' };
    for (const i of picos(sv, Math.max(L, 20), 40, limiar(sv))) {
      const t = i * PASSO, [a, b] = corta(t - L / 2, t + L / 2);
      lances.push({ pico: t, a, b, valor: sv[i], rotulo: 'estimativa' });
    }
    return { lances, nota: 'Sem o GPX, a velocidade é estimada pelo ruído de vento e pelo movimento da imagem — é aproximada. Com o GPX do Strava fica exata.' };
  }

  // ---------------- interface ----------------
  let analise = null, assinatura = '', trilha = null, resultado = null, marcados = new Set(), ocupado = false, cancelado = false;
  const urls = [];
  const assinar = (lista) => lista.map((i) => i.file.name + ':' + i.file.size).join('|');
  const cfgAtual = () => ({ tipo: $('rs-tipo').value, lance: +$('rs-lance').value, total: +$('rs-total').value, trilha, ajuste: lerAjuste() });
  function lerAjuste() {
    const v = $('rs-ajuste').value.trim().replace(',', '.');
    if (!v) return 0;
    const neg = /^[-−]/.test(v), p = v.replace(/^[-+−]/, '').split(':').map(Number);
    if (p.some((x) => Number.isNaN(x))) return 0;
    const s = p.reduce((t, x) => t * 60 + x, 0);
    return neg ? -s : s;
  }

  function listaMudou(lista) {
    $('card-resumo').classList.toggle('hidden', !lista.length);
    if (assinar(lista) !== assinatura) { analise = null; resultado = null; }
    atualizar();
  }
  function receberAnalise(an, lista) {
    analise = an; assinatura = assinar(lista);
    recalcular(true);
  }

  function atualizar() {
    const bike = $('rs-tipo').value === 'bike';
    $('rs-bike').classList.toggle('hidden', !bike);
    $('rs-vel-wrap').classList.toggle('hidden', !bike || !trilha);
    $('rs-status').textContent = ocupado ? '' : analise ? `Análise pronta (${fmtDur(analise.dur)} de vídeo).` : 'Os vídeos ainda não foram analisados. A análise também é feita automaticamente durante "Juntar e converter".';
    $('rs-analisar').textContent = analise ? 'Analisar de novo' : 'Analisar vídeos';
    $('rs-analisar').disabled = ocupado || J()?.ocupado() || !J()?.lista().length;
    const seg = segmentos();
    $('rs-gerar').disabled = ocupado || J()?.ocupado() || !seg.length;
    $('rs-soma').textContent = seg.length ? `${marcados.size} lance(s) · ${fmtDur(seg.reduce((t, s) => t + s.b - s.a, 0))} de resumo` : '';
    infoTrilha();
  }

  function infoTrilha() {
    const el = $('rs-trilha-info');
    if (!trilha) { el.textContent = 'No Strava: abra a atividade → menu ⋯ → "Exportar GPX".'; return; }
    let txt = `Pedal de ${new Date(trilha.inicio).toLocaleString('pt-BR')} · ${num(trilha.km)} km · ${fmtDur((trilha.fim - trilha.inicio) / 1000)} · máx. ${num(trilha.max, 0)} km/h.`;
    if (analise) {
      const ini = relogio(analise, 0) + lerAjuste() * 1000, fim = relogio(analise, analise.dur) + lerAjuste() * 1000;
      txt += ini < trilha.fim && fim > trilha.inicio ? ' O vídeo está dentro do horário do pedal.' : ' ⚠ Pelo relógio da câmera, o vídeo não está no horário do pedal: use "Alinhar automaticamente".';
    }
    el.textContent = txt;
  }

  function recalcular(preselecionar) {
    resultado = analise ? calcularLances(analise, cfgAtual()) : null;
    if (preselecionar && resultado?.lances) {
      marcados = new Set(); let soma = 0;
      const ord = [...resultado.lances.keys()].sort((a, b) => resultado.lances[b].valor - resultado.lances[a].valor);
      for (const i of ord) { if (soma >= cfgAtual().total) break; marcados.add(i); soma += resultado.lances[i].b - resultado.lances[i].a; }
    }
    desenharLances();
  }

  function miniatura(t) {
    const k = Math.floor(t / PASSO_MINI);
    for (let d = 0; d < 6; d++) for (const x of [k + d, k - d]) { const b = analise.miniaturas.get(x); if (b) { const u = URL.createObjectURL(b); urls.push(u); return u; } }
    return '';
  }

  function desenharLances() {
    while (urls.length) URL.revokeObjectURL(urls.pop());
    const el = $('rs-lista');
    if (!resultado) { el.innerHTML = ''; $('rs-nota').textContent = ''; atualizar(); return; }
    if (resultado.erro) { el.innerHTML = `<div class="aviso erro">${esc(resultado.erro)}</div>`; $('rs-nota').textContent = ''; atualizar(); return; }
    $('rs-nota').textContent = resultado.lances.length ? resultado.nota : 'Nenhum lance encontrado.';
    const ordem = [...resultado.lances.keys()].sort((a, b) => resultado.lances[a].pico - resultado.lances[b].pico);
    el.innerHTML = ordem.map((i) => {
      const l = resultado.lances[i], img = miniatura(l.pico);
      return `<label class="lance${marcados.has(i) ? ' on' : ''}"><input type="checkbox" data-i="${i}" ${marcados.has(i) ? 'checked' : ''}>
        ${img ? `<img src="${img}" alt="">` : '<span class="sem-img"></span>'}
        <span class="quando">${fmtDur(l.pico)}</span><b>${esc(l.rotulo)}</b></label>`;
    }).join('');
    atualizar();
  }

  /** Lances marcados, em ordem e sem sobreposição. */
  function segmentos() {
    if (!resultado?.lances) return [];
    const s = [...marcados].map((i) => resultado.lances[i]).filter(Boolean).map((l) => ({ a: l.a, b: l.b })).sort((x, y) => x.a - y.a);
    const out = [];
    for (const x of s) { const u = out[out.length - 1]; if (u && x.a <= u.b + 0.5) u.b = Math.max(u.b, x.b); else out.push({ ...x }); }
    return out;
  }

  const progresso = (frac, txt) => { $('rs-barra').classList.toggle('hidden', frac == null); if (frac != null) $('rs-barra').value = frac; $('rs-prog').textContent = txt || ''; };

  // passada só de análise: lê som e alguns quadros por segundo (não converte nada)
  async function analisar() {
    const lista = J().lista(); if (!lista.length || !J().pronto()) return;
    ocupado = true; cancelado = false; $('rs-cancelar').classList.remove('hidden'); atualizar();
    const col = criarColetor(), fps = lista[0].info.fps, total = lista.reduce((t, i) => t + i.info.quadros, 0);
    let gq = 0;
    try {
      for (const [k, it] of lista.entries()) {
        const info = it.info, t0 = gq / fps; let as = 0, ultimo = null;
        col.inicioArquivo(it.file, info, t0);
        for await (const x of Avi.pedacos(it.file, info)) {
          if (cancelado) throw new Error('cancelado');
          if (x.tipo === 'v') {
            const t = gq / fps; gq++;
            if (x.dados) ultimo = x.dados;
            if (ultimo && col.querQuadro(t)) {
              const img = await new ImageDecoder({ data: ultimo, type: 'image/jpeg' }).decode().then((r) => r.image).catch(() => null);
              if (img) { await col.quadro(img, t); img.close(); }
            }
            if (gq % 60 === 0) progresso(gq / total, `Analisando ${it.file.name} (${k + 1} de ${lista.length}) · ${Math.floor(gq / total * 100)}%`);
          } else if (info.audio) {
            const f = J().pcmParaFloat(x.dados, info.audio.bits, info.audio.canais, 1);
            col.audio(f, info.audio.taxa, t0 + as / info.audio.taxa); as += f.length;
          }
        }
      }
      receberAnalise(col.fim(gq / fps), lista);
      J().toast('Análise pronta.');
    } catch (e) {
      if (e.message === 'cancelado') J().toast('Análise cancelada.'); else { console.error(e); J().toast('Erro na análise: ' + (e.message || e), true); }
    } finally { ocupado = false; $('rs-cancelar').classList.add('hidden'); progresso(null); atualizar(); }
  }

  // monta o MP4 do resumo: codifica só os quadros dos lances marcados, direto dos AVIs originais
  async function gerar() {
    const lista = J().lista(), segs = segmentos();
    if (!lista.length || !segs.length || !analise) return;
    const ref = lista[0].info, fps = ref.fps, durQ = 1e6 / fps, gop = Math.max(1, Math.round(fps / 2));
    const sd = J().saida(ref), cfg = cfgAtual();
    const comVel = cfg.tipo === 'bike' && trilha && $('rs-vel').checked;
    let codecs;
    try { codecs = await J().escolherCodecs(ref, sd.bitrate, sd.w, sd.h); } catch (e) { return J().toast('Não dá para gerar neste navegador: ' + e.message, true); }
    const nome = (J().nomeBase().replace(/(_juntado)?\.mp4$/i, '') || 'video') + '_resumo.mp4';
    const totalQ = segs.reduce((t, s) => t + Math.ceil((s.b - s.a) * fps) + 1, 0);

    let alvo, gravavel = null;
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: nome, types: [{ description: 'Vídeo MP4', accept: { 'video/mp4': ['.mp4'] } }] });
        gravavel = await h.createWritable(); alvo = new Mp4Muxer.FileSystemWritableFileStreamTarget(gravavel);
      } catch (e) { if (e.name !== 'AbortError') J().toast('Não foi possível criar o arquivo: ' + (e.message || e), true); return; }
    } else alvo = new Mp4Muxer.ArrayBufferTarget();
    const a = codecs.audio, canais = a?.cfg.numberOfChannels || 1, taxaSaida = a?.cfg.sampleRate || 0;
    const muxer = new Mp4Muxer.Muxer({
      target: alvo, firstTimestampBehavior: 'offset',
      fastStart: gravavel ? { expectedVideoChunks: totalQ + 16, expectedAudioChunks: a ? Math.ceil(totalQ / fps * taxaSaida / 960 * 1.1) + 64 : 0 } : 'in-memory',
      video: { codec: 'avc', width: sd.w, height: sd.h, frameRate: fps },
      audio: a ? { codec: a.mux, numberOfChannels: canais, sampleRate: taxaSaida } : undefined,
    });
    let erroCodec = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { erroCodec = e; } });
    venc.configure({ ...codecs.video, hardwareAcceleration: 'no-preference' });
    const aenc = a ? new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { erroCodec = e; } }) : null;
    aenc?.configure(a.cfg);

    const tela = sd.escala || comVel ? new OffscreenCanvas(sd.w, sd.h) : null, ctx = tela?.getContext('2d', { alpha: false });
    if (ctx) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    const esperar = async (enc, max) => { while (enc.encodeQueueSize > max) await new Promise((r) => setTimeout(r, 4)); };

    // por lance: quadros gravados, primeiro quadro de saída e o áudio (na taxa original), juntado no fim do lance
    const est = segs.map(() => ({ q: 0, ini: -1, audio: [], fechado: false }));
    let out = 0, amostras = 0, taxaEntrada = ref.audio?.taxa || 0;
    const escreverAudio = (f32) => {
      if (!f32.length) return;
      const ad = new AudioData({ format: 'f32', sampleRate: taxaSaida, numberOfFrames: f32.length / canais, numberOfChannels: canais, timestamp: Math.round(amostras / taxaSaida * 1e6), data: f32 });
      aenc.encode(ad); ad.close(); amostras += f32.length / canais;
    };
    const fechar = async (s) => {
      const e = est[s]; if (e.fechado || e.ini < 0) { e.fechado = true; return; }
      e.fechado = true;
      if (!a) return;
      const n = Math.round(e.q / fps * taxaEntrada), buf = new Float32Array(n * canais);
      for (const p of e.audio) { const ini = p.pos * canais; if (ini >= buf.length) continue; buf.set(p.dados.subarray(0, Math.max(0, buf.length - ini)), Math.max(0, ini)); }
      const alvoAm = Math.round(e.ini * durQ / 1e6 * taxaSaida);        // alinha o áudio do lance ao primeiro quadro dele
      if (alvoAm > amostras) escreverAudio(new Float32Array((alvoAm - amostras) * canais));
      let f = J().criarReamostrador(taxaEntrada, taxaSaida, canais)(buf);
      if (alvoAm < amostras) f = f.subarray(Math.min(f.length, (amostras - alvoAm) * canais));
      await esperar(aenc, 20); escreverAudio(f);
    };
    const segEm = (t) => { for (let i = 0; i < segs.length; i++) if (t >= segs[i].a && t < segs[i].b) return i; return -1; };

    ocupado = true; cancelado = false; $('rs-cancelar').classList.remove('hidden'); $('rs-fim').innerHTML = ''; atualizar();
    let trava = null; try { trava = await navigator.wakeLock?.request('screen'); } catch { /* sem trava */ }
    const t0 = performance.now();
    try {
      for (const [k, it] of lista.entries()) {
        const info = it.info, arq = analise.arquivos[k], ta0 = arq.t0;
        if (!segs.some((s) => s.b > ta0 && s.a < ta0 + arq.dur + 1)) continue;          // arquivo sem lance: nem lê
        let gq = Math.round(ta0 * fps), as = 0, ultimo = null;
        progresso(out / totalQ, `Lendo ${it.file.name}…`);
        for await (const x of Avi.pedacos(it.file, info)) {
          if (cancelado) throw new Error('cancelado');
          if (erroCodec) throw erroCodec;
          if (x.tipo === 'v') {
            const t = gq / fps; gq++;
            if (x.dados) ultimo = x.dados;
            for (let s = 0; s < segs.length; s++) if (!est[s].fechado && t > segs[s].b + 1) await fechar(s);
            const s = segEm(t);
            if (s < 0 || !ultimo) continue;
            const img = await new ImageDecoder({ data: ultimo, type: 'image/jpeg' }).decode().then((r) => r.image).catch(() => null);
            if (!img) continue;
            const e = est[s]; if (e.ini < 0) e.ini = out;
            let vf;
            const ts = Math.round(out * durQ), opts = { timestamp: ts, duration: Math.round(durQ) };
            if (ctx) {
              ctx.drawImage(img, 0, 0, sd.w, sd.h);
              if (comVel) desenharVelocidade(ctx, sd.w, sd.h, velEm(trilha, relogio(analise, t) + cfg.ajuste * 1000));
              vf = new VideoFrame(tela, opts);
            } else vf = new VideoFrame(img, opts);
            img.close();
            await esperar(venc, 6);
            venc.encode(vf, { keyFrame: e.q === 0 || out % gop === 0 }); vf.close();
            e.q++; out++;
            if (out % 15 === 0) progresso(out / totalQ, `Gerando o resumo · ${fmtDur(out / fps)} de ${fmtDur(totalQ / fps)}`);
          } else if (a && info.audio) {
            const f = J().pcmParaFloat(x.dados, info.audio.bits, info.audio.canais, canais), n = f.length / canais;
            const ta = ta0 + as / info.audio.taxa, tb = ta + n / info.audio.taxa; as += n;
            for (let s = 0; s < segs.length; s++) {
              const g = segs[s]; if (est[s].fechado || g.b <= ta || g.a >= tb) continue;
              const i0 = Math.max(0, Math.ceil((g.a - ta) * info.audio.taxa)), i1 = Math.min(n, Math.floor((g.b - ta) * info.audio.taxa));
              if (i1 > i0) est[s].audio.push({ pos: Math.round((ta - g.a) * info.audio.taxa) + i0, dados: f.slice(i0 * canais, i1 * canais) });
            }
          }
        }
      }
      for (let s = 0; s < segs.length; s++) await fechar(s);
      progresso(1, 'Finalizando o arquivo…');
      await venc.flush(); if (aenc) await aenc.flush();
      if (erroCodec) throw erroCodec;
      if (!out) throw new Error('nenhum quadro dos lances foi encontrado nos vídeos');
      muxer.finalize();
      if (gravavel) await gravavel.close();
      let link = '';
      if (!gravavel) { const u = URL.createObjectURL(new Blob([alvo.buffer], { type: 'video/mp4' })); link = `<a class="btn" id="rs-baixar" href="${u}" download="${esc(nome)}">Baixar o resumo</a>`; }
      $('rs-fim').innerHTML = `<div class="aviso ok">✅ Resumo pronto: <b>${esc(nome)}</b> · ${fmtDur(out / fps)} · ${segs.length} lance(s) · gerado em ${fmtDur((performance.now() - t0) / 1000)}.
        ${gravavel ? 'Já está salvo na pasta escolhida.' : ''}</div>${link}`;
      J().toast('Resumo pronto!');
    } catch (e) {
      try { venc.close(); aenc?.close(); } catch { /* já fechado */ }
      if (gravavel) { try { await gravavel.abort(); } catch { /* nada */ } }
      if (e.message === 'cancelado') J().toast('Resumo cancelado.'); else { console.error(e); J().toast('Erro ao gerar o resumo: ' + (e.message || e), true); }
    } finally {
      try { await trava?.release(); } catch { /* nada */ }
      ocupado = false; $('rs-cancelar').classList.add('hidden'); progresso(null); atualizar(); J().render();
    }
  }

  function desenharVelocidade(ctx, w, h, v) {
    if (Number.isNaN(v)) return;
    const tam = Math.round(h * 0.06), txt = `${Math.round(v)} km/h`;
    ctx.font = `700 ${tam}px system-ui, sans-serif`;
    const larg = ctx.measureText(txt).width, pad = tam * 0.35, x = Math.round(w * 0.03), y = Math.round(h * 0.94);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.roundRect(x - pad, y - tam - pad * 0.6, larg + pad * 2, tam + pad * 1.6, pad); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y);
  }

  // ---------------- eventos ----------------
  function iniciar() {
    if (!$('card-resumo')) return;
    for (const id of ['rs-tipo', 'rs-lance']) $(id).addEventListener('change', () => recalcular(true));
    $('rs-total').addEventListener('change', () => recalcular(true));
    $('rs-ajuste').addEventListener('change', () => recalcular(true));
    $('rs-lista').addEventListener('change', (ev) => {
      const c = ev.target.closest('input[data-i]'); if (!c) return;
      const i = +c.dataset.i; if (c.checked) marcados.add(i); else marcados.delete(i);
      c.closest('.lance').classList.toggle('on', c.checked); atualizar();
    });
    $('rs-gpx').addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try { trilha = lerTrilha(await f.text()); J().toast('Trilha do Strava carregada.'); }
      catch (e) { trilha = null; J().toast('Não foi possível ler a trilha: ' + e.message, true); }
      ev.target.value = '';
      if (trilha && analise) {                     // fora do horário do pedal? já tenta alinhar
        const ini = relogio(analise, 0) + lerAjuste() * 1000, fim = relogio(analise, analise.dur) + lerAjuste() * 1000;
        if (!(ini < trilha.fim && fim > trilha.inicio)) alinharAgora();
      }
      recalcular(true);
    });
    $('rs-alinhar').addEventListener('click', alinharAgora);
    $('rs-analisar').addEventListener('click', () => analisar());
    $('rs-gerar').addEventListener('click', () => gerar());
    $('rs-cancelar').addEventListener('click', () => { if (confirm('Cancelar?')) cancelado = true; });
    atualizar();
  }
  function alinharAgora() {
    if (!trilha) return J().toast('Carregue antes o GPX do Strava.', true);
    if (!analise) return J().toast('Analise os vídeos antes de alinhar.', true);
    const m = alinhar(analise, trilha);
    if (!m) return J().toast('Não foi possível alinhar: os vídeos não têm som nem análise de imagem.', true);
    $('rs-ajuste').value = (m.o < 0 ? '-' : '') + fmtDur(Math.abs(m.o)).replace('−', '');
    $('rs-alinhar-info').textContent = `Melhor ajuste: ${m.o >= 0 ? '+' : ''}${fmtDur(m.o)} (semelhança ${num(m.r, 2)}${m.r < 0.3 ? ' — baixa, confira os lances' : ''}).`;
    recalcular(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.Resumo = { criarColetor, receberAnalise, listaMudou, ocupado: () => ocupado, _teste: { lerTrilha, calcularLances, alinhar, media, mediana, velEm, relogio } };
})();
