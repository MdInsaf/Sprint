# Sprint Flow

Sprint Flow is a full-stack sprint, task, bug, and QA tracking system with role-based boards, time tracking, blockers, attachments, and email notifications.

## Key Features
- Sprint management with holiday-aware time tracking (skip weekends + sprint-specific holidays).
- Boards:
  - Sprint Board (To Do / In Progress / Blocked / Done).
  - Test Board (Ready to Test / Testing / Blocked / Rework / Fixing / Ready to Stage).
  - Bug Board + Bug Summary.
- QA pipeline tracking (Testing time + Fixing time).
- Task details popup (click task titles on boards and task list).
- Pagination controls on boards (controls at the bottom of each page).
- Blocker capture with required descriptions.
- Attachments for tasks/bugs (S3 + presigned URLs).
- Attachment previews: images + videos open in popup; other files download.
- Task comments and approvals.
- CSV export for bugs.
- Role-based access (Manager / Developer / QA).
- Email notifications for assignments and QA workflow events.
- Unified task ID format by type:
  - Sprint: `SP-###`
  - Additional: `ADD-###`
  - Bug: `BUG-###`
  - Change: `CHG-###`
- Sprint Summary:
  - Set selected sprint as Active from Summary page.
  - Blocked counts + carry-forward completion shown in breakdown.

## Architecture
- Frontend: React + Vite + TypeScript + shadcn/ui + Tailwind.
- Backend: Django 6 + Django REST Framework.
- Database: PostgreSQL.
- File storage: AWS S3 (attachments, presigned download URLs).
- Auth: Django sessions + CSRF.

## Local Development

### Prerequisites
- Node.js (18+ recommended)
- Python (3.10+ recommended)
- PostgreSQL (via AWS Secrets or local DB if you adjust settings)
- AWS credentials for Secrets Manager and S3 if you use the default setup

### Backend (Django)
1) Create and activate a virtual env.
2) Install deps:
   ```sh
   cd backend
   pip install -r requirements.txt
   ```
3) Configure environment (see Environment Variables below).
4) Run migrations:
   ```sh
   python manage.py migrate
   ```
5) Start the API:
   ```sh
   python manage.py runserver
   ```
   API defaults to `http://127.0.0.1:8000/`

### Frontend (Vite)
1) Install deps:
   ```sh
   cd frontend
   npm install
   ```
2) Start dev server:
   ```sh
   npm run dev
   ```
   App defaults to `http://localhost:5173/`

### Office File Conversion (optional)
If you want office files (doc/xls/ppt) converted to PDF on upload, install LibreOffice
on the backend host. Conversion falls back to the original file if LibreOffice is missing.

## Environment Variables

### Backend (`backend/.env` or `backend/.env.local`)
General:
- `DJANGO_ENV` = `development` | `production`
- `APP_DOMAIN` = domain used for cookies/links (local: `localhost`)
- `FRONTEND_ORIGIN` = full frontend URL
- `BACKEND_HOST` = backend host for Django `ALLOWED_HOSTS` (set this if API uses a different domain)
- `BACKEND_ORIGIN` = backend origin (optional; used to derive `BACKEND_HOST` if set)
- `EXTRA_ORIGINS` = comma list of allowed CORS/CSRF origins
- `DEFAULT_APP_DOMAIN` = fallback domain if `APP_DOMAIN` not set
- `COOKIE_DOMAIN` = override cookie domain (use a shared parent domain when frontend/API are on sibling subdomains)

Time tracking:
- `WORKDAY_HOURS` = hours per day (default 24)
- `WEEKEND_DAYS` = comma list of weekday indexes (default `5,6` for Sat/Sun)
- `HOLIDAY_DATES` = comma list of `YYYY-MM-DD`

Attachments:
- `ATTACHMENTS_BUCKET` = S3 bucket name
- `ATTACHMENT_URL_EXPIRES` = presigned URL TTL in seconds
- `AWS_REGION`, `AWS_PROFILE` (used by boto3)

Auth:
- `DEFAULT_USER_PASSWORD` = default password used when creating users via API

