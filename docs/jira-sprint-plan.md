# FieldServe: Jira sprint plan (draft for review)

Nothing has been created in Jira. This is the proposal to approve or change first.

## How this was built, and what is NOT known

Evidence used: 10 git commits (4 to 16 Nov 2026), 17 database migrations, 74 API routes, 26 dashboard/print/field pages, 17 modules, 24 test files (about 173 tests), the README and this working session.

Things I could not know, so they are marked and need your decision:

1. **Developer split.** All 10 commits are by one author, `KazimRazaC9` (kazim.raza@core9.ai). There is no trace of Talha's commits, so every development task is assigned to **Kazim**. If Talha did part of it, tell me which tasks and I will move them.
2. **QA by M. Sami.** The repo only shows automated tests (written together with the code). There is no record of manual QA, test cases or bug reports. QA tasks are assigned to **M. Sami** as you asked, but they are **proposed, status To Do**, never marked Done.
3. **Story points** are my proposal on a 1, 2, 3, 5, 8 scale from the size of the change (files, migrations, endpoints, tests). They are not recorded estimates, so please adjust them.
4. **Dates.** I did not invent sprint dates. Each sprint shows the real commit date(s) its work landed in. Set the actual start and end dates in Jira.
5. **Phase numbers** in test file names (phase6 to phase13) and in the commit message "phase 9" do not match the project plan phases. This plan uses the project plan numbering (Phase 0 to 9) from your Agile plan.

Status rule: development work that is in the code is proposed as **Done**. QA tasks, and anything not verified, are **To Do**.

---

## Sprint 1: Foundation, Auth, Company, Customers, Work Orders (Phases 0 to 3)

Landed in: `9c06796` (4 Nov), `0f8e37b` (5 Nov). Migrations: `init`, `rls`, `work_order_timeline`, `request_ticket_fields`.

**S1-01 · Project scaffold and tooling** · Task · 3 pts · Kazim · Done
Create Next App with TypeScript, Tailwind 4, shadcn/ui, ESLint, Prettier, Vitest, pnpm 9.
AC: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all run from a clean checkout.

**S1-02 · Database schema and multi-tenant security** · Story · 8 pts · Kazim · Done
Prisma schema, `init` and `rls` migrations, tenant-scoped Prisma client (`db-scope`), soft delete, audit log, PostgreSQL row-level security with non-owner role `fieldserve_app`, owner role only for migrations and seed.
AC: a user of company A never reads or writes company B rows (app and database level); deletes become soft deletes; every write is audited; with no company set, tenant tables return nothing.

**S1-03 · Authentication, sessions and bearer tokens** · Story · 8 pts · Kazim · Done
Auth.js credentials sign-in (JWT session), `/api/v1/auth/token`, `refresh`, `logout`, `me`, `change-password`, rate limit, refresh-token reuse detection.
AC: login works with correct credentials and fails with wrong ones; access token expires in 15 min and refresh in 14 days; reusing a refresh token is rejected; password change works.

**S1-04 · App shell and role-based navigation** · Story · 5 pts · Kazim · Done
Dashboard layout, sidebar, user menu, middleware route guard, `nav.ts` and `permissions.ts` shared by menu and API.
AC: each role sees only its menu items; opening a forbidden URL redirects; menu and route guard cannot disagree.

**S1-05 · Company and team management** · Story · 8 pts · Kazim · Done
Company settings (time zone, currency, tax, logo link), Super Admin company management, users (create, edit, activate or deactivate, reset password), technician profiles.
APIs: `companies`, `company/settings`, `users`, `users/[id]/status`, `reset-password`, `technician-profile`.
AC: Super Admin creates a company with its first Admin; Admin manages users and technicians in their own company; the last active Admin cannot be removed; emails are unique per company.

