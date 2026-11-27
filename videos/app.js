// Juntar vídeos — junta vários .avi (MJPEG + PCM) de câmera de ação num único MP4 (H.264 + AAC/Opus).
// Tudo no navegador: WebCodecs (ImageDecoder → VideoEncoder / AudioEncoder) e mp4-muxer gravando direto no disco.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTam = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2).replace('.', ',') + ' GB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB');
  const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  let toastT;
  const toast = (m, erro) => { const t = $('toast'); t.textContent = m; t.style.display = 'block'; t.style.background = erro ? 'var(--danger)' : 'var(--text)';
    clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), erro ? 7000 : 3000); };

  // ---------------- suporte do navegador ----------------
  const temSuporte = typeof VideoEncoder === 'function' && typeof ImageDecoder === 'function' && typeof AudioEncoder === 'function';
  if (!temSuporte) {
    $('sem-suporte').classList.remove('hidden');
    $('sem-suporte').innerHTML = 'Este navegador não tem os recursos de vídeo necessários (WebCodecs). Use o <b>Google Chrome</b> ou o <b>Microsoft Edge</b> atualizados, no computador.';
  }

  // ---------------- lista de arquivos ----------------
  let itens = [];   // { file, info, thumb, erro }
  const ordenarNome = () => itens.sort((a, b) => a.file.name.localeCompare(b.file.name, 'pt-BR', { numeric: true }));
  async function adicionar(files) {
    const avis = [...files].filter((f) => /\.avi$/i.test(f.name) || f.type.includes('avi') || f.type.includes('msvideo'));
    if (avis.length < files.length) toast('Só arquivos .avi entram na lista.', true);
    for (const file of avis) {
      if (itens.some((i) => i.file.name === file.name && i.file.size === file.size)) continue;
      const it = { file, info: null, thumb: null, erro: null };
      itens.push(it);
      try {
        it.info = await Avi.cabecalho(file);
        const jpg = await Avi.primeiroQuadro(file, it.info);
        if (jpg) it.thumb = URL.createObjectURL(new Blob([jpg], { type: 'image/jpeg' }));
      } catch (e) { it.erro = e.message; }
    }
    ordenarNome(); render();
  }
  function conferir() {
    const ok = itens.filter((i) => i.info && !i.erro), msgs = [];
    if (itens.some((i) => i.erro)) msgs.push(['erro', 'Há arquivo que não pôde ser lido (em vermelho). Tire da lista para continuar.']);
    const ref = ok[0]?.info;
    if (ref) {
      if (!['MJPG', 'MJPEG', 'AVRN', 'JPEG', 'DMB1'].includes(ref.codec)) msgs.push(['erro', `O vídeo está em ${esc(ref.codec || 'formato desconhecido')}; esta ferramenta converte vídeos MJPEG (o formato das câmeras de ação comuns).`]);
      const dif = ok.filter((i) => i.info.largura !== ref.largura || i.info.altura !== ref.altura || Math.abs(i.info.fps - ref.fps) > 0.01);
      if (dif.length) msgs.push(['erro', `Estes vídeos têm resolução ou taxa de quadros diferente do primeiro (${ref.largura}×${ref.altura}, ${+ref.fps.toFixed(2)} fps): ${dif.map((i) => esc(i.file.name)).join(', ')}.`]);
      const difA = ok.filter((i) => JSON.stringify(i.info.audio) !== JSON.stringify(ref.audio));
      if (difA.length) msgs.push(['erro', `Estes vídeos têm áudio diferente do primeiro: ${difA.map((i) => esc(i.file.name)).join(', ')}.`]);
      if (ref.audio && ref.audio.formato !== 1) msgs.push(['erro', 'O áudio não é PCM (formato não suportado por esta ferramenta).']);
    }
    if (!msgs.length && ok.length) msgs.push(['ok', `${ok.length} vídeo(s) compatível(is): ${ref.largura}×${ref.altura}, ${+ref.fps.toFixed(2)} fps${ref.audio ? `, áudio ${ref.audio.canais === 1 ? 'mono' : 'estéreo'} ${ref.audio.taxa / 1000} kHz` : ', sem áudio'}.`]);
    $('checagem').innerHTML = msgs.map(([t, m]) => `<div class="aviso ${t}">${m}</div>`).join('');
    return !msgs.some((m) => m[0] === 'erro') && ok.length > 0;
  }
  function render() {
    $('card-lista').classList.toggle('hidden', !itens.length);
    $('card-converter').classList.toggle('hidden', !itens.length);
    $('lista').innerHTML = itens.map((it, i) => `<tr draggable="true" data-i="${i}" class="${it.erro ? 'erro-linha' : ''}">
      <td>${it.thumb ? `<img class="thumb" src="${it.thumb}" alt="">` : ''}</td>
      <td class="num">${i + 1}</td>
      <td>${esc(it.file.name)}${it.erro ? `<div class="small">Erro: ${esc(it.erro)}</div>` : ''}</td>
      <td class="num">${it.info ? fmtDur(it.info.duracao) : ''}</td>
      <td class="small">${it.info ? `${it.info.largura}×${it.info.altura} · ${+it.info.fps.toFixed(2)} fps · ${esc(it.info.codec)}` : ''}</td>
      <td class="small">${it.info?.audio ? `${it.info.audio.canais === 1 ? 'mono' : it.info.audio.canais + ' canais'} · ${it.info.audio.taxa / 1000} kHz` : it.info ? 'sem áudio' : ''}</td>
      <td class="num">${fmtTam(it.file.size)}</td>
      <td class="acts"><button data-a="sobe" ${i ? '' : 'disabled'}>↑</button> <button data-a="desce" ${i < itens.length - 1 ? '' : 'disabled'}>↓</button> <button data-a="tira" class="danger">×</button></td></tr>`).join('');
    const dur = itens.reduce((t, i) => t + (i.info?.duracao || 0), 0), tam = itens.reduce((t, i) => t + i.file.size, 0);
    $('tot-dur').textContent = fmtDur(dur); $('tot-tam').textContent = fmtTam(tam);
    if (!$('nome-saida').value && itens[0]) $('nome-saida').value = itens[0].file.name.replace(/\.avi$/i, '') + (itens.length > 1 ? '_juntado' : '') + '.mp4';
    const ok = conferir();
    $('converter').disabled = !ok || !temSuporte || rodando || !!window.Resumo?.ocupado();
    window.Resumo?.listaMudou(ok && temSuporte ? itens.filter((i) => i.info && !i.erro) : []);
    const ref = itens.find((i) => i.info)?.info, sd = ref ? saida(ref) : null;
    $('estimativa').textContent = dur && sd ? `Duração total ${fmtDur(dur)}. Saída ${sd.w}×${sd.h}; o MP4 deve ficar com cerca de ${fmtTam(dur * (sd.bitrate + 192e3) / 8)}. ` +
      (sd.h > 1440 ? 'Em 4K a conversão é bem mais lenta (pode levar algumas vezes a duração do vídeo).' : 'A conversão costuma levar de metade a uma vez a duração do vídeo, conforme o computador.') : '';
  }
  $('qualidade').addEventListener('change', render);
  $('lista').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b || rodando) return;
    const i = +b.closest('tr').dataset.i;
    if (b.dataset.a === 'tira') itens.splice(i, 1);
    else { const j = b.dataset.a === 'sobe' ? i - 1 : i + 1; [itens[i], itens[j]] = [itens[j], itens[i]]; }
    render();
  });
  // arrastar para reordenar
  let arrastado = null;
  $('lista').addEventListener('dragstart', (ev) => { const tr = ev.target.closest('tr'); arrastado = +tr.dataset.i; tr.classList.add('arrastando'); });
  $('lista').addEventListener('dragend', () => { arrastado = null; render(); });
  $('lista').addEventListener('dragover', (ev) => {
    if (arrastado == null) return; ev.preventDefault();
    const tr = ev.target.closest('tr'); if (!tr) return;
    const alvo = +tr.dataset.i; if (alvo === arrastado) return;
    const [x] = itens.splice(arrastado, 1); itens.splice(alvo, 0, x); arrastado = alvo; render();
    $('lista').querySelector(`tr[data-i="${alvo}"]`)?.classList.add('arrastando');
  });
  $('ordenar-nome').addEventListener('click', () => { ordenarNome(); render(); });
  $('limpar').addEventListener('click', () => { if (!rodando) { itens = []; $('nome-saida').value = ''; render(); } });
  $('arquivos').addEventListener('change', (ev) => { adicionar(ev.target.files); ev.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('dragover', (ev) => { if (ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); drop.classList.add('over'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); adicionar(ev.dataTransfer.files); });

  // ---------------- conversão ----------------
  let rodando = false, cancelado = false;
  /** Resolução e bitrate de saída. Aumentar para 1440p/4K faz o YouTube usar uma compressão bem melhor. */
  function saida(info) {
    const [alt, mbps] = $('qualidade').value.split(':').map(Number);
    const h = Math.max(info.altura, alt);                               // nunca reduz a resolução original
    const w = Math.round(info.largura * h / info.altura / 2) * 2;
    return { w, h, bitrate: mbps * 1e6, escala: h !== info.altura };
  }
  async function escolherCodecs(info, bitrate, w, h) {
    const { fps } = info;
    const nivel = w * h > 2228224 ? '33' : w * h > 921600 ? '28' : '1f';      // 4K → 5.1, 1080p → 4.0, 720p → 3.1
    let video = null;
    for (const perfil of ['6400', '4d00', '4200']) {
      const cfg = { codec: `avc1.${perfil}${nivel}`, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) { video = cfg; break; }
    }
    if (!video) throw new Error('o navegador não consegue gerar vídeo H.264 nesta resolução');
    let audio = null;
    if (info.audio) {
      // YouTube recomenda AAC-LC, 48 kHz, estéreo (o mono da câmera é copiado para os dois canais)
      for (const [codec, sr, canais, mux] of [['mp4a.40.2', 48000, 2, 'aac'], ['mp4a.40.2', 44100, 2, 'aac'], ['mp4a.40.2', 48000, 1, 'aac'], ['opus', 48000, 2, 'opus'], ['opus', 48000, 1, 'opus']]) {
        const cfg = { codec, sampleRate: sr, numberOfChannels: canais, bitrate: canais === 1 ? 128000 : 192000 };
        if ((await AudioEncoder.isConfigSupported(cfg)).supported) { audio = { cfg, mux }; break; }
      }
      if (!audio) throw new Error('o navegador não consegue codificar o áudio');
    }
    return { video, audio };
  }

  // reamostragem linear contínua entre pedaços (ex.: 16 kHz → 48 kHz), por canal
  function criarReamostrador(de, para, canais) {
    const passo = de / para; let pos = 0, ultimo = new Float32Array(canais);
    return (entrada /* Float32 intercalado */) => {
      const n = entrada.length / canais; if (de === para) return entrada;
      const saida = []; const amostra = (i, c) => (i < 0 ? ultimo[c] : entrada[i * canais + c]);
      while (pos < n - 1 + 1e-9) {
        const i = Math.floor(pos), f = pos - i;
        for (let c = 0; c < canais; c++) saida.push(amostra(i - 0, c) * (1 - f) + amostra(Math.min(i + 1, n - 1), c) * f);
        pos += passo;
      }
      for (let c = 0; c < canais; c++) ultimo[c] = entrada[(n - 1) * canais + c];
      pos -= n; return Float32Array.from(saida);
    };
  }
  function pcmParaFloat(bytes, bits, canaisEntrada, canaisSaida) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const passo = bits / 8, n = Math.floor(bytes.byteLength / passo / canaisEntrada);
    const out = new Float32Array(n * canaisSaida);
    for (let i = 0; i < n; i++) for (let c = 0; c < canaisSaida; c++) {
      const o = (i * canaisEntrada + Math.min(c, canaisEntrada - 1)) * passo;   // mono → estéreo: mesmo som nos dois canais
      out[i * canaisSaida + c] = bits === 16 ? dv.getInt16(o, true) / 32768 : (dv.getUint8(o) - 128) / 128;
    }
    return out;
  }

  async function converter() {
    if (!conferir()) return;
    const lista = itens.filter((i) => i.info && !i.erro), ref = lista[0].info;
    const nome = ($('nome-saida').value.trim() || 'video.mp4').replace(/(\.mp4)?$/i, '.mp4');
    const sd = saida(ref);
    let codecs;
    try { codecs = await escolherCodecs(ref, sd.bitrate, sd.w, sd.h); } catch (e) { return toast('Não dá para converter neste navegador: ' + e.message, true); }

    // destino: grava direto num arquivo escolhido (Chrome/Edge); sem isso, monta na memória e baixa no fim
    let alvo, gravavel = null;
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: nome, types: [{ description: 'Vídeo MP4', accept: { 'video/mp4': ['.mp4'] } }] });
        gravavel = await h.createWritable();
        alvo = new Mp4Muxer.FileSystemWritableFileStreamTarget(gravavel);
      } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível criar o arquivo: ' + (e.message || e), true); return; }
    } else {
      const total = lista.reduce((t, i) => t + i.info.duracao, 0) * sd.bitrate / 8;
      if (total > 1.5e9 && !confirm('Este navegador não grava direto no disco; o vídeo será montado na memória (pode faltar memória em vídeos longos). Continuar?')) return;
      alvo = new Mp4Muxer.ArrayBufferTarget();
    }
    // "moov" no início do arquivo (recomendação do YouTube): na memória ele é reposicionado no fim; gravando direto no
    // disco, o espaço do índice é reservado no começo — o número de quadros é conhecido; o de pacotes de áudio é estimado com folga
    const totalQ = lista.reduce((t, i) => t + i.info.quadros, 0);
    const reserva = { expectedVideoChunks: totalQ + 16,
      expectedAudioChunks: codecs.audio ? Math.ceil((totalQ / ref.fps + lista.length + 2) * codecs.audio.cfg.sampleRate / 960 * 1.1) + 64 : 0 };
    const muxer = new Mp4Muxer.Muxer({
      target: alvo, fastStart: gravavel ? reserva : 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: 'avc', width: sd.w, height: sd.h, frameRate: ref.fps },
      audio: codecs.audio ? { codec: codecs.audio.mux, numberOfChannels: codecs.audio.cfg.numberOfChannels, sampleRate: codecs.audio.cfg.sampleRate } : undefined,
    });
    let erroCodec = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { erroCodec = e; } });
    venc.configure({ ...codecs.video, hardwareAcceleration: 'no-preference' });
    let aenc = null;
    if (codecs.audio) { aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { erroCodec = e; } }); aenc.configure(codecs.audio.cfg); }

    // interface
    rodando = true; cancelado = false; render();
    $('progresso').classList.remove('hidden'); $('card-fim').classList.add('hidden');
    const totalQuadros = lista.reduce((t, i) => t + i.info.quadros, 0), totalSeg = totalQuadros / ref.fps;
    $('st-total').textContent = fmtDur(totalSeg);
    let trava = null; try { trava = await navigator.wakeLock?.request('screen'); } catch { /* sem trava de tela */ }
    const t0 = performance.now(); let feitos = 0;
    const durQuadro = 1e6 / ref.fps;
    const gop = Math.max(1, Math.round(ref.fps / 2));
    const telaEscala = sd.escala ? new OffscreenCanvas(sd.w, sd.h) : null;
    const ctxEscala = telaEscala?.getContext('2d', { alpha: false });
    if (ctxEscala) { ctxEscala.imageSmoothingEnabled = true; ctxEscala.imageSmoothingQuality = 'high'; }   // YouTube: GOP fechado de metade da taxa de quadros
    const atualizar = (arq) => {
      const seg = (performance.now() - t0) / 1000, pct = feitos / totalQuadros, vel = feitos / ref.fps / Math.max(seg, 0.001);
      $('barra').value = pct; $('st-pct').textContent = Math.floor(pct * 100) + '%'; $('st-tempo').textContent = fmtDur(feitos / ref.fps);
      $('st-vel').textContent = seg > 2 ? vel.toFixed(2).replace('.', ',') + '× o tempo real' : '—';
      $('st-eta').textContent = seg > 3 && pct > 0 ? fmtDur((totalQuadros - feitos) / ref.fps / vel) : '—';
      if (arq) $('st-arquivo').textContent = arq;
    };
    const esperarFila = async (enc, max) => { while (enc.encodeQueueSize > max) await new Promise((r) => setTimeout(r, 4)); };

    let ultimoQuadro = null;
    const col = window.Resumo?.criarColetor();   // análise para o resumo, na mesma passada
    const a = codecs.audio, canais = a?.cfg.numberOfChannels || 1, taxaSaida = a?.cfg.sampleRate || 0;
    let amostrasEscritas = 0;
    const escreverAudio = (f32) => {
      if (!f32.length) return;
      const n = f32.length / canais;
      const ad = new AudioData({ format: 'f32', sampleRate: taxaSaida, numberOfFrames: n, numberOfChannels: canais, timestamp: Math.round(amostrasEscritas / taxaSaida * 1e6), data: f32 });
      aenc.encode(ad); ad.close(); amostrasEscritas += n;
    };
    try {
      for (const [k, it] of lista.entries()) {
        const info = it.info, inicioVideo = feitos * durQuadro;
        atualizar(`Arquivo ${k + 1} de ${lista.length}: ${it.file.name}`);
        col?.inicioArquivo(it.file, info, inicioVideo / 1e6); let asArq = 0;
        // mantém áudio e vídeo alinhados no início de cada arquivo: completa com silêncio ou descarta sobra
        let descartar = 0;
        const reamostrar = a ? criarReamostrador(info.audio.taxa, taxaSaida, canais) : null;
        if (a) {
          const alvoAmostras = Math.round(inicioVideo / 1e6 * taxaSaida);
          if (alvoAmostras > amostrasEscritas) escreverAudio(new Float32Array((alvoAmostras - amostrasEscritas) * canais));
          else descartar = amostrasEscritas - alvoAmostras;
        }
        // decodificação dos JPEG em paralelo, mantendo a ordem
        const fila = [];
        const despachar = async () => {
          const p = fila.shift(); let quadro = await p;
          if (!quadro) { if (!ultimoQuadro) return; quadro = ultimoQuadro.clone(); }      // quadro vazio: repete o anterior
          else { ultimoQuadro?.close(); ultimoQuadro = quadro.clone(); }
          const tq = feitos / ref.fps;
          if (col?.querQuadro(tq)) await col.quadro(quadro, tq);
          const ts = Math.round(feitos * durQuadro);
          let vf;
          if (sd.escala) {                       // aumenta a resolução na placa de vídeo (suavização de alta qualidade)
            ctxEscala.drawImage(quadro, 0, 0, sd.w, sd.h);
            vf = new VideoFrame(telaEscala, { timestamp: ts, duration: Math.round(durQuadro) });
          } else vf = new VideoFrame(quadro, { timestamp: ts, duration: Math.round(durQuadro) });
          quadro.close();
          await esperarFila(venc, 6);
          venc.encode(vf, { keyFrame: feitos % gop === 0 }); vf.close();
          feitos++;
          if (feitos % 15 === 0) atualizar();
        };
        for await (const x of Avi.pedacos(it.file, info)) {
          if (cancelado) throw new Error('cancelado');
          if (erroCodec) throw erroCodec;
          if (x.tipo === 'v') {
            fila.push(x.dados ? new ImageDecoder({ data: x.dados, type: 'image/jpeg' }).decode().then((r) => r.image).catch(() => null) : Promise.resolve(null));
            if (fila.length >= 6) await despachar();
          } else if (a) {
            if (col) { const m = pcmParaFloat(x.dados, info.audio.bits, info.audio.canais, 1); col.audio(m, info.audio.taxa, inicioVideo / 1e6 + asArq / info.audio.taxa); asArq += m.length; }
            let f = reamostrar(pcmParaFloat(x.dados, info.audio.bits, info.audio.canais, canais));
            if (descartar) { const tira = Math.min(descartar, f.length / canais); f = f.subarray(tira * canais); descartar -= tira; }
            if (f.length) { await esperarFila(aenc, 20); escreverAudio(f); }
          }
        }
        while (fila.length) await despachar();
      }
      atualizar('Finalizando o arquivo…');
      await venc.flush(); if (aenc) await aenc.flush();
      if (erroCodec) throw erroCodec;
      muxer.finalize();
      if (gravavel) await gravavel.close();
      if (col) window.Resumo.receberAnalise(col.fim(feitos / ref.fps), lista);
      const seg = (performance.now() - t0) / 1000;
      $('card-fim').classList.remove('hidden');
      const tamFinal = gravavel ? null : alvo.buffer.byteLength;
      $('resumo-fim').innerHTML = [['Arquivo', esc(nome)], ['Duração', fmtDur(feitos / ref.fps)], ['Vídeos juntados', lista.length],
        ['Tamanho', tamFinal ? fmtTam(tamFinal) : 'gravado na pasta escolhida'], ['Tempo de conversão', fmtDur(seg)],
 ['Formato', `H.264 ${sd.w}×${sd.h} · ${a ? (a.mux === 'aac' ? 'AAC' : 'Opus') : 'sem áudio'}`]]
        .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      $('fim-txt').textContent = gravavel ? 'O MP4 já está salvo na pasta que você escolheu. É só enviar para o YouTube.' : 'Clique em "Baixar o MP4" e depois envie para o YouTube.';
      if (!gravavel) { const b = $('baixar'); b.href = URL.createObjectURL(new Blob([alvo.buffer], { type: 'video/mp4' })); b.download = nome; b.classList.remove('hidden'); }
      else $('baixar').classList.add('hidden');
      $('barra').value = 1; $('st-pct').textContent = '100%'; $('st-eta').textContent = '—';
      toast('Vídeo pronto!');
    } catch (e) {
      try { venc.close(); aenc?.close(); } catch { /* já fechado */ }
      if (gravavel) { try { await gravavel.abort(); } catch { /* nada */ } }
      if (e.message === 'cancelado') toast('Conversão cancelada.'); else { console.error(e); toast('Erro na conversão: ' + (e.message || e), true); }
    } finally {
      ultimoQuadro?.close(); ultimoQuadro = null;
      try { await trava?.release(); } catch { /* nada */ }
      rodando = false; $('progresso').classList.add('hidden');
      render();
    }
  }
  $('converter').addEventListener('click', () => converter().catch((e) => { console.error(e); rodando = false; render(); toast('Erro: ' + (e.message || e), true); }));
  $('cancelar').addEventListener('click', () => { if (confirm('Cancelar a conversão? O arquivo parcial será descartado.')) cancelado = true; });
  window.addEventListener('beforeunload', (ev) => { if (rodando) { ev.preventDefault(); ev.returnValue = ''; } });
  // usado pelo resumo (resumo.js) e pelos testes
  window.JuntarVideos = { criarReamostrador, pcmParaFloat, escolherCodecs, saida, render, toast, conferir,
    pronto: () => conferir(), lista: () => itens.filter((i) => i.info && !i.erro), ocupado: () => rodando, nomeBase: () => $('nome-saida').value.trim() };
})();
