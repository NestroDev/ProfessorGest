# ProfessorGest

Aplicativo PWA local-first para organização e acompanhamento pedagógico.

## Arquitetura

O projeto é dividido em duas partes:

```text
frontend/   → PWA, interface, IndexedDB (projetos), importação/exportação .prg, Google Drive, Service Worker e cliente de API
backend/    → API HTTP stateless para serviços que realmente dependem de servidor
```

O ProfessorGest armazena os projetos localmente no dispositivo. `.prg` é um formato portátil para importação e exportação. Google Drive é uma opção de armazenamento/sincronização em nuvem.

O **projeto** é a entidade principal: tem `projectId` estável, nome, datas, contagem de turmas e alunos e, opcionalmente, um vínculo com o Google Drive.

| Camada | Papel | Módulo |
| --- | --- | --- |
| IndexedDB | Armazenamento real (`projects`, `projectData`, `backups`, `recovery`, `settings`), sem limite de projetos | `src/project-store.js` |
| `.prg` | Importar/exportar. Nome do arquivo derivado do projeto. Exportar nunca altera o projeto | `src/prg-transfer.js` |
| Google Drive | Cópia remota e sincronização por projeto | `src/drive-sync.js` |
| DED+ | Atualizar o projeto com vários PDFs, sem apagar alunos ausentes | `src/ded-project.js` |

Backups (até 10 por projeto) e recovery pertencem a cada `projectId`. Bancos e `.prg` antigos continuam compatíveis: o banco antigo é migrado de forma aditiva, uma única vez, e o campo `name` do `.prg` é opcional (sem mudança de `PRG_VERSION`).

Importar um `.prg` cujo `projectId` já existe pede uma decisão: **Substituir** (cria backup antes) ou **Importar como cópia** (novo `projectId`, sem herdar o vínculo com o Drive).

O frontend não precisa do backend para criar, editar, salvar, importar ou exportar projetos.

## API

A API utiliza endpoints versionados:

```text
GET /api/v1/health
GET /api/v1/version
```

Respostas de erro seguem um formato consistente:

```json
{
  "error": {
    "code": "SOME_ERROR",
    "message": "Descrição legível"
  }
}
```

Para iniciar a API localmente:

```bash
npm run start:api
```

Por padrão ela escuta em `http://127.0.0.1:8787`.

Quando necessário, o frontend pode usar a API através de `window.PROFESSORGEST_API_BASE_URL`. O acesso é centralizado em `frontend/src/services/api-client.js`; chamadas de domínio não devem espalhar `fetch()` diretamente pelas views.

A API atual é deliberadamente pequena e stateless. Ela é **opcional**: o ProfessorGest funciona no GitHub Pages sem qualquer backend hospedado. Não existe sincronização obrigatória nem armazenamento automático de todos os arquivos `.prg` em um servidor.

Para usar um backend opcional em uma implantação, configure a variável pública de repositório `PROFESSORGEST_API_BASE_URL` com uma URL HTTPS. Sem essa variável, o cliente de API permanece desativado.

## Google Drive

O identificador OAuth e o App ID são públicos. A API Key não deve ficar no repositório.

**Escopo:** apenas `https://www.googleapis.com/auth/drive.file` (menor privilégio). O app só enxerga arquivos que ele criou ou que o usuário abriu pelo Picker. Os arquivos do ProfessorGest são identificados por `appProperties` (`app`, `projectId`, `format`, `version`), nunca pelo nome.

- O token de acesso nunca é persistido. Só a identidade da conta (nome, e-mail, foto, `permissionId`) fica lembrada, usada como `login_hint`. Nenhum popup é aberto sem um gesto do usuário.
- **Sincronizar agora** envia a versão local. A falha do Drive (offline, 401, 403, 404) nunca altera os dados locais.
- Se o Drive mudou e o projeto local também, o app pede uma escolha explícita (**manter versão deste dispositivo** ou **usar versão do Google Drive**), criando backup antes. Não há merge automático.
- **Desvincular** só remove o vínculo. **Mover para a lixeira** respeita `capabilities.canTrash` e mantém o projeto local. **Remover dos dois lugares** só apaga o local se o Drive tiver confirmado.
- A tela inicial pode listar projetos "Somente no Google Drive" e adicioná-los ao dispositivo (com tratamento de colisão de `projectId`). "Importar do Google Drive" (Picker) continua cobrindo `.prg` antigos criados antes do uso de `appProperties`.