Email notifications:
- `EMAIL_NOTIFICATIONS_ENABLED` = `true|false`
- `EMAIL_BACKEND` (optional; defaults to console in dev)
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`
- `EMAIL_USE_TLS`, `EMAIL_USE_SSL`
- `DEFAULT_FROM_EMAIL`

Secrets Manager:
This project reads DB credentials (and optional email settings) from AWS Secrets Manager.
By default it expects a secret named `dev/SprintFlow` and uses the `whizzc-dev` AWS profile.
If you do not have access to AWS Secrets, update `backend/core/settings.py` to read local
DB settings instead.

### Frontend (`frontend/.env`)
- `VITE_API_URL` = backend base URL (defaults to `/v1/api`)

## Email Notification Rules
Emails are sent when:
- A task/bug is assigned to a user.
- QA moves a task from **Testing** to **Rework** or **Fixing** (notifies the task owner).
- A task becomes **Ready to Test** (notifies all QA users).
- A bug becomes **Fixed** (notifies all QA users).
- A blocker is added (notifies the task owner).

## Data Model (high level)
- `Sprint`
- `Task` (includes bugs/changes)
- `Approval`
- `SprintSummary`
- `TaskComment`
- `TaskAttachment`

QA tracking fields:
- `qa_status`, `qa_in_progress_date`, `qa_actual_hours`
- `qa_fixing_in_progress_date`, `qa_fixing_hours`

## API Endpoints (base: `/v1/api`)
- `GET /health`
- `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password`
- `GET /me`
- `GET/POST /users` and `/team-members`
- `GET/POST /sprints`, `PUT /sprints/:id`, `GET /active-sprint`
- `GET/POST /tasks`, `PUT/DELETE /tasks/:id`
- `GET/POST /approvals`
- `GET/POST /sprint-summaries`, `GET /sprint-summaries/:id`
- `GET/POST /task-comments`

## QA & Time Tracking Behavior
- `actual_hours` tracks time in **In Progress** / **Reopen**.
- `blocked_hours` tracks time in **Blocked**.
- `qa_actual_hours` tracks time in QA **Testing**.
- `qa_fixing_hours` tracks time in QA **Fixing** and is also added into dev time.
- Sprint elapsed days exclude weekends + sprint holidays.

## ID Format
New tasks use a unified ID format by type:
- Sprint: `SP-###`
- Additional: `ADD-###`
- Bug: `BUG-###`
- Change: `CHG-###`
IDs auto-expand beyond 3 digits (e.g., `SP-999` → `SP-1000`).

## Deployment Notes
- Frontend can be built with `npm run build`.
- Backend includes `backend/zappa_settings.json` for AWS Lambda via Zappa.
- Frontend can also be deployed to S3 + CloudFront.

## Backend Deployment To AWS
This backend is set up for AWS Lambda + API Gateway using Zappa.

1) Create AWS resources:
- PostgreSQL database in RDS.
- Secrets Manager secret for the environment, for example `prod/SprintFlow`.
- An S3 bucket for Zappa deployment packages.
- An S3 bucket for task attachments.

2) Put these keys in Secrets Manager:
- `dbname`, `username`, `password`, `host`, `port`
- `APP_DOMAIN`
- `BACKEND_HOST`
- `COOKIE_DOMAIN`
- `DEFAULT_CLOUD_FRONTEND`
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` (optional if email is enabled)
- Optional mail flags: `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_NOTIFICATIONS_ENABLED`

3) Update [backend/zappa_settings.json](/f:/Sprint/backend/zappa_settings.json):
- Replace `REPLACE_WITH_ZAPPA_DEPLOY_BUCKET`
- Replace `REPLACE_WITH_ATTACHMENTS_BUCKET`
- If needed, change `AWS_SECRET_NAME`
- If you use a named local AWS CLI profile, add `profile_name`

4) Deploy:
```sh
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
zappa deploy prod
zappa manage prod migrate
```

5) For future releases:
```sh
zappa update prod
zappa manage prod migrate
```

6) Point the frontend to the backend:
- Production frontend: `https://snitch.ascendersservices.in`
- Production backend: `https://sprint.ascendersservices.in`
- Set `VITE_API_URL=https://sprint.ascendersservices.in/v1/api`

## Frontend Deployment To AWS (S3 + CloudFront)
This repo now includes an AWS frontend deployment workflow in
[.github/workflows/deploy-frontend.yml](/f:/Sprint/.github/workflows/deploy-frontend.yml).

Current production frontend AWS resources:
- S3 bucket: `snitch-ascendersservices-in-frontend-132334512551`
- CloudFront distribution ID: `EWIDSK6QIC2V9`
- CloudFront domain: `d2olc5m2v97tk4.cloudfront.net`

GitHub Actions secrets required:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional:
- `VITE_API_URL`

The workflow:
- builds the Vite app
- syncs `dist/` to S3
- invalidates CloudFront

Notes:
- `backend/core/settings.py` now supports both AWS Secrets Manager and direct env vars like `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`.
- For browser auth to work cleanly, use a shared parent domain such as `app.example.com` for frontend and `api.example.com` for backend.
