// Kit LGPD — catálogo: hipóteses legais, categorias de titulares e dados, medidas de segurança e modelos prontos.
// Os modelos são pontos de partida: o consultor revisa e ajusta à realidade de cada empresa.
(function () {
  'use strict';

  // Hipóteses legais — Lei 13.709/2018 (LGPD), art. 7º (dados pessoais) e art. 11 (dados sensíveis)
  const BASES = [
    ['a7_i', 'Art. 7º, I — Consentimento do titular'],
    ['a7_ii', 'Art. 7º, II — Cumprimento de obrigação legal ou regulatória'],
    ['a7_iii', 'Art. 7º, III — Execução de políticas públicas (administração pública)'],
    ['a7_iv', 'Art. 7º, IV — Realização de estudos por órgão de pesquisa'],
    ['a7_v', 'Art. 7º, V — Execução de contrato ou de procedimentos preliminares'],
    ['a7_vi', 'Art. 7º, VI — Exercício regular de direitos em processo judicial, administrativo ou arbitral'],
    ['a7_vii', 'Art. 7º, VII — Proteção da vida ou da incolumidade física'],
    ['a7_viii', 'Art. 7º, VIII — Tutela da saúde'],
    ['a7_ix', 'Art. 7º, IX — Legítimo interesse do controlador ou de terceiro'],
    ['a7_x', 'Art. 7º, X — Proteção do crédito'],
    ['a11_i', 'Art. 11, I — Consentimento específico e destacado'],
    ['a11_ii_a', 'Art. 11, II, a — Cumprimento de obrigação legal ou regulatória'],
    ['a11_ii_b', 'Art. 11, II, b — Execução de políticas públicas'],
    ['a11_ii_c', 'Art. 11, II, c — Realização de estudos por órgão de pesquisa'],
    ['a11_ii_d', 'Art. 11, II, d — Exercício regular de direitos, inclusive em contrato e em processo'],
    ['a11_ii_e', 'Art. 11, II, e — Proteção da vida ou da incolumidade física'],
    ['a11_ii_f', 'Art. 11, II, f — Tutela da saúde'],
    ['a11_ii_g', 'Art. 11, II, g — Prevenção à fraude e segurança do titular (identificação e autenticação)'],
  ];

  const TITULARES = [
    ['clientes', 'Clientes'], ['potenciais', 'Potenciais clientes (leads)'], ['usuarios', 'Usuários do site / app'],
    ['empregados', 'Empregados'], ['ex_empregados', 'Ex-empregados'], ['candidatos', 'Candidatos a vagas'],
    ['dependentes', 'Dependentes de empregados'], ['estagiarios', 'Estagiários e aprendizes'], ['prestadores', 'Prestadores de serviço / terceirizados'],
    ['fornecedores', 'Fornecedores (representantes)'], ['socios', 'Sócios e administradores'], ['visitantes', 'Visitantes'],
    ['pacientes', 'Pacientes'], ['alunos', 'Alunos e responsáveis'],
  ];

  const DADOS = [
    ['identificacao', 'Identificação (nome, CPF, RG, data de nascimento)'], ['contato', 'Contato (telefone, e-mail)'], ['endereco', 'Endereço'],
    ['documentos', 'Documentos oficiais (CNH, CTPS, título de eleitor)'], ['financeiros', 'Financeiros (conta bancária, cartão, renda)'],
    ['profissionais', 'Profissionais (cargo, salário, histórico)'], ['educacionais', 'Escolaridade e formação'], ['familiares', 'Familiares e dependentes'],
    ['imagem', 'Imagem e voz (fotos, vídeos, gravações)'], ['localizacao', 'Localização / geolocalização'], ['navegacao', 'Navegação (IP, cookies, dispositivo)'],
    ['consumo', 'Hábitos de consumo e histórico de compras'], ['juridicos', 'Processos judiciais e administrativos'], ['credito', 'Informações de crédito / restrições'],
  ];

  // art. 5º, II
  const SENSIVEIS = [
    ['saude', 'Saúde (atestados, exames, CID)'], ['biometria', 'Biometria (digital, reconhecimento facial)'], ['genetico', 'Genético'],
    ['racial', 'Origem racial ou étnica'], ['religiao', 'Convicção religiosa'], ['politica', 'Opinião política'],
    ['sindical', 'Filiação a sindicato'], ['organizacao', 'Filiação a organização religiosa, filosófica ou política'], ['sexual', 'Vida sexual'],
  ];

  // art. 46 — medidas de segurança, técnicas e administrativas
  const SEGURANCA = [
    ['acesso', 'Controle de acesso por perfil (só quem precisa)'], ['senhas', 'Senhas fortes e autenticação em dois fatores'],
    ['criptografia', 'Criptografia (em trânsito e armazenamento)'], ['backup', 'Cópias de segurança (backup)'], ['logs', 'Registro de acessos (logs)'],
    ['antivirus', 'Antivírus e atualizações'], ['treinamento', 'Treinamento da equipe'], ['confidencialidade', 'Termo de confidencialidade'],
    ['contratos', 'Cláusulas de proteção de dados com operadores'], ['pseudonimizacao', 'Pseudonimização'], ['anonimizacao', 'Anonimização'],
    ['descarte', 'Descarte seguro'], ['fisico', 'Arquivo físico trancado / acesso restrito'], ['politica', 'Política de segurança da informação'],
  ];

  const SEG_BASICA = ['acesso', 'senhas', 'backup', 'antivirus'];

  // Modelos — operações comuns na maioria das empresas
  const MODELOS = [
    { chave: 'folha', titulo: 'Folha de pagamento e obrigações trabalhistas', resumo: 'RH · empregados e dependentes · obrigação legal',
      area: 'Recursos Humanos', finalidade: 'Processar a folha de pagamento, recolher encargos e cumprir obrigações trabalhistas, previdenciárias e fiscais (eSocial, FGTS, INSS, IR).',
      base_legal: 'a11_ii_a', base_legal_justificativa: 'CLT, legislação previdenciária e eSocial. Dados de saúde (atestados) e de filiação sindical (contribuição) decorrem de obrigação legal — art. 11, II, a.',
      titulares: ['empregados', 'ex_empregados', 'dependentes', 'estagiarios'], dados: ['identificacao', 'contato', 'endereco', 'documentos', 'financeiros', 'profissionais', 'familiares'],
      dados_sensiveis: ['saude', 'sindical'], volume: '', fonte: 'O próprio empregado (admissão) e eventos do contrato de trabalho', formato: 'ambos',
      sistemas: 'Sistema de folha / ERP; pasta funcional', compartilhamento: 'eSocial / Receita Federal, Caixa (FGTS), INSS, bancos, operadoras de benefícios, sindicato',
      operadores: 'Escritório de contabilidade ou folha terceirizada (se houver)', retencao: 'Durante o vínculo e pelos prazos legais trabalhistas, previdenciários e fiscais após o desligamento (alguns registros por prazo maior)',
      descarte: 'Exclusão segura no sistema e fragmentação de documentos em papel ao fim do prazo', seguranca: [...SEG_BASICA, 'confidencialidade', 'contratos', 'fisico'], risco: 'medio' },
    { chave: 'saude_ocupacional', titulo: 'Saúde ocupacional (ASO, PCMSO)', resumo: 'SESMT · empregados · dado de saúde',
      area: 'Saúde e Segurança do Trabalho', finalidade: 'Realizar exames ocupacionais (admissional, periódico, demissional) e manter o PCMSO.',
      base_legal: 'a11_ii_a', base_legal_justificativa: 'NR-7 (PCMSO) e CLT, art. 168 — obrigação legal.',
      titulares: ['empregados', 'candidatos'], dados: ['identificacao', 'profissionais'], dados_sensiveis: ['saude'],
      fonte: 'Exames realizados pela clínica de medicina do trabalho', formato: 'ambos', sistemas: 'Clínica de medicina do trabalho; prontuário',
      compartilhamento: 'Médico do trabalho / clínica contratada; eSocial (eventos de SST)', operadores: 'Clínica de medicina do trabalho',
      retencao: 'Prontuário médico: no mínimo 20 anos após o desligamento (NR-7)', descarte: 'Descarte seguro após o prazo legal',
      seguranca: [...SEG_BASICA, 'confidencialidade', 'contratos', 'fisico', 'criptografia'], risco: 'alto' },
    { chave: 'recrutamento', titulo: 'Recrutamento e seleção', resumo: 'RH · candidatos · procedimentos preliminares',
      area: 'Recursos Humanos', finalidade: 'Receber currículos, avaliar candidatos e conduzir processos seletivos.',
      base_legal: 'a7_v', base_legal_justificativa: 'Procedimentos preliminares a um contrato de trabalho, a pedido do candidato. Banco de talentos após o processo: consentimento.',
      titulares: ['candidatos'], dados: ['identificacao', 'contato', 'endereco', 'profissionais', 'educacionais'], dados_sensiveis: [],
      fonte: 'O próprio candidato (currículo, formulário, plataformas de vagas)', formato: 'digital', sistemas: 'E-mail, plataforma de recrutamento, planilha',
      compartilhamento: 'Gestores da vaga', operadores: 'Plataforma de recrutamento / consultoria (se houver)',
      retencao: 'Até o fim do processo seletivo; banco de talentos por até 12 meses com consentimento', descarte: 'Exclusão dos currículos não aproveitados',
      seguranca: [...SEG_BASICA], risco: 'baixo' },
    { chave: 'clientes', titulo: 'Cadastro e atendimento de clientes', resumo: 'Comercial · clientes · execução de contrato',
      area: 'Comercial / Atendimento', finalidade: 'Cadastrar clientes, prestar o serviço ou vender o produto contratado e atender solicitações.',
      base_legal: 'a7_v', base_legal_justificativa: 'Execução do contrato com o cliente.',
      titulares: ['clientes'], dados: ['identificacao', 'contato', 'endereco', 'consumo'], dados_sensiveis: [],
      fonte: 'O próprio cliente', formato: 'digital', sistemas: 'ERP / CRM', compartilhamento: 'Transportadoras e parceiros necessários à entrega do serviço',
      operadores: 'Provedor do ERP/CRM, hospedagem em nuvem', retencao: 'Durante a relação e por 5 anos após o término (prazos prescricionais do CDC e do Código Civil)',
      descarte: 'Exclusão ou anonimização ao fim do prazo', seguranca: [...SEG_BASICA, 'logs', 'contratos'], risco: 'baixo' },
    { chave: 'financeiro', titulo: 'Faturamento e cobrança', resumo: 'Financeiro · clientes · contrato e obrigação fiscal',
      area: 'Financeiro', finalidade: 'Emitir notas fiscais, cobrar e registrar pagamentos.',
      base_legal: 'a7_v', base_legal_justificativa: 'Execução do contrato; emissão e guarda de documentos fiscais por obrigação legal (art. 7º, II).',
      titulares: ['clientes'], dados: ['identificacao', 'contato', 'endereco', 'financeiros'], dados_sensiveis: [],
      fonte: 'O próprio cliente', formato: 'digital', sistemas: 'ERP, emissor de notas, banco', compartilhamento: 'Bancos, meios de pagamento, contabilidade, Fisco',
      operadores: 'Contabilidade, gateway de pagamento', retencao: '5 anos para documentos fiscais (CTN) e prazos de cobrança',
      descarte: 'Exclusão segura ao fim do prazo', seguranca: [...SEG_BASICA, 'logs', 'contratos', 'criptografia'], risco: 'medio' },
    { chave: 'fornecedores', titulo: 'Cadastro de fornecedores e prestadores', resumo: 'Compras · representantes · execução de contrato',
      area: 'Compras / Administrativo', finalidade: 'Cadastrar fornecedores e prestadores, contratar, pagar e manter contato.',
      base_legal: 'a7_v', base_legal_justificativa: 'Execução do contrato com o fornecedor.',
      titulares: ['fornecedores', 'prestadores'], dados: ['identificacao', 'contato', 'financeiros'], dados_sensiveis: [],
      fonte: 'O próprio fornecedor', formato: 'digital', sistemas: 'ERP', compartilhamento: 'Contabilidade, bancos',
      operadores: 'Contabilidade', retencao: 'Durante o contrato e 5 anos após (prazos fiscais e prescricionais)', descarte: 'Exclusão segura',
      seguranca: [...SEG_BASICA], risco: 'baixo' },
    { chave: 'cftv', titulo: 'Videomonitoramento (câmeras)', resumo: 'Segurança · visitantes e empregados · legítimo interesse',
      area: 'Segurança patrimonial', finalidade: 'Proteger pessoas e patrimônio por meio de câmeras nas áreas comuns.',
      base_legal: 'a7_ix', base_legal_justificativa: 'Legítimo interesse na segurança do local, com aviso visível de monitoramento e sem câmeras em áreas íntimas. Registrar o teste de balanceamento (LIA).',
      titulares: ['visitantes', 'empregados', 'clientes', 'prestadores'], dados: ['imagem'], dados_sensiveis: [],
      fonte: 'Captação pelas câmeras', formato: 'digital', sistemas: 'DVR/NVR ou nuvem da empresa de segurança', compartilhamento: 'Autoridades policiais, quando requisitado ou em caso de incidente',
      operadores: 'Empresa de monitoramento (se houver)', retencao: 'Gravação contínua sobrescrita em cerca de 30 dias, salvo trechos ligados a incidente',
      descarte: 'Sobrescrita automática', seguranca: ['acesso', 'senhas', 'logs', 'fisico'], risco: 'medio' },
    { chave: 'portaria', titulo: 'Controle de acesso de visitantes (portaria)', resumo: 'Segurança · visitantes · legítimo interesse',
      area: 'Portaria / Recepção', finalidade: 'Identificar e registrar a entrada de visitantes por segurança.',
      base_legal: 'a7_ix', base_legal_justificativa: 'Legítimo interesse na segurança do local; coletar só o necessário (evitar foto e biometria se não forem indispensáveis).',
      titulares: ['visitantes', 'prestadores'], dados: ['identificacao', 'imagem'], dados_sensiveis: [],
      fonte: 'O próprio visitante', formato: 'ambos', sistemas: 'Sistema de portaria ou livro de visitas', compartilhamento: 'Não compartilhado, salvo requisição de autoridade',
      operadores: 'Empresa de portaria terceirizada (se houver)', retencao: 'Definir prazo curto (ex.: 6 meses)', descarte: 'Exclusão automática / fragmentação',
      seguranca: ['acesso', 'senhas', 'fisico'], risco: 'baixo' },
    { chave: 'site', titulo: 'Site, formulários e cookies', resumo: 'Marketing digital · usuários · consentimento',
      area: 'Marketing / TI', finalidade: 'Responder contatos do site e medir a navegação; cookies não essenciais só com aceite.',
      base_legal: 'a7_i', base_legal_justificativa: 'Cookies não essenciais (analytics, publicidade): consentimento pelo banner. Formulário de contato: procedimentos preliminares a pedido do titular (art. 7º, V).',
      titulares: ['usuarios', 'potenciais'], dados: ['identificacao', 'contato', 'navegacao'], dados_sensiveis: [],
      fonte: 'O próprio usuário e cookies', formato: 'digital', sistemas: 'Site, ferramenta de análise, e-mail', compartilhamento: 'Ferramentas de análise e publicidade (se usadas)',
      operadores: 'Hospedagem do site, Google Analytics ou similar', transferencia: true, transferencia_paises: 'Estados Unidos (servidores das ferramentas)',
      transferencia_mecanismo: 'Cláusulas-padrão contratuais (Res. CD/ANPD 19/2024)', retencao: 'Contatos: até a resposta e acompanhamento; cookies: conforme a política de cookies',
      descarte: 'Exclusão periódica', seguranca: ['acesso', 'senhas', 'criptografia', 'contratos'], risco: 'medio' },
    { chave: 'marketing', titulo: 'Marketing e envio de comunicações', resumo: 'Marketing · clientes e leads · consentimento / legítimo interesse',
      area: 'Marketing', finalidade: 'Enviar novidades, ofertas e comunicações por e-mail ou WhatsApp.',
      base_legal: 'a7_i', base_legal_justificativa: 'Leads: consentimento (opt-in) com descadastro fácil. Clientes atuais, ofertas relacionadas: legítimo interesse com opção de saída em toda mensagem.',
      titulares: ['clientes', 'potenciais'], dados: ['identificacao', 'contato', 'consumo'], dados_sensiveis: [],
      fonte: 'O próprio titular (cadastro, formulário)', formato: 'digital', sistemas: 'Ferramenta de e-mail marketing / CRM', compartilhamento: 'Ferramenta de envio',
      operadores: 'Plataforma de e-mail marketing', retencao: 'Até o descadastro ou revogação do consentimento', descarte: 'Exclusão da lista e da base',
      seguranca: ['acesso', 'senhas', 'contratos'], risco: 'baixo' },
  ];

  const nome = (lista, k) => (lista.find((x) => x[0] === k) || [k, k])[1];
  window.Catalogo = { BASES, TITULARES, DADOS, SENSIVEIS, SEGURANCA, MODELOS, nome };
})();
