// Leitor de AVI (RIFF), em partes: lê só o necessário do arquivo, sem carregar tudo na memória.
// Suporta AVI comum e OpenDML (arquivos > 1 GB com segmentos "AVIX"), com quadros MJPEG e áudio PCM.
(function () {
  'use strict';

  const JANELA = 16 * 1024 * 1024;   // lê o arquivo em blocos de 16 MB
  class Leitor {
    constructor(file) { this.file = file; this.ini = 0; this.buf = new Uint8Array(0); }
    async ler(pos, n) {
      if (pos < this.ini || pos + n > this.ini + this.buf.length) {
        const tam = Math.max(n, JANELA);
        this.buf = new Uint8Array(await this.file.slice(pos, Math.min(this.file.size, pos + tam)).arrayBuffer());
        this.ini = pos;
        if (this.buf.length < n) throw new Error('arquivo terminou antes do esperado');
      }
      return this.buf.subarray(pos - this.ini, pos - this.ini + n);
    }
  }
  const fourcc = (b, o = 0) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);

  /** Lê o cabeçalho: dimensões, taxa de quadros, áudio e onde estão os dados (listas "movi"). */
  async function cabecalho(file) {
    const r = new Leitor(file);
    const h = await r.ler(0, 12);
    if (fourcc(h) !== 'RIFF' || fourcc(h, 8) !== 'AVI ') throw new Error('não é um arquivo AVI');
    const info = { nome: file.name, tamanho: file.size, streams: [], movi: [], quadros: 0, totalDml: 0 };
    async function percorrer(ini, fim, nivel) {
      let p = ini;
      while (p + 8 <= fim) {
        const c = await r.ler(p, 8), id = fourcc(c), tam = u32(c, 4);
        if (id === 'RIFF' || id === 'LIST') {
          const tipo = fourcc(await r.ler(p + 8, 4));
          if (tipo === 'movi') info.movi.push({ ini: p + 12, fim: Math.min(p + 8 + tam, file.size) });
          else if (nivel < 4) await percorrer(p + 12, Math.min(p + 8 + tam, file.size), nivel + 1);
          if (tipo === 'strl') info.streams.push(info._atual);
        } else if (id === 'avih') {
          const d = await r.ler(p + 8, 40);
          info.usPorQuadro = u32(d, 0); info.quadros = u32(d, 16); info.largura = u32(d, 32); info.altura = u32(d, 36);
        } else if (id === 'strh') {
          const d = await r.ler(p + 8, 36);
          info._atual = { tipo: fourcc(d, 0), handler: fourcc(d, 4), escala: u32(d, 20), taxa: u32(d, 24), duracao: u32(d, 32) };
        } else if (id === 'strf' && info._atual) {
          const d = await r.ler(p + 8, Math.min(tam, 40));
          if (info._atual.tipo === 'vids') Object.assign(info._atual, { largura: u32(d, 4), altura: Math.abs(u32(d, 8) | 0), compressao: fourcc(d, 16) });
          else if (info._atual.tipo === 'auds') Object.assign(info._atual, { formato: u16(d, 0), canais: u16(d, 2), amostras: u32(d, 4), bits: u16(d, 14), bloco: u16(d, 12) });
        } else if (id === 'idx1') {
          info.idx1 = { ini: p + 8, n: Math.floor(tam / 16) };
        } else if (id === 'dmlh') {
          info.totalDml = u32(await r.ler(p + 8, 4), 0);
        }
        p += 8 + tam + (tam & 1);
        if (nivel === 0 && id === 'RIFF' && p >= file.size) break;
      }
    }
    await percorrer(0, file.size, 0);
    delete info._atual;
    const iv = info.streams.findIndex((s) => s.tipo === 'vids'), ia = info.streams.findIndex((s) => s.tipo === 'auds');
    if (iv < 0) throw new Error('o arquivo não tem vídeo');
    const v = info.streams[iv], a = ia >= 0 ? info.streams[ia] : null;
    info.idVideo = String(iv).padStart(2, '0'); info.idAudio = a ? String(ia).padStart(2, '0') : null;
    info.codec = (v.compressao || v.handler || '').trim().toUpperCase();
    info.largura = v.largura || info.largura; info.altura = v.altura || info.altura;
    info.fps = v.escala ? v.taxa / v.escala : 1e6 / info.usPorQuadro;
    info.quadros = info.totalDml || v.duracao || info.quadros;
    if (info.idx1 && info.movi.length === 1) {                         // conta os quadros pelo índice (inclui os repetidos)
      let n = 0; const r2 = new Leitor(file);
      for (let k = 0; k < info.idx1.n; k++) { const e = await r2.ler(info.idx1.ini + k * 16, 4); const id = fourcc(e, 0);
        if (id.slice(0, 2) === info.idVideo && /d[cb]/.test(id.slice(2))) n++; }
      if (n) info.quadros = n;
    }
    info.duracao = info.quadros / info.fps;
    info.audio = a ? { formato: a.formato, canais: a.canais, taxa: a.amostras, bits: a.bits } : null;
    if (!info.movi.length) throw new Error('o arquivo não tem dados de vídeo (lista movi)');
    return info;
  }

  /**
   * Percorre os dados na ordem de reprodução: { tipo: 'v' | 'a', dados: Uint8Array | null }.
   * dados null = repetir o quadro anterior. Muitas câmeras gravam menos quadros do que a taxa nominal e repetem
   * entradas no índice (idx1) para manter os 30 fps — por isso, havendo índice, ele é seguido (como fazem os players).
   */
  async function* pedacos(file, info) {
    if (info.idx1 && info.movi.length === 1) { yield* pelosIndices(file, info); return; }
    yield* emSequencia(file, info);
  }
  async function* pelosIndices(file, info) {
    const r = new Leitor(file), ri = new Leitor(file);
    const moviBase = info.movi[0].ini - 4;                            // offsets do idx1 contam a partir de "movi"…
    let base = moviBase;
    const primeiro = await ri.ler(info.idx1.ini, 16);
    const off0 = u32(primeiro, 8);
    if (off0 && fourcc(await r.ler(moviBase + off0, 4)) !== fourcc(primeiro, 0)) base = 0;   // …ou do início do arquivo
    let ultimoV = -1;
    for (let k = 0; k < info.idx1.n; k++) {
      const e = await ri.ler(info.idx1.ini + k * 16, 16), id = fourcc(e, 0), off = u32(e, 8), tam = u32(e, 12);
      const s = id.slice(0, 2), t = id.slice(2);
      if (s === info.idVideo && (t === 'dc' || t === 'db')) {
        if (!tam || off === ultimoV) { yield { tipo: 'v', dados: null }; continue; }
        ultimoV = off;
        yield { tipo: 'v', dados: (await r.ler(base + off + 8, tam)).slice() };
      } else if (info.idAudio && s === info.idAudio && t === 'wb' && tam) {
        yield { tipo: 'a', dados: (await r.ler(base + off + 8, tam)).slice() };
      }
    }
  }
  async function* emSequencia(file, info) {
    const r = new Leitor(file);
    for (const m of info.movi) {
      let p = m.ini;
      while (p + 8 <= m.fim) {
        const c = await r.ler(p, 8), id = fourcc(c), tam = u32(c, 4);
        if (id === 'LIST') { p += 12; continue; }                    // "rec " agrupando pedaços: entra na lista
        const s = id.slice(0, 2), t = id.slice(2);
        if (s === info.idVideo && (t === 'dc' || t === 'db')) {
          yield { tipo: 'v', dados: tam ? (await r.ler(p + 8, tam)).slice() : null };
        } else if (info.idAudio && s === info.idAudio && t === 'wb' && tam) {
          yield { tipo: 'a', dados: (await r.ler(p + 8, tam)).slice() };
        }
        if (!tam && id === '\0\0\0\0') break;                          // fim truncado (gravação interrompida)
        p += 8 + tam + (tam & 1);
      }
    }
  }

  /** Primeiro quadro (JPEG) para a miniatura. */
  async function primeiroQuadro(file, info) {
    for await (const x of pedacos(file, info)) if (x.tipo === 'v' && x.dados) return x.dados;
    return null;
  }

  window.Avi = { cabecalho, pedacos, primeiroQuadro };
})();
