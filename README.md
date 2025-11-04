# Telegram Accounting Bot (Arabic)

- Copy `.env.example` to `.env` and set `5438433720:AAFy4E825y9V8J0Sn_S9dXK_LuzPDY1Gkrw`.
- Install and run:

```bash
npm install
npm run dev
```

Features:
- Arabic guided flow to add transactions
- /customer <name>, /sum اليوم|الشهر, /export <name>
- SQLite persistence (data.db)

Deployment (Render/Railway):
- Build & run with Docker
- Set env var `BOT_TOKEN`
- Command:
  - Render Worker/Background: `node dist/index.js`
  - Heroku/Railway Procfile provided (worker)

Render quick start:
- Connect repo to Render
- Service type: Worker
- Build: `npm ci && npm run build`
- Start: `node dist/index.js`
- Env: add `BOT_TOKEN`

