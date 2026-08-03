## Configuration

Create a copy of `config.example.js` and rename it to `config.js`.

Then add your own Supabase project details:

```javascript
window.APP_CONFIG = {
  PUBLIC_APP_URL: "https://your-hosted-app.pages.dev",
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "your-publishable-key"
};
