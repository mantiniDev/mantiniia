# Gera os ícones do site a partir do logo original (assets/logo-antigo.jpg), redesenhado em vetor:
# emblema de órbitas com o monograma "MA". Os sistemas usam o mesmo emblema trocando só o símbolo do meio.
#   assets/icon.svg            emblema redondo (favicon, topo, página inicial)
#   assets/logo-quadrado.svg   como o original: quadro escuro (ícone de app, redes sociais)
#   assets/logo.svg            emblema + nome "mantini.ia.br"
#   assets/sistemas/*.svg      um por sistema (novo sistema: crie o símbolo abaixo e acrescente na lista do fim)
# Os PNG (icon-512.png, icon-192.png, favicon-32.png) são exportados a partir desses SVG (node ferramentas/exportar_png.js assets).
# Coordenadas no quadro 1024×1024 do original; centro (512, 512).
import math, os, sys
C = 512
RED1, RED2 = '#f86a63', '#e63946'          # vermelho: mais claro em cima, mais escuro embaixo
GRAY1, GRAY2 = '#6c8394', '#32465a'        # órbitas: idem
WHITE = '#fffdf3'
INK = '#04111a'
def pt(r, a): return (C + r * math.cos(math.radians(a)), C + r * math.sin(math.radians(a)))
def arc(r, a1, a2, cor='url(#cinza)', w=17):
    x1, y1 = pt(r, a1); x2, y2 = pt(r, a2); large = 1 if (a2 - a1) % 360 > 180 else 0
    return f'<path d="M{x1:.1f} {y1:.1f}A{r} {r} 0 {large} 1 {x2:.1f} {y2:.1f}" stroke="{cor}" stroke-width="{w}"/>'

def defs(pref=''):
    return (f'<linearGradient id="{pref}verm" gradientUnits="userSpaceOnUse" x1="0" y1="150" x2="0" y2="874">'
            f'<stop offset="0" stop-color="{RED1}"/><stop offset="1" stop-color="{RED2}"/></linearGradient>'
            f'<linearGradient id="{pref}cinza" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="830">'
            f'<stop offset="0" stop-color="{GRAY1}"/><stop offset="1" stop-color="{GRAY2}"/></linearGradient>')