Para habilitar o Google Drive no GitHub Pages, crie o secret opcional:

```text
PROFESSORGEST_GOOGLE_API_KEY
```

Se o secret não existir, o deploy continua normalmente; apenas a integração com Drive fica desativada. O workflow injeta a chave somente no artefato de publicação.

Para desenvolvimento local, copie `config/google-drive-config.local.example.js` para `frontend/google-drive-config.local.js` e mantenha a chave fora do controle de versão.

## Navegação e sessão

A navegação do aplicativo usa History API e `popstate`. A rota atual e seu contexto serializável ficam em `sessionStorage`, permitindo continuar na mesma área depois de recarregar a página.

O botão Voltar do Android segue o histórico real do aplicativo. Modais e overlays têm tratamento próprio antes de abandonar a rota.

## Modelo de acompanhamento

O ProfessorGest acompanha **alunos conforme a necessidade do professor**. Uma turma não exige que a lista completa de alunos esteja cadastrada.

Um aluno pode ser criado diretamente durante o registro de uma ocorrência. Depois disso, o histórico do aluno é composto principalmente por:

- ocorrências;
- observações;
- registros de acompanhamento.

Atividades são tratadas como itens de agenda pedagógica, com nome, turma, data e descrição. O antigo fluxo de controle de entrega individual não faz mais parte do fluxo principal.


## PWA e mobile

No Android, a navegação principal usa uma barra inferior e uma entrada dedicada para recursos de aula, mantendo Planejamento e Calendário acessíveis. A interface usa `viewport-fit=cover` e safe areas quando necessário.

Os documentos públicos de Termos e Privacidade usam o mesmo sistema visual e respeitam o tema salvo pelo aplicativo.

## GitHub Pages

O diretório `dist/` é gerado durante o build e **não deve ser versionado nem incluído no pacote-fonte**.

Gerar o artefato:

```bash
npm run build:pages
```

O GitHub Actions publica somente o artefato gerado para Pages.

No repositório devem permanecer o código-fonte, testes, scripts, documentação e arquivos de configuração seguros. Dados de usuário, arquivos `.prg`, logs, ZIPs e configurações locais não devem ser enviados.

## QA

O gate local completo é:

```bash
npm run qa
```

Ele executa:

1. checagem sintática dos módulos do frontend e backend;
2. geração do artefato do GitHub Pages;
3. suíte automatizada.

A suíte cobre modelo `.prg`, store de projetos (IndexedDB), importação/exportação, sincronização com Drive (com um Drive falso), DED+, navegação, modais, views, PWA e integridade do release.

Há também dois testes ponta a ponta opcionais, que exigem Playwright e Chromium (não rodam em `npm test`):

```bash
NODE_PATH=<node_modules global> node scripts/e2e-smoke.mjs   # projetos, import/export, recovery, migração
NODE_PATH=<node_modules global> node scripts/e2e-drive.mjs   # Drive falso: sync, conflito, lixeira, desvincular
```

O teste de artefato também pode ser executado diretamente com:

```bash
npm test
```

A validação final em navegador real, especialmente permissões do Google Drive e comportamento do Web App instalado no Android, continua sendo uma etapa manual.

## Integração com DED+

- Ao criar um projeto é possível começar por um ou vários PDFs de turmas exportados pelo DED+.
- A aba **Turmas** permite adicionar novas turmas do DED+ sem substituir as existentes.
- **Atualizar projeto com DED+** aceita vários PDFs numa operação: turmas existentes são atualizadas, turmas novas são criadas, PDFs repetidos são ignorados, e há prévia e resumo final (turmas atualizadas/adicionadas, alunos novos, nomes alterados, ausentes preservados). Um backup é criado antes.
- A atualização usa os códigos do DED para reconhecer alunos e preserva alunos que não aparecem no PDF atual, evitando perda de histórico.
- O projeto mantém os metadados de escola, turma, ano, turno, componente e código do DED por turma.