**S1-06 · Customers, sites and assets** · Story · 8 pts · Kazim · Done
Customers with service addresses and history, assets with warranty and service history.
APIs: `customers`, `customers/[id]/addresses`, `history`, `assets`, `assets/[id]/history`.
AC: create, edit, search and soft-delete customers and sites; an asset belongs to a customer and site and shows its work history.

**S1-07 · Service catalog and checklist templates** · Story · 5 pts · Kazim · Done
Service items and parts (price, tax, stock, status) and checklist templates.
APIs: `service-items` (status, stock), `checklist-templates`.
AC: items can be created, priced, activated or deactivated and stock adjusted; templates can be created and reused on work orders.

**S1-08 · Service requests** · Story · 5 pts · Kazim · Done
Requests with SR numbers, cancel, convert to work order (`request_ticket_fields` migration).
AC: a request converts to exactly one work order with its details; a cancelled request cannot be converted.

**S1-09 · Work orders and status state machine** · Story · 8 pts · Kazim · Done
Work orders with WO numbers, one status state machine with timeline (`work_order_timeline`), lines, notes, checklist items, attachments.
APIs: `work-orders` (+ `status`, `lines`, `notes`, `checklist`, `attachments`).
AC: only allowed status transitions succeed; every change is on the timeline with who and when; lines, notes and checklist items work; files are only visible inside the same company.

**S1-10 · Automated tests for Phases 0 to 3** · Task · 5 pts · Kazim · Done
Unit: `db-scope`, `money-tz`, `work-order-status`. Integration: `tenant-isolation`, `auth-tokens`, `phase1-team`, `phase2-customers`, `phase3-work-orders`.
AC: all of these pass against the dev database and clean up what they create.

**S1-Q1 · Functional test cases and execution: Phases 0 to 3** · QA · 5 pts · M. Sami · To Do
Write and run test cases for sign-in, users, company settings, customers, assets, catalog, requests and work orders.
AC: documented cases per feature with pass or fail; every failure logged as a bug with steps.

**S1-Q2 · API testing: auth, users, customers, work orders** · QA · 3 pts · M. Sami · To Do
Test the endpoints above for success, validation errors, roles and cross-company access.
AC: each endpoint checked for 200, 400, 401, 403 and 404; no cross-company data returned.

---

## Sprint 2: Scheduling, Technician PWA, Estimates and Invoices (Phases 4 to 6)

Landed in: `d75a4f8` (10 Nov, commit message "PHASE 3 4 5", it also contains Phase 6).

**S2-01 · Appointments and double-booking protection** · Story · 5 pts · Kazim · Done
Scheduling module, `work-orders/[id]/schedule`; a technician cannot hold overlapping visits; visit status follows the work order.
AC: overlapping appointments are refused with a clear message; rescheduling and cancelling update the work order status.

**S2-02 · Dispatch board with drag and drop** · Story · 8 pts · Kazim · Done
`/dispatch` page and `dispatch/board` API: day and week view per technician, drag to schedule.
AC: dragging a job onto a technician slot creates or moves the appointment; conflicts are refused; unscheduled jobs are listed.

**S2-03 · Technician mobile app (PWA) shell** · Story · 5 pts · Kazim · Done
Web manifest, icons, service worker, offline page, `(tech)` layout, `my-jobs` list.
AC: the app installs on a phone; the offline page shows without network; a technician sees only their own jobs.

**S2-04 · Technician job flow** · Story · 8 pts · Kazim · Done
Check-in and check-out with GPS, status transitions, checklist, customer signature, time sheets.
APIs: `field/jobs`, `field/jobs/[id]`, `transition`, `attachments`.
AC: transitions follow the work order state machine; time is recorded on check-in and out; a technician cannot open another technician's job.

**S2-05 · Live location and live map** · Story · 5 pts · Kazim · Done
`field/location` (technician sends location), `field/live`, `/live-map` page with map component.
AC: dispatchers see current technician positions; location points are stored per company.

