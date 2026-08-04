// Markdown content for each documentation tab

export const INSTALLATION_MARKDOWN = `# Installation

Install the Bug Reporter SDK package in your Next.js project.

## Step 1: Install the SDK Package

### Option A: Install from npm (Recommended)

\`\`\`bash
npm install @boobalan_jkkn/bug-reporter-sdk
\`\`\`

Or using yarn:

\`\`\`bash
yarn add @boobalan_jkkn/bug-reporter-sdk
\`\`\`

### Option B: Install from file path (for development)

\`\`\`bash
npm install file:../packages/bug-reporter-sdk
\`\`\`

### Option C: Install from built package

\`\`\`bash
# First, build the SDK package
cd packages/bug-reporter-sdk
npm run build

# Then install in your project
cd your-project-directory
npm install file:path/to/packages/bug-reporter-sdk
\`\`\`

## Published on npm Registry

The SDK is now available on npm as \`@boobalan_jkkn/bug-reporter-sdk@1.1.0\`. Simply install it using npm or yarn - no additional setup required!

### Package Details:
- **Version:** 1.1.0 (Latest)
- **Size:** 18.6 KB (86.4 KB unpacked)
- **Includes:** CJS, ESM, TypeScript definitions
- **Dependencies:** 3 (including @boobalan_jkkn/shared)
- **NEW:** Mandatory screenshots + Auto console logs

### Links:
- [View SDK on npm](https://www.npmjs.com/package/@boobalan_jkkn/bug-reporter-sdk)
- [View Shared Types](https://www.npmjs.com/package/@boobalan_jkkn/shared)

## Troubleshooting: Getting 404 Error?

If you see "npm error 404 Not Found" when installing, clear your npm cache first:

\`\`\`bash
npm cache clean --force
npm install @boobalan_jkkn/bug-reporter-sdk
\`\`\`

This happens when npm's local cache hasn't updated with newly published packages.

## Requirements

- Next.js 15+ with App Router
- React 19+
- TypeScript 5+ (recommended)
- Node.js 18+
`;

export const CONFIGURATION_MARKDOWN = `# Configuration

Generate API credentials from the JKKN Bug Reporter platform.

## Step 2: Get Your API Key

### 1. Sign up / Log in

Go to the [platform login page](/login) and authenticate.

### 2. Create Organization

Create a new organization (usually your department name) or join an existing one.

### 3. Register Application

Navigate to **Applications → New Application** and register your app:

| Field | Description |
|-------|-------------|
| Name | Your application name |
| Slug | unique-app-slug |
| Description | Brief description of your app |

### 4. Copy API Key

After creating the application, you'll receive an API key. Copy and save it securely.

\`\`\`
br_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

## Security Warning

> **IMPORTANT:** Never commit API keys to version control. Use environment variables to store sensitive credentials.
`;

export const NEXTJS_SETUP_MARKDOWN = `# Next.js Integration

Complete setup for Next.js 15 with App Router.

## Step 3: Next.js Integration

### 3.1. Environment Variables

Create a \`.env.local\` file in your project root:

\`\`\`bash
# JKKN Bug Reporter Configuration
NEXT_PUBLIC_BUG_REPORTER_API_KEY=app_your_api_key_here
NEXT_PUBLIC_BUG_REPORTER_API_URL=https://your-platform.vercel.app
\`\`\`

### 3.2. Root Layout Setup

Update your \`app/layout.tsx\`:

\`\`\`tsx
import { BugReporterProvider } from '@boobalan_jkkn/bug-reporter-sdk';
import { Toaster } from 'react-hot-toast';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BugReporterProvider
          apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
          apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
          enabled={true}
          debug={process.env.NODE_ENV === 'development'}
          userContext={{
            userId: 'user-id-here', // Optional
            name: 'John Doe',       // Optional
            email: 'user@jkkn.ac.in' // Optional
          }}
        >
          {children}
        </BugReporterProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
\`\`\`

### 3.3. With Supabase Authentication

For authenticated apps using Supabase:

\`\`\`tsx
'use client';

import { BugReporterProvider } from '@boobalan_jkkn/bug-reporter-sdk';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function BugReporterWrapper({
  children
}: {
  children: React.ReactNode
}) {
  const [user, setUser] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  return (
    <BugReporterProvider
      apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
      apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
      enabled={true}
      userContext={user ? {
        userId: user.id,
        name: user.user_metadata?.full_name,
        email: user.email
      } : undefined}
    >
      {children}
    </BugReporterProvider>
  );
}
\`\`\`

## What You Get

- Floating bug report button (bottom-right)
- **MANDATORY** screenshot capture (v1.1.0+)
- **AUTOMATIC** console logs capture (v1.1.0+)
- User context tracking
- Browser and system info
`;

