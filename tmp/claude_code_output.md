# Backend API Standardization — Summary

## Changes
- Added `apps/api/src/lib/api-response.ts` — `{ success, message, data }` envelope
- Added `apps/api/src/lib/schemas.ts` — Zod validation for all major routes
- Improved CORS in `apps/api/src/app.ts` (dev defaults, host suffix, extra headers)
- Updated global error handler, 404 handler, rate limit responses in `server.ts`
- Migrated all route handlers to standard responses
- Added `apps/api/docs/API.md` for frontend developers
- Updated `packages/lure-ui` weld helpers for new envelope

## Frontend setup
```
NEXT_PUBLIC_LEGION_ENGINE_API_URL=http://localhost:4000
API_CORS_ORIGINS=http://localhost:3000
```
