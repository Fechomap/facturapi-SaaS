# Heroku Deployment Guide

This guide provides instructions for deploying the Facturapi SaaS application to Heroku.

## Prerequisites

- Heroku CLI installed
- Git repository initialized and committed
- Heroku account with access to the application

## Environment Variables

Ensure the following environment variables are set in your Heroku application:

```
# Required Variables
DATABASE_URL                 # Automatically set by Heroku PostgreSQL add-on
NODE_ENV=production          # Set to production for Heroku
FACTURAPI_USER_KEY           # Your FacturAPI user key
TELEGRAM_BOT_TOKEN           # Your Telegram bot token
ADMIN_CHAT_IDS               # Comma-separated list of admin chat IDs
TELEGRAM_AUTHORIZED_USERS    # Authorized Telegram users

# Stripe Integration
STRIPE_SECRET_KEY            # Your Stripe secret key
STRIPE_PUBLISHABLE_KEY       # Your Stripe publishable key
STRIPE_WEBHOOK_SECRET        # Your Stripe webhook secret

# Optional Variables
MCP_SERVER_URL               # MCP server URL (if using MCP)
MCP_STRIPE_SERVER_NAME       # MCP Stripe server name
MCP_REQUEST_TIMEOUT          # MCP request timeout in milliseconds
```

You can set these variables using the Heroku CLI:

```bash
heroku config:set VARIABLE_NAME=value --app your-app-name
```

Or through the Heroku Dashboard under Settings > Config Vars.

## Database Setup

The application uses PostgreSQL. Add the PostgreSQL add-on to your Heroku app:

```bash
heroku addons:create heroku-postgresql:mini --app your-app-name
```

## Deployment

1. Log in to Heroku:

```bash
heroku login
```

2. Add the Heroku remote to your Git repository:

```bash
heroku git:remote -a your-app-name
```

3. Push your code to Heroku:

```bash
git push heroku main
```

## Troubleshooting Migration Issues

If you encounter migration issues during deployment, you have several options to resolve them:

### Option 1: Reset the Database (Recommended for Development/Staging)

The application includes scripts to completely reset the database and run migrations from scratch:

1. Use the provided shell script:

```bash
./reset-heroku-db.sh your-app-name
```

2. Or run the reset script directly on Heroku:

```bash
heroku run npm run reset-heroku-db --app your-app-name
```

This approach is recommended for development or staging environments where you can safely drop all data.

### Option 2: Manual Inspection and Fixes

If you need to preserve data or want to manually fix migration issues:

1. Use the Heroku PostgreSQL console to inspect the database:

```bash
heroku pg:psql --app your-app-name
```

2. Check the status of Prisma migrations:

```sql
SELECT * FROM _prisma_migrations ORDER BY started_at DESC;
```

3. If needed, manually mark problematic migrations as applied:

```sql
INSERT INTO _prisma_migrations (migration_name, started_at, applied, finished_at)
VALUES ('migration_name', NOW(), 1, NOW());
```

## Scaling

By default, Heroku will start one web dyno and one bot dyno as specified in the Procfile. You can scale these dynos as needed:

```bash
heroku ps:scale web=1 bot=1 --app your-app-name
```

## Logs

To view logs for debugging:

```bash
heroku logs --tail --app your-app-name
```

## Additional Resources

- [Heroku Node.js Support](https://devcenter.heroku.com/articles/nodejs-support)
- [Heroku PostgreSQL](https://devcenter.heroku.com/articles/heroku-postgresql)
- [Prisma with Heroku](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-heroku)
