# LocalPMS: Self Storage Property Management

An all-in-one web application for running self-storage facilities. It covers tenants and billing, past-due and lien processing through auction, site map, leads, retail, daily close, rate management, reminders, district-manager audits, reporting and role-based permissions.

This build is meant for **demonstration**. It ships with realistic demo data for three facilities. Payments, email, text messages and the gate system run in a simulated **demo mode** until real credentials are added (see [Going live](#going-live)).

---

## Quick start

### Easiest way (Windows)
1. Install **Node.js LTS** (version 22.13 or newer) from https://nodejs.org. Accept all the defaults.
2. Download this project: on GitHub click **Code → Download ZIP**, then unzip it. If you use Git, run `git clone` instead.
3. Double-click **`Start LocalPMS.bat`** in the project folder.
   - The first run installs everything automatically, which takes about a minute.
   - Your browser then opens to the app. If it doesn't, go to **http://localhost:3001**.
4. Leave the black window open while you use the app. Close it to stop.

On a Mac, double-click **`Start LocalPMS.command`** instead. If macOS blocks it, right-click it and choose **Open**.

### From a terminal (any OS)
```bash
npm install
npm start
```
Then open **http://localhost:3001**.

### Signing in
All demo accounts use the password `demo123`, and the login screen has one-click buttons for each role:

| Role | Email | Sees |
|---|---|---|
| Admin | admin@demo.com | Everything, all facilities |
| District Manager | dm@demo.com | All facilities, performs audits |
| Area Manager | am@demo.com | Riverside + Oak Hill |
| Property Manager | pm@demo.com / pm2@ / pm3@ | One facility each |
| Assistant Manager | asst@demo.com | Front-desk functions, Riverside |

The first launch creates the database (`data/storage.db`) and generates demo data dated around the day you first run it. To start over, use **Settings → Integrations & System → Reset Demo**, or run `npm run seed`.

### Troubleshooting
| Problem | Fix |
|---|---|
| "LocalPMS needs Node.js 22.13 or newer" or `bad option: --disable-warning` | Install the current LTS from https://nodejs.org and try again |
| "Port 3001 is already in use" | Another copy is already running. Close it, or start on another port: `set PORT=3002 && npm start` (Windows) or `PORT=3002 npm start` (Mac) |
| `'npm' is not recognized` | Restart your PC after installing Node.js so the PATH updates |
| Data looks wrong / want a fresh demo | Settings → Integrations & System → Reset Demo, or `npm run seed` |

**Development mode** (hot reload): `npm run dev`, then open http://localhost:5173.

**Automated tests:** `npm test` runs 36 engine and API tests on a throwaway database. They cover billing math, the lien cycle, permissions, facility isolation and every workflow.

---|---|---|
| Admin | admin@demo.com | Everything, all facilities |
| District Manager | dm@demo.com | All facilities, performs audits |
| Area Manager | am@demo.com | Riverside + Oak Hill |
| Property Manager | pm@demo.com / pm2@ / pm3@ | One facility each |
| Assistant Manager | asst@demo.com | Front-desk functions, Riverside |

The first launch creates the database (`data/storage.db`) and generates the demo data. To start over, use **Settings → Integrations & System → Reset Demo**, or run `npm run seed`.

**Development mode** (hot reload): `npm run dev`, then open http://localhost:5173.

---

## Features

**Dashboard.** Unit, square-foot and economic occupancy; vacant units; past-due dollars and aging; move-ins and move-outs (today and month to date); open leads and reservations; 12-month occupancy and move-activity charts; today's reminders; largest past-due balances; upcoming auctions; and this month's audit status. Choosing **All Facilities** turns it into a portfolio rollup with a row per facility.

**Tenants and tenant accounts.** Searchable and filterable tenant list (past due, credit balance, autopay, no protection, gate denied). The tenant account page has:
- Ledger with running balance, payments (cash, check, card, ACH, money order), charges and credits, voids and refunds
- Units, with protection plan, promotion, next due date, overlock and lien hold
- Lien progress tracker with a button to complete the next step
- Gate code management, notes and history timeline, communications, lien history, purchases
- Edit info, log a call, send a message, move out
- **Account notes:** a note box at the top of every account for jotting down what a conversation was about. After saving, the author has **30 seconds to Undo**, which removes the note and puts its text back in the box for editing. After that the note is permanent. Undos are recorded in the Activity Log.
- **"Leave without a note?" reminder:** when switched on for a facility, anyone leaving a tenant's account without adding a note (or logging a call) during that visit is asked *"Are you sure you wish to leave the tenant's account without making a note?"* (Yes / No). Higher-ups switch it on or off in **Settings → Facility → Account note reminder**, per facility or for all of their facilities at once. It's controlled by the *Turn the "leave account without a note" reminder on/off* permission, which Admin, District Manager and Area Manager have by default. It is on in the demo data.

**Guided move-in.** Five steps: choose unit, tenant (new or existing), terms (rent, promotion, protection plan, gate code), lease (agreement and on-screen signature), then payment. Proration follows facility billing settings. It automatically creates the gate code, sends a welcome email and converts the lead.

**Move-out.** Vacate inspection checklist, cleaning fee, option to waive the balance, option to mark the unit unrentable. The gate code is removed automatically.

**Units and site map.** Interactive, color-coded map: current, past due 1–29 days, past due 30+ days, vacant, reserved, unrentable, and overlocked. Supports zoom and highlighting by unit type. Clicking a unit opens a side panel with tenant, balance and actions (move in, overlock, rate, unrentable).

**Walkthrough / lock check.** Printable list of every unit with tenant (blank if vacant), balance, past-due status, lien stage and overlock status. Units that need an overlock, or need one removed, are flagged.

**Gate access.** Every tenant gets a code. Access is denied automatically at *X* days past due (set per facility) and restored automatically when the tenant pays. Includes per-tenant overrides (always allow / always deny), a gate activity log, a keypad simulator and sync to the gate system.

**Past dues and auctions:**
- A configurable lien schedule per facility. The default is reminder → late notice → overlock → pre-lien → certified lien notice → advertise → auction.
- Late fees can be flat or a percentage.
- Automatic (nightly) or manual mode.
- Bulk messaging to past-due tenants.
- A lien-process board.
- Auction scheduling and sale recording: proceeds are applied, the remainder is written off, surplus is tracked and the unit is vacated. A scheduled auction is cancelled automatically if the tenant pays in full.

**Leads and reservations.** Pipeline board (New → Contacted → Reserved → Moved In / Lost). Each lead tracks source, size and type wanted, and follow-up dates. You can reserve a unit (with an expiration), send emails and texts, log calls, and convert a lead straight into a move-in.

**Communications.** Email, SMS and printed letters, with merge-field templates. You can mass-message all tenants, past-due tenants, tenants past due by a given number of days, tenants not on autopay, or specific tenants. Every message is logged, and letters print in batches on facility letterhead.

**Merchandise.** Point of sale that works with or without a tenant attached, including "charge to tenant account". Prints receipts and keeps sales history. Inventory tracks stock levels, reorder alerts, receiving, shrink, physical counts and an adjustment log.

**Daily close.** Payments broken out by method, a cash and check count with variance, deposit reference, transaction list and close history.

**Rate management:**
- Street rates by unit type and size, with occupancy-based suggestions.
- Rent increases for existing customers: a candidate finder (tenure, gap below street rate, current on payments), bulk scheduling with notice letters, and automatic application on the effective date.
- Promotions.

**Reminders.** Assigned to-dos with due dates and priority, plus automatic reminders: lead follow-ups, expiring reservations, auctions, rent increases, reorder alerts, unfinished daily closes, and overlocks to place or remove.

**Property audits.** The district or area manager checks off each facility's monthly visit and scores a 0–5 checklist (editable per facility). They can add item notes, a summary note for the property manager, photos, and follow-up reminders assigned to staff. The property manager responds and acknowledges. Score trends are charted and the portfolio view shows visit status.

**Reports** (CSV export and print/PDF for all):
- Management: rent roll, occupancy summary, move-in/move-out activity, vacant units, protection-plan enrollment, rent increases, audit scores, tenant contact list
- Collections: A/R aging, lien history, auction history, gate-denied list
- Accounting: payments, revenue by category, credits and write-offs, daily close history
- Sales and retail: lead source and conversion, merchandise sales, inventory valuation
- Admin: activity log

**Activity log.** Records every login, payment, change, lien step and setting change, with user and time stamp.

**Settings:**
- Facility info and billing (anniversary or 1st-of-month, proration, tax, admin fee, deposit)
- Gate lockout days
- Late fees and the lien schedule editor
- Protection plans and the audit checklist
- Users, with facility access
- **Roles and permissions matrix** (32 permissions × 5 roles, all editable)
- Integrations and system tools

**Global search** (Ctrl+K) finds a tenant by name, unit, phone, email or gate code, and also searches units and leads.

---

## Going live

Every outside service sits behind an adapter in `server/services/integrations.js`, and each one switches from demo mode to live as soon as its keys exist:

1. Copy `.env.example` to `.env`.
2. Fill in the services you want:
   - **Stripe**: card payments at move-in, on accounts, at the POS and for autopay. The card form switches to Stripe Elements automatically.
   - **SendGrid**: email.
   - **Twilio**: SMS.
   - **Gate webhook**: pushes code create, delete, suspend and restore events to your gate controller or vendor API.
3. Restart the server. Check **Settings → Integrations & System**, where each service shows **Connected** and has a **Send Test** button.

To use a different vendor (Postmark, Authorize.net, a specific gate brand, a certified-mail API, and so on), edit only the matching function in `server/services/integrations.js`.

### Production checklist
- Host it on any Node 22.13+ server or platform. It's one process that serves both the API and the web app; run `npm start` with `PORT` set.
- Put it behind HTTPS (for example a reverse proxy or the platform's TLS).
- Back up the `data/` folder (SQLite database plus uploaded audit photos). For many facilities or heavy concurrent use, the data layer in `server/db.js` can be moved to Postgres.
- Set `HIDE_DEMO_ACCOUNTS=1` in `.env` so the login screen no longer lists accounts, and replace the demo users and passwords. Use **Settings → Users**, or reset the demo and then deactivate the demo accounts.
- Review the default lien schedule, notice templates and fees against your state's self-storage lien law.
- The nightly process runs automatically while the server is up: it posts rent, applies late fees, advances lien steps, applies rent increases, runs autopay, expires reservations and syncs the gate. It catches up on start-up and can also be run on demand from Settings.

---

## Project layout

```
server/
  index.js                 Express app + nightly scheduler
  db.js                    SQLite schema & helpers (node:sqlite)
  core.js                  Billing, balances (FIFO), lien engine, messaging
  seed.js                  Demo data generator
  services/integrations.js Stripe / SendGrid / Twilio / gate adapters
  routes/                  REST API (tenants, units, collections, leads, comms, retail, rates, tasks, audits, reports, settings)
client/src/
  pages/                   One file per screen
  components/              Layout, tables, modals, payment, compose, signature pad
```
