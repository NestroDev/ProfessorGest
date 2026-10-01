# ProfessorGest

Aplicativo PWA local-first para organização e acompanhamento pedagógico.

## Arquitetura

O projeto é dividido em duas partes:

```text
frontend/   → PWA, interface, IndexedDB, arquivos .prg, Service Worker e cliente de API
backend/    → API HTTP stateless para serviços que realmente dependem de servidor
```

O projeto continua **local-first**. O arquivo `.prg` pertence ao usuário e continua sendo a fonte principal dos dados. O IndexedDB é usado para apoio local, recuperação e cache limitado. O Google Drive é opcional.

O frontend não precisa do backend para abrir, editar, salvar ou exportar um `.prg`.

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

Para habilitar o Google Drive no GitHub Pages, crie o secret opcional:

```text
PROFESSORGEST_GOOGLE_API_KEY
```

Se o secret não existir, o deploy continua normalmente e o restante do aplicativo permanece funcional; apenas a integração com Drive fica desativada. O workflow injeta a chave somente no artefato de publicação, nunca no repositório.

Para desenvolvimento local, copie `config/google-drive-config.local.example.js` para `frontend/google-drive-config.local.js` e mantenha a chave fora do controle de versão. Esse arquivo local é ignorado pelo `.gitignore` e não faz parte do projeto distribuído.

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

A suíte cobre modelo `.prg`, persistência local, Drive, I/O de arquivos, navegação, modais, views, PWA, acessibilidade estrutural, salvamento e integridade do release.

O teste de artefato também pode ser executado diretamente com:

```bash
npm test
```

A validação final em navegador real, especialmente permissões do Google Drive e comportamento do Web App instalado no Android, continua sendo uma etapa manual.

## Integração com DED+

- A tela inicial permite criar um novo arquivo a partir de um ou vários PDFs de turmas exportados pelo DED+.
- A aba **Turmas** permite adicionar novas turmas do DED+ sem substituir as existentes.
- Turmas vinculadas ao DED+ podem ser atualizadas posteriormente por meio de **Atualizar com DED**.
- A atualização usa os códigos do DED para reconhecer alunos e preserva alunos que não aparecem no PDF atual, evitando perda de histórico.
- O projeto mantém os metadados de escola, turma, ano, turno, componente e código do DED por turma.