export const ADVANCED_MARKDOWN = `# Advanced Configuration

Customize behavior and add advanced features.

## Custom Widget Styling

Override default styles using CSS classes:

\`\`\`css
/* globals.css */
.bug-reporter-widget {
  /* Custom floating button styles */
  bottom: 2rem !important;
  right: 2rem !important;
}

.bug-reporter-sdk {
  /* Custom modal/widget styles */
  font-family: 'Your Custom Font' !important;
}
\`\`\`

## Conditional Rendering

Show/hide bug reporter based on conditions:

\`\`\`tsx
<BugReporterProvider
  apiKey={process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY!}
  apiUrl={process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL!}
  enabled={
    process.env.NODE_ENV === 'production' &&
    user?.role === 'beta-tester'
  }
  debug={false}
>
  {children}
</BugReporterProvider>
\`\`\`

## Add "My Bugs" Panel

Let users view their submitted bugs:

\`\`\`tsx
import { MyBugsPanel } from '@boobalan_jkkn/bug-reporter-sdk';

export default function ProfilePage() {
  return (
    <div>
      <h1>My Profile</h1>
      <MyBugsPanel />
    </div>
  );
}
\`\`\`

## Programmatic Bug Reporting

Trigger bug reports from code:

\`\`\`tsx
import { useBugReporter } from '@boobalan_jkkn/bug-reporter-sdk';

function MyComponent() {
  const { apiClient } = useBugReporter();

  const handleError = async (error: Error) => {
    try {
      await apiClient?.createBugReport({
        title: 'Automatic Error Report',
        description: error.message,
        page_url: window.location.href,
        category: 'error',
        console_logs: [],
      });
    } catch (err) {
      console.error('Failed to report bug:', err);
    }
  };

  return <button onClick={() => handleError(new Error('Test'))}>
    Report Error
  </button>;
}
\`\`\`

---

# Troubleshooting

Common issues and solutions.

## npm install shows 404 error?

- Clear npm cache: \`npm cache clean --force\`
- Wait 5-10 minutes if package was just published
- Try with explicit registry: \`npm install @boobalan_jkkn/bug-reporter-sdk --registry=https://registry.npmjs.org/\`
- Verify package exists at: [npmjs.com](https://www.npmjs.com/package/@boobalan_jkkn/bug-reporter-sdk)

## Widget not appearing?

- Check that \`enabled={true}\` is set
- Verify API key is correct
- Check browser console for errors
- Ensure API URL is reachable

## API key validation failed?

- Verify API key starts with "app_"
- Check that application is active
- Ensure API URL matches platform URL
- Try regenerating the API key

## Screenshots not capturing? (v1.1.0+)

- Screenshot is now MANDATORY - widget won't open without it
- Browser may block html2canvas library
- Check Content Security Policy (CSP)
- Verify no conflicting screenshot libraries
- Try closing overlays/modals and retry

## Console logs empty? (v1.1.0+)

- Logs capture automatically in v1.1.0+
- Perform actions that generate console output before reporting
- Verify you're using v1.1.0 or later: \`npm list @boobalan_jkkn/bug-reporter-sdk\`
- Check BugReporterProvider wraps your app correctly

## How to update to v1.1.0?

If you already have the SDK installed, update to the latest version:

\`\`\`bash
npm install @boobalan_jkkn/bug-reporter-sdk@latest
\`\`\`

- No breaking changes - fully backward compatible!
- New features work automatically
- No configuration changes needed
`;

export const FULL_DOCUMENTATION_MARKDOWN = `# JKKN Bug Reporter SDK - Integration Guide

Complete guide to integrate JKKN Bug Reporter into your Next.js applications with Supabase.

---

${INSTALLATION_MARKDOWN}

---

${CONFIGURATION_MARKDOWN}

---

${NEXTJS_SETUP_MARKDOWN}

---

${ADVANCED_MARKDOWN}

---

## API Reference

### BugReporterProvider Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| apiKey | string | Yes | Your application API key |
| apiUrl | string | Yes | Bug Reporter platform URL |
| enabled | boolean | No | Enable/disable the widget (default: true) |
| debug | boolean | No | Enable debug mode (default: false) |
| userContext | object | No | User information for tracking |

### userContext Object

| Field | Type | Description |
|-------|------|-------------|
| userId | string | Unique user identifier |
| name | string | User's display name |
| email | string | User's email address |

### Exported Components

- \`BugReporterProvider\` - Main provider component
- \`MyBugsPanel\` - Panel to view submitted bugs
- \`useBugReporter\` - Hook for programmatic access

---

## Support

Need help? Our team is here to support JKKN developers.

- [Go to Dashboard](/login)
- Contact Support

---

*© 2025 JKKN Bug Reporter. All rights reserved.*
`;