def emblema(centro, pref=''):
    V, G = f'url(#{pref}verm)', f'url(#{pref}cinza)'
    s = [f'<circle cx="{C}" cy="{C}" r="358" fill="{INK}"/>',
         f'<circle cx="{C}" cy="{C}" r="347" fill="none" stroke="{V}" stroke-width="22"/>']
    a = []
    # órbita externa
    a += [arc(298, -148, -111, V), arc(298, -110, -100, G), arc(298, -88, -25, G), arc(298, 8, 33, G), arc(298, 140, 172, G)]
    # órbita do meio
    a += [arc(243, -177, -156, G), arc(243, -114, -57, G), arc(243, -35, -3, G), arc(243, 10, 30, G),
          arc(243, 61, 82, G), arc(243, 96, 121, G), arc(243, 144, 170, G)]
    # órbita interna
    a += [arc(187, -166, -106, G), arc(187, -71, -13, G), arc(187, 14, 20, G), arc(187, 38, 70, G), arc(187, 107, 140, G), arc(187, 159, 166, G)]
    s.append(f'<g fill="none" stroke-linecap="round">{"".join(a)}</g>')
    # pontos cinza (início da órbita no topo, à esquerda e o gancho embaixo à direita)
    for (r, ang, raio) in [(298, -91, 12), (296, -160, 11)]:
        x, y = pt(r, ang); s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{raio}" fill="{G}"/>')
    x1, y1 = pt(180, 45); x2, y2 = pt(237, 39)
    s.append(f'<path d="M{x1:.1f} {y1:.1f}Q{x1+30:.1f} {y1+2:.1f} {x2:.1f} {y2:.1f}" fill="none" stroke="{G}" stroke-width="15" stroke-linecap="round"/>'
             f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="12" fill="{G}"/>')
    # nós vermelhos (anel) e pontos vermelhos
    nos = ''.join(f'<circle cx="{C+dx}" cy="{C+dy}" r="15"/>' for dx, dy in
                  [(-152, -192), (158, -192), (0, -165), (-289, 0), (-187, 0), (188, 0), (285, 0), (0, 153), (-157, 188), (158, 188)])
    s.append(f'<g fill="{INK}" stroke="{V}" stroke-width="12">{nos}</g>')
    pts = ''.join(f'<circle cx="{C+dx}" cy="{C+dy}" r="12"/>' for dx, dy in [(-202, -127), (283, -97), (3, 233)])
    s.append(f'<g fill="{V}">{pts}</g>')
    s.append(centro)
    return ''.join(s)

# Monograma "MA": dois "A" encaixados — o da esquerda com travessa cinza (sombra), o da direita com travessa branca.
MA = (f'<path fill="#4c6072" d="M425 528H449L466 570H442L437 552H417Z"/>'
      f'<path fill="{WHITE}" fill-rule="evenodd" d="M360 590L450 398L539 590ZM396 590L448 476.5L505 590Z"/>'
      f'<path fill="{WHITE}" fill-rule="evenodd" d="M492 590L581 398L670 590ZM527 590L581 473.5L635 590Z"/>'
      f'<path fill="{WHITE}" d="M581 532H650V570H563Z"/>')

def sistema(simbolo):
    # símbolos antigos (quadro 64) ampliados para o centro do emblema
    return f'<g transform="translate(512 512) scale(10.2) translate(-32 -32)">{simbolo}</g>'
IN_CLOCK = sistema('<circle cx="32" cy="32" r="11" fill="none" stroke="#fffdf3" stroke-width="2.8"/>'
                   '<path d="M32 25.5V32l4.6 2.8" fill="none" stroke="#fffdf3" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
                   '<circle cx="32" cy="32" r="1.5" fill="#fffdf3"/>')
PROCESSOS = sistema('<g fill="none" stroke="#fffdf3" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'
                    '<path d="M32 21.5V41.5M27 42h10M23 25.5h18"/>'
                    '<path d="M25 25.5l-3.6 7.6M25 25.5l3.6 7.6M39 25.5l-3.6 7.6M39 25.5l3.6 7.6"/>'
                    '<path d="M20.6 33.2a4.4 3 0 0 0 8.8 0zM34.6 33.2a4.4 3 0 0 0 8.8 0z" fill="#fffdf3"/>'
                    '</g><circle cx="32" cy="21.2" r="1.7" fill="#fffdf3"/>')
CLIENTES = sistema('<g fill="none" stroke="#fffdf3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
                   '<circle cx="28" cy="25.2" r="4.4"/><path d="M19.4 40c0-5.3 3.8-8.8 8.6-8.8 2.4 0 4.5.9 6 2.4"/></g>'
                   '<circle cx="39.6" cy="36.4" r="5.6" fill="#04111a" stroke="#fffdf3" stroke-width="2.2"/>'
                   '<path d="M41.5 34.6c-.4-.8-1.1-1.1-1.9-1.1-1 0-1.8.5-1.8 1.4 0 1.9 3.7 1.1 3.7 3.1 0 .9-.8 1.5-1.9 1.5-.9 0-1.7-.4-2-1.2M39.6 32.4v1.1M39.6 39.5v1.1" '
                   'fill="none" stroke="#fffdf3" stroke-width="1.3" stroke-linecap="round"/>')
LGPD = sistema('<path d="M32 20.6l9.2 3.6v6.6c0 6.1-3.9 10.6-9.2 12.6-5.3-2-9.2-6.5-9.2-12.6v-6.6z" fill="none" stroke="#fffdf3" stroke-width="2.6" stroke-linejoin="round"/>'
               '<path d="M27.6 31.6l3.2 3.2 5.8-6" fill="none" stroke="#fffdf3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')
VIDEOS = sistema('<rect x="21.5" y="24" width="21" height="16" rx="3" fill="none" stroke="#fffdf3" stroke-width="2.6"/>'
                 '<path d="M29.6 28.2v7.6l6.4-3.8z" fill="#fffdf3"/>'
                 '<path d="M24 21.2h16" stroke="#fffdf3" stroke-width="2.2" stroke-linecap="round"/>')
NOVO = sistema('<path d="M32 24v16M24 32h16" stroke="#fffdf3" stroke-width="3.2" stroke-linecap="round"/>')

def svg_redondo(centro):
    # só o emblema, fundo transparente fora do círculo (favicon, barra do topo, cartões)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 150 724 724"><defs>{defs()}</defs>{emblema(centro)}</svg>\n'
def svg_quadrado(centro):
    # como o original: quadro escuro com degradê (ícone de app, redes sociais)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>{defs()}'
            f'<linearGradient id="fundo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#142736"/><stop offset="1" stop-color="#020f18"/></linearGradient>'
            f'</defs><rect width="1024" height="1024" fill="url(#fundo)"/>{emblema(centro)}</svg>\n')

def svg_horizontal(palavra):
    # emblema + nome (para cabeçalhos e documentos); "palavra" = paths do nome no quadro 276×64
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 276 64"><svg x="0" y="0" width="64" height="64" viewBox="150 150 724 724">'
            f'<defs>{defs("h")}</defs>{emblema(MA, "h")}</svg>{palavra}</svg>\n')

if __name__ == '__main__':
    # uso: python3 ferramentas/gerar_icones.py   (grava em assets/)
    raiz = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(raiz, 'assets')
    os.makedirs(out + '/sistemas', exist_ok=True)
    open(out + '/icon.svg', 'w').write(svg_redondo(MA))
    open(out + '/logo-quadrado.svg', 'w').write(svg_quadrado(MA))
    for nome, c in [('in_clock', IN_CLOCK), ('processos', PROCESSOS), ('clientes', CLIENTES), ('lgpd', LGPD), ('videos', VIDEOS), ('novo', NOVO)]:
        open(f'{out}/sistemas/{nome}.svg', 'w').write(svg_redondo(c))
    # logo horizontal: reaproveita o nome "mantini.ia.br" (Orbitron) já desenhado em logo-nome.svg
    nome = open(os.path.join(raiz, 'ferramentas', 'logo-nome.svg')).read()
    open(out + '/logo.svg', 'w').write(svg_horizontal(nome))
    print('ícones gerados em', out)
