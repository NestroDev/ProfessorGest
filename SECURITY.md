# Security

Do not commit real Google API keys, OAuth access/refresh tokens, service-account keys, `.prg` files containing user data, or logs containing personal data.

The public `google-drive-config.js` intentionally contains no API key. The production deployment injects `PROFESSORGEST_GOOGLE_API_KEY` from GitHub Actions Secrets.

Because browser applications expose their API key to the browser, the key must be protected with Google Cloud application and API restrictions. For the Google Picker, allow the application origin and `https://docs.google.com/*`, and restrict the key to the Picker and Drive APIs used by ProfessorGest.

If an API key has ever been committed to a public repository, treat that key as exposed and rotate/revoke it in Google Cloud before continuing to use the project.
