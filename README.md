# SQA Weekly Report Generator

This is a local Node.js web app that turns raw weekly SQA notes into a polished executive-summary PDF and stores metrics in a local SQLite database for a monthly dashboard.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the example environment file if you want to set a custom port:
   ```bash
   cp .env.example .env
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open http://localhost:3000 in your browser.
5. Use the dashboard at http://localhost:3000/dashboard.

## Notes

- The app uses a local SQLite database file named data.db.
- Generated PDFs are stored temporarily in the temp folder and are deleted automatically after download.
- All report content is entered manually in the form; no AI API key is required.
