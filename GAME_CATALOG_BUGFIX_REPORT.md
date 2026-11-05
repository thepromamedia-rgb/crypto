# Game Catalogue Bug Check & Fix Report

Date: 2026-11-05

## Fixes applied
- Fixed the admin image-replacement edge case: choosing an unsupported/oversized replacement or an unreadable image now clears the stale preview and selected image instead of leaving the previous image silently queued for upload.
- Reset the file input before opening Replace image so selecting the same file again reliably triggers the browser change event.
- Made the catalogue test use a project-relative server import so it runs after extracting the ZIP in a different directory.

## Additional verification
- JavaScript syntax checks: `server.js`, `admin.js`, `app.js` — PASS.
- Full `npm test` suite — PASS.
- Catalogue authorization — unauthenticated admin list rejected.
- Unsupported MIME — rejected.
- MIME/signature mismatch — rejected.
- Image larger than 5 MB — rejected.
- Add/list — PASS.
- Delete unknown ID — returns 404.
- Selective delete — only selected game removed.
- Persistence after database reload — PASS.

## Not verified in this environment
- Live browser visual testing at desktop/tablet/mobile sizes.
- Live Render deployment, production persistent storage and real SMTP configuration.
- Full security certification or legal review.

## Deployment note
Back up production data before deployment. Keep a persistent storage configuration (Upstash Redis or a properly mounted persistent disk) so catalogue entries and uploaded image data survive restarts/deploys.
