# Mobile Deployment Guide

This project uses two backend targets:

- Local development: `http://localhost:3001/v1`
- Hosted backend (Render): `https://my-note-app-not-just-a-note-app.onrender.com/v1`

The split is configured in `mobile-app/eas.json`.

## 1) Local development (Expo start)

Local app runs from `mobile-app/.env`:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001/v1
EXPO_PUBLIC_DEV_AUTH_TOKEN=u1
```

Run app locally:

```bash
cd mobile-app
npx expo start --clear
```

## 2) Internal testing build (phone install)

Use the `preview` profile so the app points to Render automatically:

```bash
cd mobile-app
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

## 3) Production build

Use the `production` profile:

```bash
cd mobile-app
eas build --profile production --platform ios
eas build --profile production --platform android
```

## 4) Backend deploy (Render)

Render service settings:

- Root directory: `backend`
- Build command: `npm install && npm run build`
- Start command: `npm run start`

Set backend environment variables in Render:

- `PORT` (Render usually provides this automatically)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults in app)
- `OPENAI_LAB_MODEL` (optional)
- `OPENAI_EMBEDDING_MODEL` (optional)

## 5) Verify app is using hosted backend

After installing a preview/production build, trigger any API call and check Render logs.
Requests should hit your service URL, not `localhost`.
