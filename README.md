# mantini.ia.br — sistemas e conteúdos digitais

Produção de sistemas e conteúdos digitais — mostruário dos projetos, publicado em **https://www.mantini.ia.br**.

- **Projetos** (abertos ao público): [idbike](https://idbike.com.br) e [Remendo](https://remendo.com.br),
  em cartões com a imagem oficial de cada um (`assets/projetos/`).
- **Ferramentas sob medida** (público): apresenta o serviço de ferramentas internas para qualquer ramo, sem exemplos,
  com contato por WhatsApp e e-mail.
- **Ferramentas internas** (só aparecem com login): in_clock, Processos, Clientes e Kit LGPD. Ficam num `<template id="tpl-ferramentas">`
  em `index.html`, que só é montado na página depois do login.

Tudo é **HTML + CSS + JavaScript puro**, sem build. O acesso às ferramentas exige **login (e-mail e senha)**,
feito pelo **Supabase** (projeto `mantini-ia`), que também guarda os dados e arquivos dos sistemas que precisam de servidor.

**Novo projeto público no mostruário:** salve a imagem de capa (1200×630) em `assets/projetos/` e copie um
bloco `<a class="projeto">` em `index.html`.

## Estrutura

```
index.html          página inicial (projetos, sob medida e, com login, as ferramentas internas)
assets/base.css     visual compartilhado (cartões, botões, tabelas, modo escuro)
assets/export.js    exportação sem bibliotecas: .xlsx, .csv e .zip
assets/agenda.js    audiências: contador de dias, notificações e arquivo de agenda (.ics)
assets/icon.svg     símbolo (logo) — também icon-512.png
assets/sistemas/    ícones dos sistemas (emblema padrão + símbolo central)
clientes/           sistema Clientes (clientes, contratos de honorários, parcelas, recibo em PDF)
lgpd/               Kit LGPD (inventário das operações de tratamento por empresa; catalogo.js = bases legais e modelos)
assets/icon.svg     emblema (favicon, topo); logo-quadrado.svg = como o original; logo.svg = emblema + nome
assets/logo-antigo.jpg  logo original (referência); PNG: icon-512/192 (app, redes), favicon-32, emblema-512
ferramentas/gerar_icones.py  gera todos os SVG do logo e dos sistemas; exportar_png.js gera os PNG
assets/logo.svg     logo completo (símbolo + nome)
assets/fonts/       Orbitron (fonte do logo, licença OFL)
assets/config.js    endereço e chave pública do Supabase
assets/auth.js      login compartilhado (protege as páginas, mostra usuário/Sair)
assets/vendor/      supabase-js 2.119.0 (MIT), PDF.js 6.5 (Apache-2.0) e pdf-lib 1.17 (MIT), hospedados no site
login/              tela de login e recuperação de senha
in_clock/           in_clock — tarefas, ponto/banco de horas, relatórios
processos/          Processos — controle pessoal de processos e documentos
supabase/migrations estrutura do banco (tabelas, regras de acesso, armazenamento, agendador)
supabase/functions  aviso-diario (e-mail diário, Resend), admin (painel) e djen (publicações do CNJ)
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
- **audiências** (data/hora, tipo, local ou link): contador de dias ("em 3 dias", "amanhã"), em vermelho até 7 dias
  e amarelo até 30; aviso no portal e na lista para as audiências dos próximos N dias (padrão 7); notificação do
  navegador (1 vez por dia, ao abrir o site); botão para adicionar à agenda (.ics com lembretes 1 dia e 2 h antes)
  ou ao Google Agenda;
- histórico de andamentos, busca, filtro por situação e exportação .xlsx.
- **dois tipos de arquivo**: *documentos de andamento* (acumulam e pedem o registro do andamento) e
  *processo completo* (só a versão mais recente, com a data em que foi carregado; não é andamento e não entra no
  histórico; ao enviar um novo, o anterior é apagado do armazenamento, para não ocupar espaço);
- **PDFs acima de 50 MB** (limite do Supabase gratuito) são **comprimidos no navegador** antes do envio
  (PDF.js + pdf-lib, em `assets/pdf-compress.js`): cada página vira imagem JPEG, começando em 150 dpi e reduzindo só
  se for preciso. O texto deixa de ser pesquisável. Ex.: 208 MB / 70 páginas → 25 MB em ~15 s;
- **DJEN (publicações por OAB)**: botão ⚖️ OABs cadastra as OABs; 3x por dia (8h, 13h, 19h) a função `djen`
  consulta a API de Comunicações do CNJ (roda em São Paulo, `x-region: sa-east-1`, pois a API só aceita acesso do
  Brasil). Cada publicação entra uma vez só (id e hash); processo novo é cadastrado automaticamente
  ("Parte A x Parte B") e a publicação vira andamento (marcado "DJEN"). Aba **Publicações (DJEN)** com busca,
  não lidas e inteiro teor;
- **Lixeira** (processos e documentos): "Excluir" move para a lixeira (aviso com **Desfazer**); fica 30 dias com tudo
  (documentos, andamentos, audiências, publicações) e pode ser restaurado; depois o servidor apaga de vez,
  inclusive os arquivos. O e-mail diário avisa exclusões das últimas 24 h e o que sai da lixeira em até 3 dias;
- **Prazos processuais** (aba ⏳ Prazos e seção no processo): cada publicação do DJEN recebe uma **sugestão** de
  prazo (tipo de ato, dias, úteis/corridos e audiência marcada no texto), que só vale depois de conferida. A contagem
  (`assets/prazos.js`) segue o CPC: publicação no 1º dia útil após a disponibilização, início no 1º dia útil seguinte
  (art. 224), dias úteis (art. 219) ou corridos, prorrogação de início/vencimento em dia sem expediente ou com
  expediente reduzido, recesso de 20/12 a 20/01 (art. 220), feriados nacionais e móveis (Páscoa) e, nos tribunais
  federais e superiores, os da Lei 5.010/66. Feriados locais e suspensões ficam na tabela `feriados` (padrão do
  sistema + os de cada usuário). Botão **Cumprido** guarda a data do protocolo; prazos vão para a agenda (.ics) e
  para o e-mail diário (vencidos e os dos próximos 7 dias, mais as publicações aguardando definição).
- **e-mail diário às 7h** (botão ✉️ Avisos): audiências próximas, publicações novas do DJEN (últimas 24 h, com
  destaque para processos novos), processos sem andamento e a situação das buscas no DJEN por OAB. Chega **todo
  dia**, mesmo sem novidade ("nenhuma publicação no DJEN"), e alerta se uma OAB ficou mais de 1 dia sem busca.
  Também lista as audiências já marcadas para depois do prazo de aviso. Se o DJEN falhar (erro 5xx), a busca
  tenta de novo após 5 s e 20 s.

Dados no Supabase (tabelas `processos`, `andamentos`, `documentos`, `audiencias`) e arquivos no bucket **privado**
`documentos`. Regras RLS garantem que cada usuário só vê, envia e apaga o que é seu.

### Clientes (`/clientes/`)

- **Clientes:** ficha (PF/PJ) com CPF/CNPJ validado pelos dígitos verificadores, e-mail, telefone (botão WhatsApp),
  endereço e observações; vínculo com os processos do sistema Processos (para quem tem acesso aos dois).
- **Contratos:** tipo do contrato (padrão "Honorários advocatícios"; também prestação de serviços, consultoria,
  desenvolvimento de sistemas, locação ou texto livre) e forma de cobrança: valor fixo (à vista ou parcelado), mensal, êxito (%) ou fixo + êxito. As parcelas
  são geradas na hora (o centavo que sobra vai na última; dia 31 vira o último dia dos meses mais curtos).
- **Anexos do contrato:** contrato assinado, aditivos etc. (PDF, Word ou foto, até 50 MB cada), no cadastro do
  contrato, pelo botão "Anexar" ou arrastando o arquivo para o cartão. Bucket **privado** `contratos`
  (`<user_id>/<contrato_id>/<arquivo>`), aberto só por link temporário de 5 minutos; apagar o contrato, o cliente ou a
  conta (admin) apaga os arquivos.
- **Recebimento:** data, valor, forma (PIX, transferência…). Recebeu menos? Oferece lançar o saldo como nova parcela.
- **Recibo em PDF** (pdf-lib, gerado no navegador): antes de gerar abre uma tela com tudo editável (quem pagou,
  CPF/CNPJ, valor, "referente a", pagamento, quitação, cidade/data e quem assina), com prévia do texto. O que for
  editado fica guardado na parcela (`recibo_dados`) e a reimpressão sai igual. **Numeração própria de cada contrato**
  (001, 002…), via `proximo_recibo_contrato()`; o número pode ser trocado no recibo (a sequência continua depois do maior). O texto do serviço ("honorários advocatícios", "consultoria"…) vem dos
  ⚙️ Dados do recibo e cada contrato passa a usar o último texto editado nele.
- **Cobrar:** abre o WhatsApp do cliente com a mensagem pronta (valor, vencimento e chave PIX).
- **Painel:** vencidas, a receber no mês, recebido no mês e no ano; aba Parcelas com filtros e exportação .xlsx.
- E-mail diário das 7h: seção "💰 Valores a receber" (vencidas e próximos 7 dias).

Tabelas `clientes`, `clientes_processos`, `contratos`, `contratos_anexos`, `parcelas` e `emitente`, com RLS (dono + acesso ao sistema
"clientes"); gatilho confere que vínculos, contratos e parcelas apontam para registros do mesmo usuário.

### Kit LGPD (`/lgpd/`)

Para consultoria: cada **empresa atendida** tem o seu inventário das operações de tratamento (ROPA — LGPD, art. 37).

- **Empresa:** razão social, CNPJ validado, setor, endereço e encarregado (DPO, art. 41); pode ser puxada do sistema
  Clientes (pessoas jurídicas), para quem tem acesso aos dois.
- **Operação de tratamento:** área, responsável, papel (controladora/operadora), finalidade, hipótese legal (art. 7º
  ou art. 11) com justificativa, titulares, crianças e adolescentes (art. 14), dados pessoais, dados sensíveis (art. 5º,
  II), volume, origem, formato e sistemas, compartilhamento, operadores, transferência internacional (art. 33),
  retenção e descarte, medidas de segurança (art. 46), risco e revisão.
- **Ajudas:** 10 modelos prontos (folha, saúde ocupacional, recrutamento, clientes, faturamento, fornecedores, câmeras,
  portaria, site/cookies, marketing); indicador de preenchimento; pontos de atenção (dado sensível com base do art. 7º,
  legítimo interesse → LIA, consentimento, crianças, transferência sem mecanismo, RIPD quando o risco é alto) e risco
  sugerido. Os modelos e as listas ficam em `lgpd/catalogo.js`.
- **Saída:** planilha .xlsx do inventário (uma linha por operação) e relatório em PDF (capa com resumo + uma página
  por operação).

Tabelas `organizacoes` e `tratamentos`, com RLS (dono + acesso ao sistema "lgpd") e gatilho que confere o dono.

## E-mail diário

- Agendador do banco (`pg_cron`) chama a função `aviso-diario` todo dia às 10:00 UTC (7h de Brasília),
  com um código secreto guardado no Vault.
- A função lê as preferências de cada usuário (tabela `preferencias`), monta o resumo e envia pelo **Resend**.
- Segredos da função (Supabase → Edge Functions → Secrets): `RESEND_API_KEY` (obrigatório) e
  `EMAIL_FROM` (opcional, ex.: `mantini.ia.br <avisos@mantini.ia.br>` depois de verificar o domínio no Resend).

## Admin (`/admin/`)

Usuários e controle de acesso, com a mesma segurança do admin do idbike:

- **3 travas no servidor** (função `admin` no Supabase), conferidas a cada chamada: login válido,
  conta na tabela `admins` (vazia = ninguém entra) e **segundo fator** (aplicativo autenticador, sessão `aal2`).
  No primeiro acesso o admin cadastra o autenticador pelo QR code.
- Sessão só na aba (sessionStorage) e saída após 30 min parado; página fora do Google, sem scripts de fora
  (CSP) e sem poder ser aberta dentro de outro site.
- Tentativa de quem não é admin: registrada e alerta por e-mail aos admins (no máximo 1 por hora).
- Funções: criar usuário (senha temporária com troca obrigatória ou link por e-mail), sistemas liberados por
  usuário (aplicado também no banco), bloquear (corta o acesso na hora), renovar senha, encerrar sessões,
  zerar autenticador, dar/tirar admin e excluir conta (apaga também os documentos).
- **Auditoria**: tudo o que o admin faz fica em `admin_log`, visível no painel.
- O link **🔐 Admin** aparece na barra só para quem é admin.

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
3. Adicione um cartão dentro do `<template id="tpl-ferramentas">` em `index.html` apontando para `meu-sistema/`.
   **Ícone:** todo sistema usa o emblema padrão do site (o logo original, `assets/logo-antigo.jpg`, redesenhado
   em vetor) trocando só o símbolo do meio. Desenhe o símbolo em `ferramentas/gerar_icones.py` (quadro 64×64,
   branco, até ~11 px do centro), acrescente na lista do fim e rode `python3 ferramentas/gerar_icones.py`.
   Use o arquivo gerado no cartão, no `<link rel="icon">` e na barra do topo
   (`<span class="sys-name"><img src="../assets/sistemas/meu-sistema.svg" alt="">Nome</span>`).
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
