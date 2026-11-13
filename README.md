# mantini.ia.br — sistemas

Portal com sistemas simples de uso no trabalho, publicado em **https://www.mantini.ia.br**.

Tudo é **HTML + CSS + JavaScript puro** — sem build, sem dependências, sem servidor.
Cada sistema roda no navegador e guarda os dados **no próprio navegador** (localStorage).

## Estrutura

```
index.html          portal (lista de sistemas)
assets/base.css     visual compartilhado (cartões, botões, tabelas, modo escuro)
assets/export.js    exportação sem bibliotecas: .xlsx, .csv e .zip
assets/icon.svg     símbolo (logo) — também icon-512.png
assets/logo.svg     logo completo (símbolo + nome)
in_clock/           in_clock — tarefas, ponto/banco de horas, uso do Claude, relatórios
CNAME               domínio (www.mantini.ia.br)
```

## Sistemas

### in_clock (`/in_clock/`)
Versão web do Clock (Java/Swing), renomeado para in_clock. Mesmas funções:

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

## Privacidade (o repositório é público)

- O repositório contém **só o código** dos sistemas. Os dados (tarefas, ponto, uso do Claude)
  ficam no **navegador de quem usa** e nunca são enviados ao GitHub nem a servidor algum.
- O `.gitignore` bloqueia backups (`*backup*.json`), exportações (`.xlsx`, `.csv`, `.zip`),
  `clock_data.txt`, transcripts `.jsonl` e `.env`. Guarde material privado em `privado/` (ignorada).
- **Nunca** coloque senhas, tokens ou dados de clientes/processos no código. Se um dia um sistema
  precisar de dados online, eles vão para um banco com login (ex.: Supabase), não para o repositório.
- Se algo sensível for commitado por engano, apagar o arquivo não basta (fica no histórico):
  troque a credencial/segredo e peça ajuda para reescrever o histórico.

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

## Publicação (GitHub Pages + domínio)

1. *Settings → Pages → Build and deployment*: **Deploy from a branch**, branch `main`, pasta `/ (root)`.
2. Em *Custom domain*, informe `www.mantini.ia.br` (o arquivo `CNAME` já está no repo) e marque **Enforce HTTPS**
   quando o certificado ficar pronto.
3. DNS no registro.br (zona de `mantini.ia.br`):
   - `www` → **CNAME** `mantinidev.github.io`
   - raiz (`mantini.ia.br`) → **A** `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
     (o GitHub redireciona a raiz para o `www`).

Cada push no `main` publica a nova versão em ~1 minuto.
