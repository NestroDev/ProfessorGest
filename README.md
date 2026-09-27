# ProfessorGest

Aplicativo web para organização e acompanhamento pedagógico.

## Publicação no GitHub Pages

O site é publicado pelo GitHub Actions. O repositório pode permanecer público sem armazenar a chave da API do Google Drive.

### 1. Criar o Secret da API Key

No GitHub, abra:

`Settings → Secrets and variables → Actions → New repository secret`

Crie:

`PROFESSORGEST_GOOGLE_API_KEY`

O valor deve ser uma API Key do Google Cloud **restrita ao site e às APIs necessárias**.

### 2. Configurar o GitHub Pages

Em:

`Settings → Pages → Build and deployment → Source`

selecione **GitHub Actions**.

O workflow `.github/workflows/deploy-pages.yml` injeta a API Key somente no artefato que será publicado. A chave não é gravada de volta no repositório.

### 3. Configurar o Google Cloud

Para o Google Picker, restrinja a API Key por website e inclua o domínio do ProfessorGest e `https://docs.google.com/*`. Restrinja também a chave às APIs usadas pelo aplicativo, incluindo Google Picker API e Google Drive API. Consulte a documentação oficial do Google antes de publicar alterações de credenciais.

### Desenvolvimento local

A configuração pública fica em `google-drive-config.js` e não precisa ser alterada para testar o Drive. Para usar o Google Drive localmente, copie `config/google-drive-config.local.example.js` para `google-drive-config.local.js` na raiz e coloque apenas a API key local no arquivo. Esse arquivo já está no `.gitignore`, então ele não será enviado ao GitHub.

Assim, o fluxo fica estável: a chave local permanece no seu ambiente de desenvolvimento, enquanto o GitHub Actions continua injetando a chave de produção no artefato publicado. Você não precisa ficar colocando e retirando a chave antes de cada push.

Para o OAuth, adicione no Google Cloud as origens JavaScript autorizadas que você realmente usa no desenvolvimento, por exemplo `http://localhost:5500` e `http://127.0.0.1:5500`. Para a API key do Picker, a documentação do Google também exige a origem local e `https://docs.google.com/*` nas restrições de site.

O arquivo `google-drive-config.local.js` pode ficar assim:

```js
window.PROFESSORGEST_GOOGLE_CONFIG = {
  ...(window.PROFESSORGEST_GOOGLE_CONFIG || {}),
  apiKey: 'SUA_API_KEY_LOCAL_RESTRITA',
};
```

## Dados de usuário

Arquivos `.prof`, `.prof.json` e logs não devem ser enviados ao repositório.

## Arquitetura e segurança

A partir do formato v3, cada projeto possui `projectId` estável. O nome do arquivo não é usado como identidade do projeto. Vínculos com o Google Drive são indexados por `projectId`.

Arquivos `.prof` são tratados como entrada não confiável: IDs, referências, datas, tipos e limites são validados antes do projeto ser aceito. O recovery principal é mantido em IndexedDB e o armazenamento local preserva projetos por identificador. Além da recuperação imediata, o aplicativo mantém cópias de segurança automáticas e recentes do projeto neste dispositivo, permitindo revisão e restauração quando necessário.

O exportador de PDF é carregado somente quando solicitado. O Service Worker não ativa automaticamente uma nova versão enquanto o aplicativo pode estar com alterações locais pendentes.

Para validação local:

```bash
npm run qa
```

## Arquitetura atual

O código de domínio do formato `.prof`, a persistência IndexedDB, os vínculos do Google Drive, o transporte HTTP do Drive, o I/O de arquivos, os seletores/estatísticas, a navegação e as primitivas de modal ficam em módulos separados em `src/`. `app.js` permanece como camada de orquestração da interface e das views, enquanto essas camadas podem ser testadas independentemente.

O formato v3 usa `projectId` como identidade estável. O nome do arquivo continua sendo apenas uma apresentação/localização. Os vínculos do Drive são armazenados por `projectId`, permitindo que projetos com o mesmo nome coexistam sem compartilhar acidentalmente a sincronização.

O cache offline do Service Worker inclui todos os módulos JavaScript necessários para a execução da aplicação em modo offline. O transporte do Drive e o I/O de arquivos continuam sem efeitos colaterais em módulo, recebendo dependências do ambiente quando necessário.

## Arquitetura atual (build 2026.09.27.21)

A base do aplicativo permanece local-first. As responsabilidades críticas já estão separadas em módulos: `prof-model.js`, `local-store.js`, `drive-bindings.js`, `drive-http.js`, `file-io.js`, `project-selectors.js`, `ui-navigation.js`, `ui-modal.js`, `save-state.js` e `views-core.js`, `views-students-activities.js`, `views-calendar-occurrences.js`, `views-reports.js`, `views-class.js`, `views-file-settings.js` e `views-welcome.js`. O `app.js` permanece como orquestrador de eventos, estado e ações, enquanto as views podem ser testadas independentemente.

O pipeline local de QA executa checagem sintática e testes automatizados com `npm run qa`. O Service Worker inclui todos os módulos do shell offline.

A suíte atual possui testes automatizados para modelo, persistência, Drive, I/O, acessibilidade estrutural, máquina de salvamento, navegação, modais e renderização das views. A contagem é validada automaticamente pelo pipeline `npm run qa`. A validação de navegador completo e de dispositivos físicos Android/Google Drive continua sendo uma etapa de validação externa, porque depende de execução em um ambiente de navegador real com permissões e APIs de plataforma.

## Artefato de publicação

O repositório contém código-fonte, testes, documentação e configuração de desenvolvimento. O GitHub Pages publica somente o diretório `dist/`, gerado por `npm run build:pages`. Esse diretório contém apenas os arquivos necessários ao funcionamento do aplicativo e à verificação do domínio.