**S2-06 · Estimates with approval** · Story · 8 pts · Kazim · Done
Estimates with lines, status, approval, convert to work order, printable page.
APIs: `estimates`, `lines`, `status`, `convert`; print route.
AC: totals are recalculated on the server from lines; an approved estimate converts to a work order once; the print page shows the company and totals.

**S2-07 · Invoices and payments** · Story · 8 pts · Kazim · Done
Invoice from a completed work order (one live invoice per work order), lines, issue, void, partial payments, summary, overdue derived from due date, printable page.
APIs: `invoices` (`issue`, `void`, `lines`, `payments`, `summary`), `work-orders/[id]/invoice`.
AC: money uses exact decimals; balance equals total minus payments; partial payments move status to partially paid then paid; a voided invoice takes no payments.

**S2-08 · Demo data for the new modules** · Task · 2 pts · Kazim · Done
Seed data for scheduling, field and billing screens (`prisma/seed.ts`).
AC: `pnpm db:seed` on an empty database gives a usable demo.

**S2-09 · Automated tests for Phases 4 to 6** · Task · 3 pts · Kazim · Done
Integration: `phase4-scheduling`, `phase5-field`, `phase6-billing`.
AC: pass, including double-booking, field transitions and invoice and payment arithmetic.

**S2-Q1 · Functional and regression testing: dispatch, PWA, billing** · QA · 5 pts · M. Sami · To Do
Dispatch drag and drop, PWA install and offline on a real phone, check-in with GPS, estimate to work order, invoice and payment amounts; re-run Sprint 1 smoke.
AC: cases executed and recorded; defects logged and retested.

**S2-Q2 · API testing: scheduling, field, estimates, invoices** · QA · 3 pts · M. Sami · To Do
AC: each endpoint checked for valid, invalid and forbidden requests, plus technician access limits.

---

## Sprint 3: Roles, QA closing, projects and evidence v1 (enhancements after Phase 6)

Landed in: `b24b8b9` (12 Nov, "improvements and feature for role managment"). Migrations: `custom_roles`, `work_order_closed_status`, `close_legacy_completed`, `zoho_ticket_and_po`, `work_order_evidence`, `customer_projects`, `voice_notes`. All items in this sprint are **Enhancement** (not in the original phase plan).

**S3-01 · Custom roles and permission matrix** · Enhancement · 8 pts · Kazim · Done
Custom roles (built-in base role plus chosen permissions), `/roles` page, permission checks on pages, actions and API; Dispatcher role for QA and dispatch staff.
AC: a custom role sees and can do only what it is given; page and API use the same permission; Admin keeps full access.

**S3-02 · QA and job closing** · Enhancement · 5 pts · Kazim · Done
Completed (technician done) then Closed (QA verified), send back for rework, "Verify and close", Admin-only reopen, QA permission for custom roles; legacy completed jobs closed by migration.
AC: only QA-permitted users can close; a closed job cannot be edited; rework returns the job to the technician; only Admin can reopen.

**S3-03 · Zoho ticket and Purchase order fields** · Enhancement · 2 pts · Kazim · Done
Optional text fields on requests and work orders with success messages.
AC: values save, show on the work order and survive conversion from a request.

**S3-04 · Customer, Project, Site, Asset hierarchy and Move asset** · Enhancement · 5 pts · Kazim · Done
Projects under a customer with project tabs when there is more than one; move an asset between sites.
APIs: `customers/[id]/projects`.
AC: sites and assets belong to a project; moving an asset keeps its history.

**S3-05 · Nestle customer data load** · Enhancement · 2 pts · Kazim · Done
Nestle customers, projects and sites loaded through the seed script.
AC: the seeded customers appear under their projects and sites.

**S3-06 · Work order evidence v1 (photos, other issues, video)** · Enhancement · 8 pts · Kazim · Done
Photo evidence, "Other issues" with their own photos and video (`work_order_evidence`).
AC: files upload with type and size limits; issues can be added and removed; files open only for the same company.

