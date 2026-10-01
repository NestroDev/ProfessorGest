/*
  ProfessorGest · Google Drive · configuração LOCAL

  Copie este arquivo para frontend/google-drive-config.local.js.
  O arquivo local está no .gitignore e nunca deve ser commitado.

  A API key é usada pelo Google Picker, portanto mantenha-a restrita
  a localhost/127.0.0.1 e às APIs necessárias no Google Cloud.
*/
window.PROFESSORGEST_GOOGLE_CONFIG = {
  ...(window.PROFESSORGEST_GOOGLE_CONFIG || {}),
  apiKey: 'SUA_API_KEY_LOCAL_RESTRITA',
};