export const BUG_PORTAL_MARKDOWN = `# Bug Status Portal

Once someone reports a bug, they have no way of knowing what happened to it. The
Bug Status Portal is the return path: a page where a reporter sees the bugs
**they** submitted, the current status of each, and the notes your team has
added — and where they can reply.

It is **off by default** for every application, and you turn it on yourself.

---

## 1. Turn it on

Open your application in BugReporter → **Settings** → **Bug Status Portal**, and
flip the master switch.

That page also lets you choose whether reporters may reply, whether to require
signed links, and whether to send webhooks.

## 2. Copy the link

Enabling the portal shows a link with your application's slug already filled in:

\`\`\`
https://<your-bugreporter-host>/portal/<your-app-slug>?u=<user email>
\`\`\`

## 3. Add it to your app

Pass the signed-in user's email — the same value you already give the SDK as
\`userContext.email\`:

\`\`\`tsx
<a href={\\\`https://<your-bugreporter-host>/portal/my-app?u=\\\${encodeURIComponent(user.email)}\\\`}>
  My bug reports
</a>
\`\`\`

That is the whole integration. No SDK upgrade, no new package, no API key in the
page — the portal renders on BugReporter and looks up the application by slug.

---

## Who sees what

Each reporter sees **only the bugs they submitted** to that one application.
Notes your team marks as internal are never shown.

> **Security note.** The email in the link comes from the browser, so a
> determined user of your application could edit it and read another user's bug
> reports **for that same application**. That is usually acceptable for internal
> tools. To close it, have your backend sign the link and switch on **Require
> signed links**:
>
> \`\`\`ts
> import { createHmac } from 'crypto';
> const sig = createHmac('sha256', WEBHOOK_SECRET)
>   .update(userEmail.trim().toLowerCase())
>   .digest('hex');
> // → /portal/my-app?u=<email>&sig=<sig>
> \`\`\`
>
> Only turn the switch on once your app is minting signed links, or the portal
> will stop opening.

---

## Reading bugs from your own code

\`\`\`http
GET /api/v1/public/bug-reports/me?reporter_email=user@example.com
X-API-Key: br_your_api_key
\`\`\`

\`reporter_email\` is **required**. Earlier versions of this endpoint returned
every bug reported to the application, including other reporters' names and
email addresses; it now returns only that reporter's bugs and rejects requests
that do not identify one.

Other endpoints, all scoped the same way:

| Endpoint | Purpose |
| --- | --- |
| \`GET /api/v1/public/bug-reports/:id?reporter_email=…\` | One bug plus its thread |
| \`GET /api/v1/public/bug-reports/:id/messages?reporter_email=…\` | The thread alone |
| \`POST /api/v1/public/bug-reports/:id/messages\` | Post a note as the reporter |

**Status is read-only from your application.** It is owned by the BugReporter
dashboard, so \`PATCH\` requests carrying a \`status\` are rejected. Statuses are:
\`new\`, \`seen\`, \`in_progress\`, \`resolved\`, \`wont_fix\`.

---

## Webhooks

Switch on **Send webhooks** and set a URL, and BugReporter POSTs to it whenever a
status changes or a note is added.

\`\`\`json
{
  "event": "bug.status_changed",
  "bug": { "id": "…", "display_id": "BUG-123", "reporter_email": "user@example.com" },
  "from_status": "in_progress",
  "to_status": "resolved",
  "note": "Fixed in today's release.",
  "occurred_at": "2026-08-04T10:00:00.000Z"
}
\`\`\`

Events: \`bug.status_changed\`, \`bug.note_added\`.

### Verifying the signature

Every request carries \`X-BugReporter-Signature: t=<unix>,v1=<hex>\`. The
timestamp is signed with the body so an old request cannot be replayed:

\`\`\`ts
import { createHmac, timingSafeEqual } from 'crypto';

export function verify(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = createHmac('sha256', secret)
    .update(\\\`\\\${parts.t}.\\\${rawBody}\\\`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
\`\`\`

Verify against the **raw** body, before any JSON parsing — re-serialising it
changes the bytes and the signature will not match.

Failed deliveries retry with backoff (1m, 5m, 15m, 1h, 6h) and then stop. Recent
deliveries and the last error are shown on the Settings card, and polling
\`/me\` remains a reliable fallback if a delivery is ever missed.
`;

export const TAB_CONTENT_MAP: Record<string, { markdown: string; filename: string; title: string }> = {
  installation: {
    markdown: INSTALLATION_MARKDOWN,
    filename: 'jkkn-bug-reporter-installation.md',
    title: 'Installation Guide'
  },
  configuration: {
    markdown: CONFIGURATION_MARKDOWN,
    filename: 'jkkn-bug-reporter-configuration.md',
    title: 'Configuration Guide'
  },
  nextjs: {
    markdown: NEXTJS_SETUP_MARKDOWN,
    filename: 'jkkn-bug-reporter-nextjs-setup.md',
    title: 'Next.js Setup Guide'
  },
  advanced: {
    markdown: ADVANCED_MARKDOWN,
    filename: 'jkkn-bug-reporter-advanced.md',
    title: 'Advanced Configuration Guide'
  },
  portal: {
    markdown: BUG_PORTAL_MARKDOWN,
    filename: 'jkkn-bug-reporter-status-portal.md',
    title: 'Bug Status Portal'
  },
  full: {
    markdown: FULL_DOCUMENTATION_MARKDOWN,
    filename: 'jkkn-bug-reporter-complete-documentation.md',
    title: 'Complete Documentation'
  }
};