**S3-07 · Voice notes** · Enhancement · 3 pts · Kazim · Done
Voice notes on a job, up to 10 (`voice_notes`).
AC: record, play and delete; the 11th is refused.

**S3-08 · Screen fixes: fixed header and sidebar, hidden scroll bars** · Bug fix · 2 pts · Kazim · Done
AC: header and sidebar stay in place while content scrolls; layout still works on a phone width.

**S3-09 · Automated tests for roles, QA closing, projects, evidence** · Task · 5 pts · Kazim · Done
Unit: `permissions`, `evidence`, `work-order-status`. Integration: `phase7-qa-roles`, `phase8-evidence`, `phase9-projects`.
AC: pass.

**S3-Q1 · Functional testing: roles, QA closing, projects, evidence** · QA · 5 pts · M. Sami · To Do
Test as Admin, Dispatcher, custom role and Technician; close, rework and reopen; project tabs; upload photos, video and voice.
AC: expected access per role confirmed; defects logged and retested.

**S3-Q2 · Regression of Phases 1 to 6 after permission changes** · QA · 3 pts · M. Sami · To Do
AC: every screen and endpoint behaves the same as before for built-in roles.

---

## Sprint 4: Field evidence and the DriveSense Job Form (enhancements)

Landed in: `7c9cdd3` (13 Nov, "voice, video, pics with labels, service form"). Migrations: `labeled_photos`, `unlabeled_photos_to_others`, `photo_thumbnails`, `service_form`.

**S4-01 · Labeled before and after photo table** · Enhancement · 8 pts · Kazim · Done
Labels (front view, device installed, cabin view, odometer, back camera), temperature probe and sensor photos behind a switch, up to 15 other photos.
AC: each label holds one photo with replace; the temperature photos show only when the switch is on; the 16th other photo is refused.

**S4-02 · Photo compression and thumbnails** · Enhancement · 5 pts · Kazim · Done
Server-side compression with sharp, thumbnails, `MAX_PHOTO_MB`, and the `photos:compress` script for older photos.
AC: new photos are smaller, thumbnails are served in lists, originals are not lost on failure; the script is safe to run twice.

**S4-03 · In-app camera and video recorder** · Enhancement · 8 pts · Kazim · Done
Camera and video capture inside the app (720p, 60 seconds), one video per phase.
AC: capture works on a phone; a video over the limit is refused; one video per phase.

**S4-04 · Bug fix: uploaded video would not play** · Bug fix · 3 pts · Kazim · Done
Attachment route CSP `sandbox` blocked video opened directly; removed for video and audio, byte-range support kept.
AC: a video opened from a link plays; images and documents keep the sandbox.

**S4-05 · DriveSense bilingual Job Form** · Enhancement · 8 pts · Kazim · Done
Service form (English and Urdu) on every work order (`service_form`): visit type and reason, check points, work done, replaced parts, final result; office fills it, technician may; soft reminder on Verify and close; locked after close.
AC: saving twice updates the same form; each check point accepts only its own answers; it cannot change after the job is closed.

**S4-06 · Sign-out and stale service worker fixes** · Bug fix · 3 pts · Kazim · Done
`session/end`, service worker and `sw-reset.html`, error page, middleware.
AC: sign-out clears the session; an old service worker no longer serves stale pages after an update.

**S4-07 · Copyable phone numbers and simpler photo table** · Enhancement · 2 pts · Kazim · Done
AC: phone numbers show and copy with one tap; the photo table is easier to read on a phone.

**S4-08 · Automated tests for evidence, photos, service form, service worker** · Task · 5 pts · Kazim · Done
Unit: `service-form`, `service-worker`, `evidence`. Integration: `phase10-photo-compression`, `phase11-service-form`, `phase8-evidence`.
AC: pass.

