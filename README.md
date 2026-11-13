# mantini.ia.br — sistemas

Portal com sistemas simples de uso no trabalho, publicado em **https://www.mantini.ia.br**.

Tudo é **HTML + CSS + JavaScript puro** — sem build, sem dependências, sem servidor.
Cada sistema roda no navegador e guarda os dados **no próprio navegador** (localStorage).

## Estrutura

```
index.html          portal (lista de sistemas)
assets/base.css     visual compartilhado (cartões, botões, tabelas, modo escuro)
assets/export.js    exportação sem bibliotecas: .xlsx, .csv e .zip
assets/icon.svg     ícone
clock/              Clock — tarefas, ponto/banco de horas, uso do Claude, relatórios
CNAME               domínio (www.mantini.ia.br)
```

## Sistemas

### Clock (`/clock/`)
Versão web do Clock (Java/Swing). Mesmas funções:

- **Tarefas** — nome, categoria, quantidade; Iniciar/Parar; a tarefa pausa/retoma junto com o Ponto;
  reunião com cronômetro separado (categoria "reunião"); lançamento manual com duração (`1h30m`, `90m`, `1:30`);
  filtro Hoje/Semana/Mês/Tudo; duplo-clique edita nome, categoria, quantidade, data e duração.
- **Ponto** — Entrada/Pausa/Retomar/Saída, saldo do dia e da semana, banco de horas acumulado;
  editor de dia (entrada, saída, pausas) e "Novo dia" para registros retroativos.
  O ícone da aba fica **verde** com ponto aberto e **amarelo** em pausa.
- **Relatórios** — período (inclui personalizado), resumo por categoria e por dia,
  exportação **.xlsx** (abas: Lançamentos, Resumo por dia, Por categoria, Ponto, Uso do Claude, Por projeto)
  e **CSV** (um por seção, em .zip; `;`/`,` decimal para Excel BR ou `,`/`.` internacional).
- **Uso do Claude** — selecione a pasta `%USERPROFILE%\.claude\projects`; os `.jsonl` são lidos localmente
  (nada é enviado) e o tempo ativo é estimado com o corte de ociosidade.
- **Ajustes** — meta diária, meta semanal, corte de ociosidade; backup/restauração em .json.

> Os dados ficam no navegador em que foram lançados. Para trocar de computador/navegador,
> use **Ajustes → Baixar backup** e **Restaurar backup**.

## Adicionar um novo sistema

1. Crie uma pasta, ex.: `meu-sistema/index.html`.
2. Reaproveite o visual: `<link rel="stylesheet" href="../assets/base.css">`
   (e `<script src="../assets/export.js"></script>` se precisar exportar planilha).
3. Adicione um cartão em `index.html` apontando para `meu-sistema/`.
4. Use uma chave própria no localStorage (ex.: `mantini.meu-sistema.v1`).

## Rodar localmente

```bash
python3 -m http.server 8000
```
e abra http://localhost:8000.

## Publicação (hospedagem + domínio)

O site é estático, então qualquer hospedagem estática serve. Como o repositório é **privado**:

- **Cloudflare Pages** (gratuito com repo privado — recomendado): *Workers & Pages → Create → Pages →
  Connect to Git* → escolha `mantiniDev/mantiniia`, build command vazio, output directory `/`.
  Depois, em *Custom domains*, adicione `www.mantini.ia.br` (e `mantini.ia.br` com redirecionamento).
- **GitHub Pages**: em repositório privado exige plano pago (ou tornar o repo público — ele não contém dados
  pessoais, os dados ficam nos navegadores). *Settings → Pages → Deploy from branch `main` / root*.
  DNS no registro.br: `www` → CNAME `mantinidev.github.io`; raiz → A `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`.
