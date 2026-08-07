This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Environment variables

### BuildWise routine lane

| Variable | Required | Purpose |
|----------|----------|---------|
| `BUILDWISE_JOBS_SECRET` | Yes, for the `buildwise.*` routines | Shared secret sent as the `x-jobs-secret` header when the routine dispatcher (and the run-now route) POSTs BuildWise's `/api/jobs/<name>` endpoints. Must match the value BuildWise itself is deployed with. Without it, every `buildwise.*` run records an error. |
| `BUILDWISE_JOBS_HOST` | Yes, for the `buildwise.*` routines | The one hostname the secret above may be sent to, e.g. `buildwise.example.com` (host only — no scheme, no path). The destination comes from `applications.app_url`, which any org admin can edit, so the call is refused unless that URL is `https://` and its hostname matches this exactly. Unset means every `buildwise.*` run refuses — deliberate, not a bug. |

The `buildwise.*` routines are direct HTTPS compute calls to the target app (resolved from `applications.app_url`) — they never go through the MyJKKN AI engine.

**These runs are not side-effect-free.** `cash-digest`, `budget-watchdog` and `anomaly-scan` raise alerts inside BuildWise, and a new high-severity alert pushes a notification to the managing director's phone. Only `reconcile` is silent. BuildWise's fifth job, `push-flush`, is deliberately absent from the catalog because it is the notification delivery path rather than a read.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