**S4-Q1 · Device testing: camera, video, voice, photos** · QA · 5 pts · M. Sami · To Do
On real Android and iPhone: capture, upload, video playback, voice notes, label replace, size limits.
AC: results recorded per device; defects logged and retested.

**S4-Q2 · Job Form testing** · QA · 3 pts · M. Sami · To Do
English and Urdu text, every check point, who can edit and when, locking after close, reminder on Verify and close.
AC: cases executed and recorded.

**S4-Q3 · Regression: evidence and QA closing** · QA · 2 pts · M. Sami · To Do
AC: Sprint 3 flows still pass after the form and photo changes.

---

## Sprint 5: Maintenance, Automation, Dashboard and Reports (Phases 7 and 8)

Landed in: `c8a70a5` (16 Nov, commit message "phase 9") and `b75d280` (16 Nov). Migrations: `maintenance_automation`, `maintenance_description`.

**S5-01 · Maintenance plans module and page** · Story · 8 pts · Kazim · Done
Plans per customer (site and asset optional), weekly, monthly, quarterly or yearly with an interval, lead days, start and end dates, checklist template, priority, active switch; `/maintenance` page.
AC: invalid ranges are refused; the next due date follows the schedule; a plan past its end date switches off.

**S5-02 · Exactly-once work order generation** · Story · 5 pts · Kazim · Done
A due date is claimed in the same transaction that creates the work order, plus a unique index; month-end dates keep the day (31 Jan, 28 Feb, 31 Mar); catch-up of at most 12.
AC: four parallel runs create one work order; the checklist is copied; a paused plan creates nothing.

**S5-03 · Background worker** · Story · 8 pts · Kazim · Done
pg-boss 10 (queue in the `pgboss` schema), hourly tick, one daily run per company at its local 06:00, `pnpm worker`.
AC: the same company and day is queued once; the worker starts and processes a queued job; every job is safe to run again.

**S5-04 · Overdue scan and invoice payment reminders** · Story · 5 pts · Kazim · Done
Office notifications once per overdue work order and invoice; invoice reminders weekly while unpaid.
AC: running the scan twice notifies once; a paid invoice gets no reminder.

**S5-05 · GPS location clean-up** · Task · 2 pts · Kazim · Done
Nightly deletion of technician location points older than 30 days.
AC: only older points are deleted.

**S5-06 · Dashboard KPIs** · Story · 8 pts · Kazim · Done
Visits today, open, overdue and waiting-for-QA work orders, revenue this month against last month, invoiced, outstanding, overdue invoices, 14-day completed chart, technician utilisation (30 days), by status; money only for Admin or users with invoice access.
AC: numbers match the database for the company; day and month boundaries follow the company time zone; a Dispatcher sees no money.

**S5-07 · Reports and Excel export** · Story · 8 pts · Kazim · Done
Work orders, Revenue and Technicians reports for a date range, export to .xlsx (exceljs); APIs `reports` and `reports/export`.
AC: ranges over 366 days or reversed are refused; the export opens in Excel with header and one row per record; revenue is forbidden to users without money access; other companies' data never appears.

**S5-08 · Remove email from the system** · Maintenance · 2 pts · Kazim · Done
Email reminders were first built (mailer, email queue, SMTP, Mailpit) then removed because it is not required now.
AC: no mail code or SMTP settings remain; invoice reminders are office notifications only; all tests pass.

**S5-09 · Automated tests for Phases 7 and 8** · Task · 5 pts · Kazim · Done
Unit: `maintenance-schedule`, `reports`. Integration: `phase12-maintenance`, `phase13-reports`.
AC: pass.

**S5-Q1 · Functional testing: maintenance, dashboard, reports** · QA · 5 pts · M. Sami · To Do
Create, pause and end plans; check generated work orders; compare dashboard figures with invoices and payments; test report filters; open the Excel file.
AC: cases executed and recorded; figures reconciled.

