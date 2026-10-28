# QR Scan Tracker

Upload your QR code images in the dashboard. For each one you get a trackable
version and a full scan history: unique people, total scans, daily chart,
devices and a list of every scan.

---------------------------------------------------------------------
## A. Host it on Vercel (recommended)
---------------------------------------------------------------------
Vercel can't keep files, so on Vercel the app saves everything in a free
Postgres database (Neon). The app creates its tables by itself.

1. **Put the code on GitHub**
   Create a new repository and upload everything in this folder
   (not `node_modules`). On github.com you can drag and drop the files
   with "Add file → Upload files".

2. **Import it on Vercel**
   vercel.com → **Add New… → Project** → pick your repository → **Deploy**.
   Vercel detects the Express app on its own and needs no settings.

3. **Add the database**
   Open the project → **Storage** tab → **Create Database** → choose **Neon** (Postgres)
   → create it and **connect it to this project** (tick all environments).
   This adds `DATABASE_URL` for you.

4. **Set your password**
   Project → **Settings → Environment Variables** → add
   `DASHBOARD_PASSWORD` = a password only you know.

5. **Redeploy** so the new settings take effect:
   **Deployments** tab → the "…" menu on the latest one → **Redeploy**.

6. **Use it**
   Open `https://YOUR-PROJECT.vercel.app/dashboard`, log in, upload your QR image,
   click **Download QR** and print the new code.

### Optional: use your own address (e.g. qr.doublebull.in)
Project → **Settings → Domains** → add `qr.doublebull.in` and follow Vercel's
instructions to add the DNS record where you bought doublebull.in.
Then add `PUBLIC_URL` = `https://qr.doublebull.in`, redeploy, and download your QR codes
again. Do this **before** you print, because the address is printed inside every code.

### If something goes wrong
- Red banner "No database connected": step 3 or step 5 was missed.
- "Wrong password": check DASHBOARD_PASSWORD, then redeploy.
- Errors: Project → **Logs** shows what happened.

---------------------------------------------------------------------
## B. Run it on your own computer
---------------------------------------------------------------------
    npm install
    npm start
Open http://localhost:3000/dashboard (password `admin123`). Data is saved in
`scans.json`. To test with your phone on the same Wi-Fi, open the "For phone
testing" address printed in the terminal and download the QR from there.

---------------------------------------------------------------------
## Using the dashboard
---------------------------------------------------------------------
1. **Add a QR code**: drop your QR image on the upload box (or click / paste).
   The link inside is read automatically. Name it, then click **Create trackable QR**.
2. **Download QR** and print that new code in place of the old one.
   When someone scans it, the scan is counted and they're sent to your original link.
   Their phone shows the tracking link first; that's how the counting works.
3. **Click a card** to see that code's history. **Edit** changes the name or the
   destination, and printed codes keep working. **Delete** removes the code and its history.

## How "unique people" is counted
The first scan gives the phone a 2-year cookie. If cookies are blocked, a hashed
IP + device signature is used. Raw IP addresses are never stored. One person with
two phones counts as two.

## Settings (environment variables)
| Name               | What it does                                                  |
|--------------------|---------------------------------------------------------------|
| DASHBOARD_PASSWORD | Dashboard password (default `admin123`, so change it)         |
| DATABASE_URL       | Postgres connection, set automatically by Vercel + Neon       |
| PUBLIC_URL         | Address printed inside QR codes, e.g. https://qr.doublebull.in. If empty, the address you opened the dashboard with is used |
| DATA_FILE          | Where to save data when not using Postgres                    |
