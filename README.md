# mantini.ia.br — sistemas

Portal com sistemas simples de uso no trabalho, publicado em **https://www.mantini.ia.br**.

Tudo é **HTML + CSS + JavaScript puro**, sem build. O acesso aos sistemas exige **login (e-mail e senha)**,
feito pelo **Supabase** (projeto `mantini-ia`), que também guarda os dados e arquivos dos sistemas que precisam de servidor.

## Estrutura

```
index.html          portal (lista de sistemas)
assets/base.css     visual compartilhado (cartões, botões, tabelas, modo escuro)
assets/export.js    exportação sem bibliotecas: .xlsx, .csv e .zip
assets/icon.svg     símbolo (logo) — também icon-512.png
assets/logo.svg     logo completo (símbolo + nome)
assets/fonts/       Orbitron (fonte do logo, licença OFL)
assets/config.js    endereço e chave pública do Supabase
assets/auth.js      login compartilhado (protege as páginas, mostra usuário/Sair)
assets/vendor/      supabase-js 2.119.0 (MIT) hospedado no site
login/              tela de login e recuperação de senha
in_clock/           in_clock — tarefas, ponto/banco de horas, relatórios
processos/          Processos — controle pessoal de processos e documentos
supabase/migrations estrutura do banco (tabelas, regras de acesso, armazenamento)
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
  exportação **.xlsx** (abas: Lançamentos, Resumo por dia, Por categoria, Ponto)
  e **CSV** (um por seção, em .zip; `;`/`,` decimal para Excel BR ou `,`/`.` internacional).
- **Ajustes** — meta diária e semanal; backup/restauração em .json; **importar `clock_data.txt`** do Clock em Java
  (lançamentos, ponto, tarefa em andamento e metas; reimportar não duplica).

> Os dados ficam no navegador em que foram lançados. Para trocar de computador/navegador,
> use **Ajustes → Baixar backup** e **Restaurar backup**.

### Processos (`/processos/`)
Controle pessoal de processos judiciais:

- cadastro pelo número CNJ (formata, confere o dígito verificador e sugere o tribunal);
- **documentos** baixados do tribunal: arraste para o processo, visualize (PDF/imagem) ou baixe;
- **andamento**: data da última publicação + em qual documento o processo está. Ao carregar documentos,
  o sistema sempre pede o andamento; processos sem andamento há N dias (padrão 7) ficam em destaque;
- histórico de andamentos, busca, filtro por situação e exportação .xlsx.

Dados no Supabase (tabelas `processos`, `andamentos`, `documentos`) e arquivos no bucket **privado**
`documentos`. Regras RLS garantem que cada usuário só vê, envia e apaga o que é seu.

## Login

- Sem cadastro aberto: os acessos são criados no painel do Supabase (*Authentication → Users → Add user*).
- Todas as páginas de sistema carregam `assets/auth.js` com `data-protect`: sem sessão, vão para `/login/`.
- "Esqueci minha senha" envia um link por e-mail que abre `/login/` para definir uma nova senha.
- Para proteger um sistema novo, inclua no fim da página:
  ```html
  <script src="../assets/vendor/supabase-2.119.0.js"></script>
  <script src="../assets/config.js"></script>
  <script src="../assets/auth.js" data-root="../" data-protect></script>
  ```
  e um `<span id="user-slot"></span>` na barra do topo.

## Privacidade (o repositório é público)

- O repositório contém **só o código**. Os dados do in_clock ficam no navegador de quem usa; os processos e
  documentos ficam no Supabase, acessíveis só com login e só para o dono. Nada disso vai para o GitHub.
- A chave em `assets/config.js` é a chave **pública** (publishable) do Supabase, feita para ficar no navegador.
  A chave secreta (service_role) **nunca** deve entrar no repositório.
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