**S5-Q2 · Worker and schedule verification** · QA · 3 pts · M. Sami · To Do
The hourly 06:00 tick across time zones was not tested end to end (the daily job was run by hand).
AC: one real tick confirmed in logs; overdue notifications appear once.

**S5-Q3 · Permission testing: money visibility** · QA · 2 pts · M. Sami · To Do
AC: Dispatcher and custom roles without invoice access see no money on dashboard or reports, in the UI and the API.

---

## Sprint 6: Deployment and production fixes

Landed in: `f4a7ede`, `868d022` (16 Nov) and Railway configuration (not in git).

**S6-01 · Security upgrade: Next.js 15.5.4 to 15.5.29** · Maintenance · 2 pts · Kazim · Done
Railway blocked the deploy for known Next.js vulnerabilities; stale `package-lock.json` removed so only `pnpm-lock.yaml` remains.
AC: Railway build is no longer blocked; build, lint, typecheck and 173 tests pass.

**S6-02 · First-run Super Admin bootstrap script** · Enhancement · 2 pts · Kazim · Done
`pnpm bootstrap` creates the Super Admin from `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` once, and skips if one exists.
AC: second run changes nothing; password under 12 characters is refused.

**S6-03 · Railway environment** · Story · 5 pts · Kazim · Done
PostgreSQL service, `fieldserve_app` role and grants, web service build and start commands (`prisma migrate deploy`, `bootstrap`, `start`), environment variables.
AC: the deploy is successful, 17 migrations applied, Next.js ready on the Railway URL.

**S6-04 · Bug fix: production sign-in fails** · Bug fix · 2 pts · Kazim · In Progress
Cause found in the logs: `DATABASE_URL` contained a placeholder (angle brackets and an example password), so the app could not log in to the database as `fieldserve_app`, and the login page showed "Invalid email or password".
AC: sign-in works on the Railway URL with the Super Admin account. Not confirmed yet.

**S6-Q1 · Production smoke test** · QA · 3 pts · M. Sami · To Do
Sign in, create a company and its Admin, create a work order, upload a photo and a video, run a report.
AC: all steps pass on the live URL; defects logged.

---

## Backlog (not started, kept separate)

| Item | Type | Source |
|---|---|---|
| Phase 9: Playwright end-to-end flow | Story | Project plan |
| Phase 9: Security and performance pass | Story | Project plan |
| Phase 9: Dockerfiles for web and worker, backups | Story | Project plan |
| Phase 9: User acceptance testing | QA | Project plan |
| Persistent volume for uploads on Railway (files are lost on redeploy without it) | Story | Deployment |
| Job Form: Photos / Proof section, signature image, printable or PDF | Enhancement | Deferred |
| Company logo upload (only a link works today) | Enhancement | Deferred |
| Pending-QA queue and notifications | Enhancement | Deferred |
| Fleet type field for Nestle | Enhancement | Deferred |
| Cloud storage (S3) and video transcoding | Enhancement | Later |
| Customer Portal | Epic | Later (plan item 1.1) |

## Totals (proposed)

| Sprint | Dev points | QA points |
|---|---|---|
| 1 | 63 | 8 |
| 2 | 52 | 8 |
| 3 | 40 | 8 |
| 4 | 42 | 10 |
| 5 | 51 | 10 |
| 6 | 11 | 3 |

## Questions to settle before anything is created in Jira

1. Is Kazim correct for every development task, or did Talha own some?
2. Was any manual QA by M. Sami actually done? If yes, which tasks should be Done?
3. Keep the proposed story points, or give me your own?
4. Which Jira site and project: `core9-ai.atlassian.net` project `DS` (not yet connected)? The earlier 20 Epics on `core9.atlassian.net` (SPRIN-572 to SPRIN-591) were created by mistake and should be deleted.
5. Sprint names and real start and end dates.
6. Epics: one per sprint, or one per phase and per enhancement area?
