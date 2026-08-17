# Swift Deliver Server

Backend API for **Swift Deliver** — a parcel/courier delivery platform where users book parcel deliveries, admin assigns delivery riders, riders update delivery status, and payments are handled with Stripe.

This server is built with **Node.js + Express** and is **serverless-friendly** — it runs locally for development and can be deployed to **Vercel** or **Render** without changes.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [How It Works (Roles)](#how-it-works-roles)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Install Dependencies](#1-install-dependencies)
  - [2. Create Your Environment File](#2-create-your-environment-file)
  - [3. Run the Server](#3-run-the-server)
- [Database Collections](#database-collections)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
  - [Riders](#riders)
  - [Users](#users)
  - [Parcels](#parcels)
  - [Payments](#payments)
  - [Admin Stats](#admin-stats)
- [Deployment](#deployment)
  - [Deploy on Vercel](#deploy-on-vercel)
  - [Deploy on Render](#deploy-on-render)
- [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Runtime    | Node.js (CommonJS)                              |
| Framework  | Express 5                                       |
| Database   | MongoDB Atlas (official `mongodb` driver)       |
| Auth       | Firebase Admin SDK (JWT token verification)     |
| Payments   | Stripe Checkout Sessions                        |
| Middleware | `cors`, `dotenv`                                |

---

## Features

- **User Management** — users are stored in the `users` collection; any user can be promoted to `admin` or `rider`.
- **Rider Applications** — users apply as riders; admins approve or reject them.
- **Parcel Booking** — authenticated users create, view, update, and delete parcels.
- **Rider Assignment** — admins assign an approved rider to each paid parcel.
- **Delivery Tracking** — riders update parcel status: `picked_up` → `in_transit` → `delivered`.
- **Stripe Payments** — checkout sessions generate a payment link; payment success generates a tracking number.
- **Admin Dashboard Stats** — total users, riders, parcels, revenue, rider payouts (30%), and net profit.
- **Role-Based Access Control** — routes are protected with `verifyFBToken` plus `verifyAdmin` / `verifyRider`.

---

## How It Works (Roles)

There are three roles stored on the user document:

| Role    | Can do                                                                 |
| ------- | ---------------------------------------------------------------------- |
| `user`  | Create/view/update/delete own parcels, pay with Stripe, apply as rider  |
| `rider` | View assigned parcels, update delivery status                          |
| `admin` | View all users/riders, approve/reject riders, assign riders, view stats |

> Role is stored in the `users` collection under `role`. Users start as `user` (or without a role) and can be promoted to `admin` or `rider`.

---

## Project Structure

```
swift-deliver-server/
├── index.js                  # Main Express server (all routes live here)
├── serviceKeyConveter.js     # Helper: converts Firebase JSON key → Base64 for env vars
├── check_db.js               # Empty utility file (for DB testing)
├── package.json
├── .env                      # Your secrets (NOT committed)
└── .env.example              # Template for the environment variables
```

---

## Getting Started

### Prerequisites

Before you start, you need:

1. **Node.js** (v18 or newer) — [download here](https://nodejs.org/)
2. **A MongoDB Atlas cluster** — [create a free one](https://www.mongodb.com/cloud/atlas/register)
3. **A Firebase project** — [console.firebase.google.com](https://console.firebase.google.com/)
4. **A Stripe account** — [dashboard.stripe.com](https://dashboard.stripe.com/register) (test mode is fine)

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Your Environment File

Copy the template and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and add your real credentials:

| Variable                 | Description                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `PORT`                   | Local port (default `3000`)                                          |
| `DB_USER`                | Your MongoDB Atlas database user                                     |
| `DB_PASS`                | Your MongoDB Atlas database password                                 |
| `STRIPE_SECRET_KEY`      | Your Stripe secret key (`sk_test_...` for test mode)                 |
| `CLIENT_URL`             | URL of the frontend app (for payment redirects)                      |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account (JSON **or** Base64 string)     |

**Getting the `FIREBASE_SERVICE_ACCOUNT`:**

1. Go to your Firebase project → **Project settings** → **Service accounts**.
2. Click **Generate new private key** and download the JSON file.
3. The server accepts either:
   - The **raw JSON** content (paste it directly as the value), or
   - A **Base64-encoded** version of the JSON.

   To get the Base64 version, place the downloaded JSON file in the project root and run:

   ```bash
   node serviceKeyConveter.js
   ```

   It prints a Base64 string you can copy into your `.env`.

### 3. Run the Server

```bash
npm run dev     # with auto-restart (nodemon)
# or
npm start       # plain node
```

You should see:

```
Connected to MongoDB!
Zap Shift Server is running on port 3000
```

Test it in your browser: <http://localhost:3000>

> If Stripe or Firebase isn't configured, the server still starts but logs a warning and the related routes return a `500` error.

---

## Database Collections

All data lives in the `swift_deliver_db` database.

| Collection | Purpose                                        | Key fields                                  |
| ---------- | ---------------------------------------------- | ------------------------------------------- |
| `users`    | Every app user                                 | `email`, `role` (`user`/`rider`/`admin`)    |
| `riders`   | Rider applications                             | `email`, `status` (`pending`/`approved`/`rejected`) |
| `parcels`  | Delivery bookings                              | `email`, `status` (`paid`/`pending`), `deliveryStatus`, `tracking_no`, `deliveryCost`, `riderEmail` |

---

## Authentication

Protected endpoints require a Firebase ID token in the `Authorization` header:

```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

The token is verified by the `verifyFBToken` middleware using the Firebase Admin SDK.

---

## API Endpoints

Base URL (local): `http://localhost:3000`

### Riders

| Method | Endpoint                     | Auth        | Description                          |
| ------ | ---------------------------- | ----------- | ------------------------------------ |
| GET    | `/riders`                    | Admin       | Get all rider applications           |
| POST   | `/rider`                     | Logged in   | Submit a rider application           |
| PATCH  | `/rider/:id/approve`         | Admin       | Approve a rider (body: `{ email }`)  |
| PATCH  | `/rider/:id/reject`          | Admin       | Reject a rider (body: `{ email }`)   |

### Users

| Method | Endpoint                    | Auth      | Description                              |
| ------ | --------------------------- | --------- | ---------------------------------------- |
| POST   | `/users`                    | Public    | Create a user                            |
| GET    | `/users`                    | Admin     | Get all users                            |
| GET    | `/users/admin/:email`       | Logged in | Check if a user is admin → `{ isAdmin }` |
| GET    | `/users/rider/:email`       | Logged in | Check if a user is rider → `{ isRider }` |
| PATCH  | `/users/admin/:email`       | Admin     | Promote a user to admin                 |
| GET    | `/users/:email`             | Logged in | Get a single user by email               |

### Parcels

| Method | Endpoint                          | Auth      | Description                                              |
| ------ | --------------------------------- | --------- | -------------------------------------------------------- |
| GET    | `/parcels?email=`                 | Logged in | Get all parcels (optionally filtered by `email`)        |
| POST   | `/parcels`                        | Logged in | Create a parcel                                          |
| GET    | `/parcels/rider/:email`           | Logged in | Get parcels assigned to a rider                          |
| GET    | `/parcels/:id`                    | Logged in | Get a single parcel by id                                |
| PATCH  | `/parcels/:id`                    | Logged in | Update a parcel (**blocked** once `status` is `paid`)    |
| DELETE | `/parcels/:id`                    | Logged in | Delete a parcel                                          |
| PATCH  | `/parcels/:id/assign-rider`       | Admin     | Assign a rider (body: `{ riderId, riderEmail, riderName }`) |
| PATCH  | `/parcels/:id/delivery-status`    | Rider     | Update status: `picked_up` / `in_transit` / `delivered`  |

### Payments

| Method | Endpoint                          | Auth      | Description                                             |
| ------ | --------------------------------- | --------- | ------------------------------------------------------- |
| POST   | `/create-checkout-session`        | Logged in | Create a Stripe checkout session → `{ url }`            |
| PATCH  | `/payment-success?session_id=`    | Public    | Stripe callback; marks parcel `paid` + creates tracking no. |

### Admin Stats

| Method | Endpoint       | Auth  | Description                                             |
| ------ | -------------- | ----- | ------------------------------------------------------- |
| GET    | `/admin-stats` | Admin | Dashboard stats (users, riders, parcels, revenue, profit) |

**Admin stats response:**

```json
{
  "totalUsers": 10,
  "totalRiders": 3,
  "totalParcels": 25,
  "deliveredParcels": 8,
  "pendingParcels": 5,
  "totalRevenue": 1200,
  "totalRiderPayouts": 360,
  "adminNetProfit": 840
}
```

> Riders receive **30%** of the delivery cost as payout (`totalRiderPayouts`); `adminNetProfit = totalRevenue - totalRiderPayouts`.

---

## Deployment

The server is serverless-safe: it skips `app.listen()` when running on Vercel (`process.env.VERCEL`) and exports the Express app via `module.exports`.

### Deploy on Vercel

1. Push the repository to GitHub and import it into Vercel.
2. Framework preset: **Other**. Build command: **none**. Output: **Node.js**.
3. Add **all** environment variables from `.env` to the Vercel project settings.
4. Deploy. Set `CLIENT_URL` to your frontend URL.

> Optionally add a `vercel.json`:

```json
{
  "version": 2,
  "builds": [{ "src": "index.js", "use": "@vercel/node" }]
}
```

### Deploy on Render

1. Create a new **Web Service** and connect your repo.
2. Build command: `npm install`. Start command: `node index.js`.
3. Add all environment variables from `.env`.
4. Deploy.

---

## Troubleshooting

| Problem                                   | Solution                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `DB connection error`                     | Check `DB_USER` / `DB_PASS`, and that your Atlas IP allowlist includes your IP. |
| `FIREBASE_SERVICE_ACCOUNT env variable is not set` | Add the Firebase service account JSON (or Base64) to your env. |
| `Stripe is not configured`                | Add a valid `STRIPE_SECRET_KEY`.                                  |
| `CORS blocked: <origin>`                  | Add your frontend origin to `allowedOrigins` in `index.js`.       |
| `Unauthorized access` on every request    | Send `Authorization: Bearer <Firebase ID token>` header.          |
| `Cannot update a paid parcel`             | Parcels become read-only after payment — this is intentional.     |
