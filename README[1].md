# Eazy Buy & Sell — Priority 1 backend

This package is a deployable Node.js/Express API starter backed by PostgreSQL and Prisma. It is not connected to a live Render service until you deploy it and configure the environment/database.

## Included

- PostgreSQL schema and migrations workflow for users, seller products, and delivery addresses.
- Registration/login with bcrypt password hashing and short-lived signed bearer tokens.
- Role checks for seller listing management.
- Product browsing/search/pagination and seller create/edit endpoints.
- Authenticated address endpoints.
- Request validation, Helmet security headers, rate limits, CORS configuration, safe production error responses, and a database health endpoint.
- Render Blueprint (`render.yaml`) to create a web service and PostgreSQL database.

## Deploy to Render

1. Upload this folder to a new private GitHub repository (do not upload a real `.env` file).
2. In Render, choose **New → Blueprint** and select that repository. Review the plan/cost before creating services. The Blueprint requests a paid web-service/database plan.
3. Render should create `eazybuysell-api` and `eazybuysell-db`, inject `DATABASE_URL`, generate `JWT_SECRET`, and run `prisma migrate deploy` before starting.
4. After deployment, open `https://YOUR-API.onrender.com/health`. It should return `{"status":"ok","database":"connected","service":"eazybuysell-api"}`.
5. Set `CORS_ORIGIN` to the exact HTTPS frontend origin(s), comma-separated. Do not leave `*` for a production browser frontend. Mobile clients can call the HTTPS API directly.
6. Save the API URL and connect the website/mobile app to it. The current HTML prototype must be updated to call the API; that integration is not performed by this backend package alone.

## Local setup

Requirements: Node.js 20+, PostgreSQL.

```bash
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET in .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## Endpoints

- `GET /health` — API and database health check
- `POST /api/auth/register` — JSON: `{ "name":"Test User", "email":"test@example.com", "password":"at-least-10-characters", "country":"LS", "role":"BUYER" }`
- `POST /api/auth/login` — JSON: `{ "email":"test@example.com", "password":"..." }`
- `GET /api/auth/me` — `Authorization: Bearer <token>`
- `GET /api/products?search=chair&country=LS&page=1&limit=20`
- `POST /api/products` — bearer token for a `SELLER` account; fields `title`, `category`, `price`, optionally `description`, `currency`, `stock`, `country`, `imageUrls`
- `PATCH /api/products/:id` — seller who owns the listing or admin
- `GET /api/addresses` — signed-in user
- `POST /api/addresses` — signed-in user
- `DELETE /api/addresses/:id` — owner of address

## Important production notes

- The public registration endpoint permits BUYER or SELLER, never ADMIN. Create/administer admin accounts through a controlled, audited process rather than a public registration field.
- Use HTTPS and keep secrets only in Render environment settings. Do not share credentials in chat.
- Product image URLs are stored, but file upload/object storage is a separate task.
- This is the backend foundation for Priority 1. It does not implement payments, seller payouts, delivery integrations, KYC, or connect the existing HTML/mobile UI automatically.
- Before handling real customer data, test migrations, backups/restore, authorization, and rate limits in staging.
