// Compressão de PDF no navegador, para caber no limite de upload (50 MB no Supabase gratuito).
// Cada página é redesenhada como imagem JPEG (PDF.js lê, pdf-lib monta o novo PDF).
// Começa em boa qualidade e só reduz se for preciso. O PDF resultante não tem texto selecionável.
//
// Uso:  const r = await PdfCompress.comprimir(file, { limite: 50 * 1048576, progresso: (p) => ..., cancelado: () => false })
//       r.blob (PDF novo), r.nivel (qualidade usada), r.paginas
(function () {
  'use strict';
  const BASE = new URL('vendor/', document.currentScript.src).href;
  const PDFJS = BASE + 'pdfjs-6.5.438/';
  const NIVEIS = [ // dpi e qualidade JPEG, do melhor para o mais leve
    { dpi: 150, q: 0.75, nome: 'alta' },
    { dpi: 125, q: 0.68, nome: 'boa' },
    { dpi: 110, q: 0.6, nome: 'média' },
    { dpi: 96, q: 0.55, nome: 'média' },
    { dpi: 85, q: 0.5, nome: 'leve' },
    { dpi: 72, q: 0.45, nome: 'leve' },
    { dpi: 60, q: 0.4, nome: 'mínima' },
  ];
  const LADO_MAX = 2600; // px: evita telas gigantes em páginas enormes

  let libs;
  function carregar() {
    return (libs ||= (async () => {
      const pdfjs = await import(PDFJS + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      if (!window.PDFLib) {
        await new Promise((ok, erro) => {
          const s = document.createElement('script');
          s.src = BASE + 'pdf-lib-1.17.1.min.js'; s.onload = ok; s.onerror = () => erro(new Error('não foi possível carregar o pdf-lib'));
          document.head.appendChild(s);
        });
      }
      return { pdfjs, PDFLib: window.PDFLib };
    })().catch((e) => { libs = null; throw e; }));
  }

  const jpeg = (canvas, q) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));

  async function comprimir(file, { limite, progresso = () => {}, cancelado = () => false } = {}) {
    const { pdfjs, PDFLib } = await carregar();
    progresso({ fase: 'lendo' });
    const tarefa = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      standardFontDataUrl: PDFJS + 'standard_fonts/', wasmUrl: PDFJS + 'wasm/', iccUrl: PDFJS + 'iccs/',
      isEvalSupported: false,
    });
    const doc = await tarefa.promise;
    const total = doc.numPages;
    const alvo = limite * 0.97; // margem para a estrutura do PDF

    try {
      for (let n = 0; n < NIVEIS.length; n++) {
        const nivel = NIVEIS[n];
        const novo = await PDFLib.PDFDocument.create();
        let bytes = 0, estourou = false;
        for (let i = 1; i <= total; i++) {
          if (cancelado()) throw Object.assign(new Error('Compressão cancelada.'), { cancelado: true });
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const escala = Math.min(nivel.dpi / 72, LADO_MAX / Math.max(base.width, base.height));
          const vp = page.getViewport({ scale: escala });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
          const blob = await jpeg(canvas, nivel.q);
          canvas.width = canvas.height = 0; page.cleanup();
          const img = await novo.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          novo.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
          bytes += blob.size;
          progresso({ fase: 'comprimindo', pagina: i, total, nivel: n + 1, niveis: NIVEIS.length, bytes });
          // projeção: se já dá para ver que não vai caber, passa para o próximo nível
          if (i >= Math.min(5, total) && (bytes / i) * total > alvo) { estourou = true; break; }
        }
        if (estourou) continue;
        progresso({ fase: 'salvando' });
        const saida = await novo.save({ useObjectStreams: true });
        if (saida.length <= limite) return { blob: new Blob([saida], { type: 'application/pdf' }), nivel: nivel.nome, dpi: nivel.dpi, paginas: total };
      }
      throw new Error('Mesmo na menor qualidade o PDF não coube no limite. Divida o arquivo em partes.');
    } finally {
      tarefa.destroy(); // libera a memória do PDF original
    }
  }

  window.PdfCompress = { comprimir, carregar };
})();
