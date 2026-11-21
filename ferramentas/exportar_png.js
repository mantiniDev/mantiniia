// Exporta os PNG do logo a partir dos SVG (precisa do Playwright): node ferramentas/exportar_png.js assets
const { chromium } = require('playwright'); const fs = require('fs'); const A = process.argv[2];
const u = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(A + '/' + f).toString('base64');
(async () => { const b = await chromium.launch();
  for (const [src, dst, s, transp] of [['logo-quadrado.svg', 'icon-512.png', 512], ['logo-quadrado.svg', 'icon-192.png', 192], ['icon.svg', 'favicon-32.png', 32, true], ['icon.svg', 'emblema-512.png', 512, true]]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0;background:transparent"><img src="${u(src)}" width=${s} height=${s} style="display:block"></body>`);
    await p.waitForTimeout(200); await p.screenshot({ path: A + '/' + dst, omitBackground: !!transp }); await p.close();
  }
  await b.close(); })();
