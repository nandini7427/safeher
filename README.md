# SafeHer — real-input women safety web app

Starter implementation: React + FastAPI + PostgreSQL + Twilio SMS + browser GPS.

## What works after configuration
- Account registration/login (JWT; passwords hashed).
- Add/list/delete emergency contacts.
- Browser GPS capture from the dashboard.
- SOS incident creation and SMS sending to saved contacts (Twilio).
- Secure, random live-location sharing URL; contact can open it without an account.
- Location updates are stored and exposed to the active tracking page.

## Important limits
- This is a development starter, not a certified emergency-response service.
- A website cannot guarantee background GPS after the browser is closed or suspended.
- SMS delivery depends on Twilio account status, destination-country permissions, sender configuration and carrier delivery. Never show “delivered” unless provider confirms it.
- The SOS workflow does not dispatch police. Provide a user-initiated 112 call action in the UI.
- Do not use real personal data until HTTPS, access controls, retention/deletion policies and security review are in place.

## 1. Requirements
- Python 3.11+
- Node.js 20+
- PostgreSQL 15+
- Twilio account with SMS enabled and a permitted sender

## 2. Backend
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```
Copy `.env.example` to `.env`, set `DATABASE_URL`, `JWT_SECRET`, and Twilio values.
```bash
uvicorn app.main:app --reload --port 8000
```
API docs: http://127.0.0.1:8000/docs

Create PostgreSQL database first, e.g. `safeher`.

## 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL. Set `VITE_API_URL=http://127.0.0.1:8000` in `frontend/.env`.

## 4. Test in two real phones
1. Use a publicly reachable HTTPS deployment for mobile GPS and the contact tracking link. `localhost` works only for local development.
2. Register a user with your own phone number in E.164 format, e.g. `+91XXXXXXXXXX`.
3. Add an emergency contact who has agreed to receive test alerts.
4. Configure Twilio and verify your sender/destination permissions.
5. Open the app on Phone A, allow location permission, then press **Test SOS** only with the contact's consent.
6. Open the SMS link on Phone B. It displays the most recent stored location and refreshes while the user's sharing session is active.

## Environment variables
See `backend/.env.example`. Never commit `.env` or API secrets.

## Current implementation scope
This first build covers authentication, contact management, GPS, SOS/SMS, and live-share page. Nearby police search, OTP verification, PWA packaging, production deployment and 112 call affordances are next milestones.
