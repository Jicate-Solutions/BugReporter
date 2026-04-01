import { Resend } from 'resend';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  seen: 'Seen',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  wont_fix: "Won't Fix",
};

const CLOSED_STATUSES = new Set(['resolved', 'wont_fix']);

function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

function getSenderAddress(): string {
  return process.env.NOTIFICATION_FROM_EMAIL || 'noreply@bugreporter.dev';
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function baseLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #18181b;
    }
    .wrapper {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .header {
      background-color: #18181b;
      padding: 24px 32px;
    }
    .header-logo {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.3px;
    }
    .header-logo span {
      color: #a78bfa;
    }
    .body {
      padding: 32px;
    }
    .headline {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 8px 0;
      color: #18181b;
    }
    .subtext {
      font-size: 14px;
      color: #71717a;
      margin: 0 0 24px 0;
      line-height: 1.6;
    }
    .divider {
      border: none;
      border-top: 1px solid #e4e4e7;
      margin: 24px 0;
    }
    .card {
      background: #fafafa;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #71717a;
      margin: 0 0 4px 0;
    }
    .card-value {
      font-size: 15px;
      font-weight: 500;
      color: #18181b;
      margin: 0 0 14px 0;
      line-height: 1.5;
      word-break: break-word;
    }
    .card-value:last-child {
      margin-bottom: 0;
    }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-new        { background: #eff6ff; color: #1d4ed8; }
    .badge-seen       { background: #fafafa; color: #52525b; border: 1px solid #e4e4e7; }
    .badge-in_progress{ background: #fffbeb; color: #b45309; }
    .badge-resolved   { background: #f0fdf4; color: #15803d; }
    .badge-wont_fix   { background: #fef2f2; color: #dc2626; }
    .cta {
      background: #fef9ec;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 18px 20px;
      margin-top: 20px;
    }
    .cta p {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #78350f;
      line-height: 1.6;
    }
    .btn {
      display: inline-block;
      background-color: #18181b;
      color: #ffffff !important;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 6px;
    }
    .btn-outline {
      display: inline-block;
      background-color: transparent;
      color: #18181b !important;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 6px;
      border: 1px solid #d4d4d8;
    }
    .action-row {
      margin-top: 24px;
    }
    .footer {
      padding: 20px 32px;
      background: #fafafa;
      border-top: 1px solid #e4e4e7;
      font-size: 12px;
      color: #a1a1aa;
      text-align: center;
      line-height: 1.6;
    }
    .footer a {
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Bug<span>Reporter</span></div>
    </div>
    <div class="body">
      ${bodyContent}
    </div>
    <div class="footer">
      This email was sent by BugReporter. You are receiving this because you are associated with this project.<br/>
      &copy; ${new Date().getFullYear()} BugReporter. All rights reserved.
    </div>
  </div>
</body>
</html>`;
}

function field(label: string, value: string): string {
  return `<p class="card-label">${label}</p><p class="card-value">${value}</p>`;
}

// ---------------------------------------------------------------------------
// Email params interfaces
// ---------------------------------------------------------------------------

interface NewBugNotificationParams {
  developerEmail: string;
  developerName?: string;
  bugId: string;
  bugTitle: string;
  bugDescription: string;
  reporterName?: string;
  reporterEmail?: string;
  appName: string;
  orgName: string;
  pageUrl: string;
  dashboardUrl: string;
}

interface StatusUpdateNotificationParams {
  reporterEmail: string;
  reporterName?: string;
  bugId: string;
  bugTitle: string;
  newStatus: string;
  appName: string;
  orgName: string;
  developerNote?: string;
  bugViewUrl?: string;
}

// ---------------------------------------------------------------------------
// EmailService
// ---------------------------------------------------------------------------

export class EmailService {
  /**
   * Notify a developer / org admin that a new bug has been submitted.
   * Fire-and-forget: logs errors but never throws.
   */
  static async sendNewBugNotification(params: NewBugNotificationParams): Promise<void> {
    const {
      developerEmail,
      developerName,
      bugId,
      bugTitle,
      bugDescription,
      reporterName,
      reporterEmail,
      appName,
      orgName,
      pageUrl,
      dashboardUrl,
    } = params;

    const greeting = developerName ? `Hi ${developerName},` : 'Hi there,';
    const reporterDisplay = reporterName || reporterEmail || 'Anonymous';

    const bodyContent = `
      <p class="headline">New Bug Reported</p>
      <p class="subtext">${greeting} A new bug has been submitted for <strong>${appName}</strong> (${orgName}). Please review it in your dashboard.</p>
      <div class="card">
        ${field('Bug ID', `#${bugId}`)}
        ${field('Title', escapeHtml(bugTitle))}
        ${field('Description', escapeHtml(bugDescription))}
        ${field('Reported by', escapeHtml(reporterDisplay))}
        ${field('Page URL', `<a href="${escapeHtml(pageUrl)}" style="color:#6d28d9;">${escapeHtml(pageUrl)}</a>`)}
        ${field('Application', escapeHtml(appName))}
        ${field('Organization', escapeHtml(orgName))}
      </div>
      <div class="action-row">
        <a href="${escapeHtml(dashboardUrl)}" class="btn">View Bug in Dashboard &rarr;</a>
      </div>
    `;

    const html = baseLayout(`New Bug: ${bugTitle}`, bodyContent);

    try {
      const resend = getResendClient();
      const { error } = await resend.emails.send({
        from: getSenderAddress(),
        to: developerEmail,
        subject: `[BugReporter] New Bug Reported: ${bugTitle}`,
        html,
      });

      if (error) {
        console.error('[EmailService] sendNewBugNotification resend error:', error);
      } else {
        console.info(`[EmailService] New-bug notification sent to ${developerEmail} for bug #${bugId}`);
      }
    } catch (err) {
      console.error('[EmailService] sendNewBugNotification unexpected error:', err);
    }
  }

  /**
   * Notify the reporter that their bug's status has changed.
   * Fire-and-forget: logs errors but never throws.
   */
  static async sendStatusUpdateNotification(params: StatusUpdateNotificationParams): Promise<void> {
    const {
      reporterEmail,
      reporterName,
      bugId,
      bugTitle,
      newStatus,
      appName,
      orgName,
      developerNote,
      bugViewUrl,
    } = params;

    const greeting = reporterName ? `Hi ${reporterName},` : 'Hi there,';
    const statusLabel = STATUS_LABELS[newStatus] ?? newStatus;
    const badgeClass = `badge badge-${newStatus.replace('_', '_')}`;
    const isClosed = CLOSED_STATUSES.has(newStatus);

    const ctaBlock = isClosed
      ? `
        <div class="cta">
          <p>If your issue is not yet resolved, please describe the problem more clearly and reopen the bug.</p>
          ${
            bugViewUrl
              ? `<a href="${escapeHtml(bugViewUrl)}" class="btn-outline">Reopen or Contact Support</a>`
              : ''
          }
        </div>`
      : '';

    const bodyContent = `
      <p class="headline">Your Bug Report Has Been Updated</p>
      <p class="subtext">${greeting} The status of your bug report for <strong>${appName}</strong> (${orgName}) has been updated.</p>
      <div class="card">
        ${field('Bug ID', `#${bugId}`)}
        ${field('Title', escapeHtml(bugTitle))}
        ${field('New Status', `<span class="${badgeClass}">${escapeHtml(statusLabel)}</span>`)}
        ${field('Application', escapeHtml(appName))}
        ${field('Organization', escapeHtml(orgName))}
        ${developerNote ? field('Note from Developer', escapeHtml(developerNote)) : ''}
      </div>
      ${ctaBlock}
      ${
        bugViewUrl && !isClosed
          ? `<div class="action-row"><a href="${escapeHtml(bugViewUrl)}" class="btn">View Your Bug Report &rarr;</a></div>`
          : ''
      }
    `;

    const html = baseLayout(`Status Update: ${bugTitle}`, bodyContent);

    try {
      const resend = getResendClient();
      const { error } = await resend.emails.send({
        from: getSenderAddress(),
        to: reporterEmail,
        subject: `[BugReporter] Your bug report has been updated: ${bugTitle}`,
        html,
      });

      if (error) {
        console.error('[EmailService] sendStatusUpdateNotification resend error:', error);
      } else {
        console.info(`[EmailService] Status-update notification sent to ${reporterEmail} for bug #${bugId} → ${statusLabel}`);
      }
    } catch (err) {
      console.error('[EmailService] sendStatusUpdateNotification unexpected error:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
