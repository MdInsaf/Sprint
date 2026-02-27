# Welcome to your Whizzc project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Whizzc**

Simply visit the [Whizzc Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Whizzc will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Whizzc.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Backend API and data

- Start the API with `npm run server` (defaults to `http://localhost:4000`).
- Data is now stored in PostgreSQL; tables are created automatically on startup.
- On first run, the database seeds from the legacy `server/db.json` file if no records exist.
- Configure connection via env vars in `.env` (see `.env.example`). If using an SSH/SSM tunnel, point `DB_HOST`/`DB_PORT` to the forwarded host/port.
- Example RDS settings (fill in your password):  
  ```env
  DB_HOST=whizzc-dev-db.c1ku2aim8tbd.ap-south-1.rds.amazonaws.com
  DB_PORT=5432
  DB_NAME=whizzcprod
  DB_USER=postgres
  DB_PASSWORD=...your password...
  DB_SSL=true
  ```

## Authentication

- Login now requires an email and password.
- Seeded users get emails in the format `<username>@example.com` with the default password `password123`.
- When adding users, you must provide a unique email and password (passwords are hashed on the server).
- Users can change their own password from the Account page after signing in.

## How can I deploy this project?

Simply open [Whizzc](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Whizzc project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
