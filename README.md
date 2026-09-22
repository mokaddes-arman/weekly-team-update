# SQA Weekly Report Generator

This is a local Node.js web app that turns raw weekly SQA notes into a polished executive-summary PDF and stores metrics in a local SQLite database for a monthly dashboard.

## What it uses

- OpenRouter for AI narrative generation
- SQLite or Turso for report metric storage
- Puppeteer for PDF export
- Express for the web app and API

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local environment file:
   ```bash
   cp .env.example .env
   ```
   If you already have a `.env` file, update it with your values.
3. Configure the required environment variables in `.env`:
   ```env
   PORT=3000
   OPENROUTER_API_KEY=your_openrouter_key
   OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1
   OPENROUTER_FALLBACK_MODELS=openai/gpt-4o-mini,google/gemini-2.5-flash
   ```

   Optional database configuration:
   ```env
   TURSO_DATABASE_URL=libsql://your-db.turso.io
   TURSO_AUTH_TOKEN=your_turso_auth_token
   ```
4. Start the app:
   ```bash
   npm start
   ```
5. Open http://localhost:3000 in your browser.
6. Use the dashboard at http://localhost:3000/dashboard.

## AI flow

The app sends the weekly report inputs to OpenRouter and tries the primary model first, then fallback models if a request fails with a retryable status like 429, 502, 503, or 504.

## Notes

- The app uses a local SQLite database file named data.db unless Turso environment variables are provided.
- Generated PDFs are stored temporarily in the temp folder and are deleted automatically after download.
- Report content is entered manually in the form, and the narrative is rewritten by the configured OpenRouter model.
- If no OpenRouter key is set, the app will refuse to generate AI content with a clear error message.
