# Gonest International Appointment Scheduler

A Gonest International-branded appointment scheduling application with admin slot management, multi-user booking, fixed daily service times, and fast auto-booking.

## Features

- Gonest International client portal and admin panel
- Admin slot creation, editing, filtering, and deletion
- One fixed time slot per service per day
- Capacity-based booking: multiple users can book the same slot until capacity is reached
- Atomic booking protection to prevent overbooking
- Client booking with traveler, nationality, and passport details
- Automatic slot booking with service and time preferences
- Auto-book monitor target: under 1 second
- JWT authentication with database-backed role checks
- SQLite persistence and automatic database migrations/seeding

## Requirements

- Node.js **22.5 or newer** (the app uses the built-in `node:sqlite` module)
- npm
- Windows, macOS, or Linux

## Setup

From the project directory:

```bash
npm install
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Open `.env` and set:

```dotenv
JWT_SECRET=your-generated-secret
ADMIN_EMAIL=admin@gonest.com
ADMIN_PASSWORD=choose-a-strong-admin-password
PORT=3000
AUTO_BOOK_INTERVAL_MS=100
```

Never commit `.env`. It contains secrets and is ignored by Git.

## Run the application

```bash
npm start
```

Open:

- Client login: `http://localhost:3000/`
- Client dashboard: `http://localhost:3000/dashboard.html`
- Admin panel: `http://localhost:3000/admin.html`
- Health check: `http://localhost:3000/api/health`

For development, `npm run dev` starts the same server.

## Default account

The database creates an administrator on first startup using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

The existing local database may still contain an older administrator account. If using an existing database, sign in with the credentials already configured there or create/update an administrator through a controlled database migration.

Demo users are created only when the database is empty:

- `john@example.com` / `user123`
- `sarah@example.com` / `user123`

Do not use demo credentials in production.

## Fixed service schedule

Each standard service has one fixed daily time:

| Service | Time |
|---|---|
| Business Consultation | 09:00–10:00 |
| Visa Processing Help | 10:00–10:30 |
| Immigration Advisory | 11:00–11:45 |
| Document Verification | 13:00–13:20 |
| Passport Services | 14:00–14:30 |

The database enforces one slot per `service_name + date`. Admins can create additional services, but each service still has only one slot per day. Set the capacity when creating the slot; for example, a capacity of 8 allows eight users to book that slot.
## Admin workflow

1. Sign in with the administrator account.
2. Open the **Manage Slots** tab.
3. Click **Add New Slot**.
4. Select the service, date, fixed time, and capacity.
5. Save the slot.
6. Use **Manage Bookings** to mark appointments completed, no-show, or cancelled.
7. Use **Users** to manage roles and accounts.

A slot cannot be deleted when it has appointment history. The API returns HTTP 409 for this case.

## Booking rules

- Different users may book the same slot up to its capacity.
- The same user cannot create a second confirmed booking for the same slot.
- The same client email cannot create a second confirmed booking for the same slot.
- Once capacity is reached, the slot becomes `booked` and further requests receive HTTP 409.
- Booking writes are transactional and use a SQLite busy timeout for concurrent requests.

## Auto-booking

Users can enable auto-booking and optionally select preferred services and time ranges. The monitor:

- Runs every 100ms by default
- Is triggered immediately when an admin creates or updates a slot
- Only considers today and future slots
- Reports its target as 1000ms via `/api/auto-book/status`

Change the interval with `AUTO_BOOK_INTERVAL_MS`. Values below 50ms are clamped to 50ms.

## Tests

Test scripts (test-db.js, test-speed.js) were removed from the repository to keep the production bundle clean. If you need to re-add them, recreate them under a tests/ folder and wire them into CI rather than committing them to the app root.

## Production deployment

1. Copy .env.example to .env on the server and fill in real values:
   - NODE_ENV=production
   - A long random JWT_SECRET (node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
   - A strong ADMIN_PASSWORD (never admin123)
   - CORS_ORIGIN set to your frontend domain(s)
   - TRUST_PROXY=true if behind nginx/Cloudflare
   - SEED_DEMO_DATA=false (demo users must not be seeded in production)

2. Install dependencies: npm install --omit=dev

3. Run with a process manager (recommended PM2):
   ```bash
   npm install -g pm2
   pm2 start server.js --name gonest-scheduler
   pm2 save
   ```

4. Put the app behind HTTPS + a reverse proxy (nginx/Cloudflare) and enable TRUST_PROXY=true.
5. Back up gonest.db regularly (SQLite file). The app recreates the schema on startup but existing data lives in the DB file.
6. Run as a restricted OS user, not root/administrator.
7. .env, node_modules/, gonest.db*, and *.log are gitignored — never commit them.

## API overview

All protected endpoints require:

```http
Authorization: Bearer <jwt-token>
```

Important endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/slots`
- `GET /api/slots/services/list`
- `POST /api/slots` — admin only
- `PUT /api/slots/:id` — admin only
- `DELETE /api/slots/:id` — admin only
- `POST /api/appointments`
- `GET /api/appointments`
- `GET /api/admin/stats` — admin only
- `GET /api/admin/users` — admin only
- `GET /api/admin/slots` — admin only
- `GET /api/admin/appointments` — admin only
- `GET /api/admin/settings` — admin only
- `GET /api/auto-book/status`

## Database

The default database is `gonest.db` in the project root. This filename is retained for compatibility with the existing database.

The application automatically creates and migrates the required tables on startup. To use a different database file, set `DB_PATH` in `.env`.

Back up the database before production deployments:

```bash
Copy-Item gonest.db gonest.db.backup
```

## Production security

- Set a long random `JWT_SECRET`.
- Change `ADMIN_PASSWORD` before deployment.
- Remove or disable demo credentials.
- Put the application behind HTTPS and a reverse proxy.
- Restrict CORS/network access as appropriate.
- Back up the SQLite database regularly.
- Do not expose `.env` or the database file publicly.
- Run the server as a restricted OS user.

## Troubleshooting

### `JWT_SECRET must be configured`

Set `JWT_SECRET` in `.env` to a random value of at least 32 characters.

### `SQLITE_CONSTRAINT` or duplicate service/date

A slot already exists for that service and date. Edit the existing slot instead of creating another one.

### `database is locked`

Ensure only the intended application process is writing the database. The app uses a 5-second busy timeout; avoid running multiple independent writers against the same SQLite file.

### Booking returns HTTP 409

The slot is full, already booked by the same user/email, or the slot no longer exists. Refresh the available slots before retrying.
