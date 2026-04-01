import { Resend } from 'resend';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  seen: 'Seen',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  wont_fix: "Won't Fix",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new:         { bg: '#dbeafe', text: '#1d4ed8' },
  seen:        { bg: '#f3f4f6', text: '#374151' },
  in_progress: { bg: '#fef3c7', text: '#b45309' },
  resolved:    { bg: '#dcfce7', text: '#15803d' },
  wont_fix:    { bg: '#fee2e2', text: '#dc2626' },
};

const CLOSED_STATUSES = new Set(['resolved', 'wont_fix']);

function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

function getSenderAddress(): string {
  return process.env.NOTIFICATION_FROM_EMAIL || 'noreply@bugreporter.dev';
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function baseLayout(title: string, previewText: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background-color:#09090b;border-radius:12px 12px 0 0;padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Bug<span style="color:#a78bfa;">Reporter</span></span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px;color:#71717a;letter-spacing:0.5px;text-transform:uppercase;">Automated Notification</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 28px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">This email was sent by BugReporter. You are receiving this because you are associated with this project.</p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">&copy; ${new Date().getFullYear()} BugReporter. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Reusable building blocks (all inline styles for email client compat)
// ---------------------------------------------------------------------------

function infoRow(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:140px;">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">${label}</span>
    </td>
    <td style="padding:10px 0 10px 16px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
      <span style="font-size:14px;color:#1e293b;line-height:1.5;word-break:break-word;">${value}</span>
    </td>
  </tr>`;
}

function statusBadge(status: string): string {
  const label = STATUS_LABELS[status] ?? status;
  const colors = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#374151' };
  return `<span style="display:inline-block;padding:3px 12px;border-radius:9999px;font-size:12px;font-weight:600;background-color:${colors.bg};color:${colors.text};">${label}</span>`;
}

function ctaButton(href: string, label: string, primary = true): string {
  const bg = primary ? '#09090b' : 'transparent';
  const color = primary ? '#ffffff' : '#09090b';
  const border = primary ? 'none' : '1px solid #d1d5db';
  return `<a href="${href}" style="display:inline-block;padding:12px 24px;background-color:${bg};color:${color};font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;border:${border};">${label} &rarr;</a>`;
}

function severityDot(category: string): string {
  const dotColors: Record<string, string> = {
    bug: '#ef4444',
    feature_request: '#3b82f6',
    ui_design: '#8b5cf6',
    performance: '#f59e0b',
    security: '#dc2626',
    other: '#6b7280',
  };
  const color = dotColors[category] ?? '#6b7280';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${color};margin-right:6px;vertical-align:middle;"></span>`;
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
  category?: string;
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
      category = 'bug',
    } = params;

    const greeting = developerName ? `Hi ${developerName},` : 'Hi there,';
    const reporterDisplay = reporterName || reporterEmail || 'Anonymous';
    const shortId = bugId.slice(0, 8).toUpperCase();

    const bodyContent = `
      <!-- Alert bar -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="background-color:#fef2f2;border-left:4px solid #ef4444;border-radius:0 6px 6px 0;padding:12px 16px;">
            <span style="font-size:13px;font-weight:600;color:#dc2626;">&#9888; Action Required</span>
            <span style="font-size:13px;color:#7f1d1d;margin-left:8px;">A new bug has been submitted and requires your attention.</span>
          </td>
        </tr>
      </table>

      <!-- Headline -->
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">New Bug Reported</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">${greeting} A bug has been submitted for <strong style="color:#0f172a;">${escapeHtml(appName)}</strong> under <strong style="color:#0f172a;">${escapeHtml(orgName)}</strong>.</p>

      <!-- Bug title card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;background-color:#fafafa;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:16px 20px 12px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Bug Title</p>
            <p style="margin:0;font-size:17px;font-weight:700;color:#0f172a;line-height:1.4;">${escapeHtml(bugTitle)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 16px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Description</p>
            <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">${escapeHtml(bugDescription)}</p>
          </td>
        </tr>
      </table>

      <!-- Details grid -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:16px 20px 0;background-color:#f8fafc;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;">Bug Details</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 16px;background-color:#f8fafc;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${infoRow('Bug ID', `<span style="font-family:monospace;background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:13px;">#${shortId}</span>`)}
              ${infoRow('Category', `${severityDot(category)}<span style="font-size:14px;color:#1e293b;text-transform:capitalize;">${escapeHtml(category.replace('_', ' '))}</span>`)}
              ${infoRow('Reported by', escapeHtml(reporterDisplay))}
              ${infoRow('Application', escapeHtml(appName))}
              ${infoRow('Organization', escapeHtml(orgName))}
              ${infoRow('Page URL', `<a href="${escapeHtml(pageUrl)}" style="color:#7c3aed;text-decoration:none;font-size:13px;">${escapeHtml(pageUrl.length > 55 ? pageUrl.slice(0, 55) + '…' : pageUrl)}</a>`)}
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-top:4px;">
            ${ctaButton(dashboardUrl, 'View Bug in Dashboard')}
          </td>
        </tr>
      </table>
    `;

    const html = baseLayout(
      `New Bug: ${bugTitle}`,
      `${reporterDisplay} reported a bug in ${appName}: ${bugTitle}`,
      bodyContent
    );

    try {
      const resend = getResendClient();
      const { error } = await resend.emails.send({
        from: getSenderAddress(),
        to: developerEmail,
        subject: `🐛 New Bug: ${bugTitle} — ${appName}`,
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
    const colors = STATUS_COLORS[newStatus] ?? { bg: '#f3f4f6', text: '#374151' };
    const isClosed = CLOSED_STATUSES.has(newStatus);
    const shortId = bugId.slice(0, 8).toUpperCase();

    const timelineSteps = [
      { key: 'new',         label: 'Submitted' },
      { key: 'seen',        label: 'Reviewed' },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'resolved',    label: 'Resolved' },
    ];
    const currentIdx = timelineSteps.findIndex(s => s.key === newStatus);
    const timelineHtml = timelineSteps.map((step, i) => {
      const isActive = i === currentIdx;
      const isDone = i < currentIdx;
      const dotBg = isActive ? colors.bg : isDone ? '#dcfce7' : '#f1f5f9';
      const dotBorder = isActive ? colors.text : isDone ? '#15803d' : '#cbd5e1';
      const textColor = isActive ? colors.text : isDone ? '#15803d' : '#94a3b8';
      const fontWeight = isActive ? '700' : isDone ? '500' : '400';
      return `
        <td align="center" style="width:25%;">
          <div style="width:28px;height:28px;border-radius:50%;background-color:${dotBg};border:2px solid ${dotBorder};margin:0 auto 6px;display:inline-block;line-height:24px;text-align:center;">
            ${isDone ? `<span style="font-size:12px;color:#15803d;">&#10003;</span>` : isActive ? `<span style="font-size:10px;color:${colors.text};">&#9679;</span>` : ''}
          </div>
          <p style="margin:0;font-size:11px;font-weight:${fontWeight};color:${textColor};">${step.label}</p>
        </td>`;
    }).join(`<td style="padding-bottom:18px;"><hr style="border:none;border-top:2px dashed #e2e8f0;margin:14px 0 0;" /></td>`);

    const noteBlock = developerNote
      ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
          <tr>
            <td style="background-color:#fafafa;border-left:4px solid #a78bfa;border-radius:0 8px 8px 0;padding:14px 18px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#7c3aed;">Note from the Team</p>
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${escapeHtml(developerNote)}</p>
            </td>
          </tr>
        </table>`
      : '';

    const closedBlock = isClosed
      ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
          <tr>
            <td style="background-color:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px 18px;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#78350f;">Is your issue still unresolved?</p>
              <p style="margin:0 0 14px;font-size:13px;color:#92400e;line-height:1.5;">If the problem persists, please provide more details and contact the support team.</p>
              ${bugViewUrl ? ctaButton(bugViewUrl, 'Contact Support', false) : ''}
            </td>
          </tr>
        </table>`
      : (bugViewUrl
          ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td>${ctaButton(bugViewUrl, 'View Your Bug Report')}</td></tr></table>`
          : '');

    const bodyContent = `
      <!-- Status banner -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="background-color:${colors.bg};border-radius:8px;padding:14px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:${colors.text};">Status Updated</p>
                  <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${colors.text};">${statusLabel}</p>
                </td>
                <td align="right" style="font-size:32px;">
                  ${newStatus === 'resolved' ? '&#10003;' : newStatus === 'wont_fix' ? '&#10005;' : newStatus === 'in_progress' ? '&#9881;' : newStatus === 'seen' ? '&#128065;' : '&#128276;'}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Headline -->
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">Your Bug Report Has Been Updated</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">${greeting} We have an update on your bug report for <strong style="color:#0f172a;">${escapeHtml(appName)}</strong>.</p>

      <!-- Bug summary card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:16px 20px 12px;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Bug Report</p>
            <p style="margin:0 0 10px;font-size:17px;font-weight:700;color:#0f172a;line-height:1.4;">${escapeHtml(bugTitle)}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${infoRow('ID', `<span style="font-family:monospace;background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:13px;">#${shortId}</span>`)}
              ${infoRow('Application', escapeHtml(appName))}
              ${infoRow('Organization', escapeHtml(orgName))}
              ${infoRow('New Status', statusBadge(newStatus))}
            </table>
          </td>
        </tr>
      </table>

      <!-- Progress timeline (skip for wont_fix) -->
      ${newStatus !== 'wont_fix' ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:16px 20px 20px;background-color:#fafafa;">
            <p style="margin:0 0 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;">Progress</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>${timelineHtml}</tr>
            </table>
          </td>
        </tr>
      </table>` : ''}

      ${noteBlock}
      ${closedBlock}
    `;

    const html = baseLayout(
      `Bug Update: ${bugTitle}`,
      `Your bug report "${bugTitle}" status has changed to ${statusLabel}`,
      bodyContent
    );

    try {
      const resend = getResendClient();
      const { error } = await resend.emails.send({
        from: getSenderAddress(),
        to: reporterEmail,
        subject: `[${statusLabel}] Your bug report has been updated — ${bugTitle}`,
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
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
