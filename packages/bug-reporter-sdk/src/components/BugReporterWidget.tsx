'use client';

import { useState, type CSSProperties, type MouseEvent } from 'react';
import {
  AlertCircle,
  Bug,
  Camera,
  FileText,
  Palette,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Attachment, BugReportCategory } from '@boobalan_jkkn/shared';
import { useBugReporter } from '../hooks/useBugReporter';
import { captureScreenshot } from '../utils/screenshot';
import { consoleLogger } from '../utils/console-logger';
import { getNetworkInterceptor } from '../utils/network-interceptor';
import { FileUploadInput } from './FileUploadInput';

const styles: Record<string, CSSProperties> = {
  floatingButton: {
    position: 'fixed',
    bottom: '1.5rem',
    right: '1.5rem',
    zIndex: 9999,
    width: '3.5rem',
    height: '3.5rem',
    borderRadius: '50%',
    backgroundColor: '#bf0a1c',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 10px 25px rgba(22, 163, 74, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
    padding: 0,
  },
  modal: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '1rem',
    animation: 'fadeIn 0.2s ease-in',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '0.75rem',
    padding: '0',
    maxWidth: '520px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
    animation: 'slideUp 0.3s ease-out',
  },
  header: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: '600',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#111827',
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    padding: '0.5rem',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    width: '2rem',
    height: '2rem',
  },
  formContainer: { padding: '1.5rem' },
  formGroup: { marginBottom: '1.25rem' },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    marginBottom: '0.75rem',
    color: '#374151',
  },
  requiredStar: { color: '#ef4444', marginLeft: '0.125rem' },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    outline: 'none',
    boxSizing: 'border-box',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.75rem',
  },
  categoryCard: {
    padding: '1rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'white',
  },
  categoryCardSelected: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
    borderWidth: '2px',
  },
  categoryIcon: {
    width: '2rem',
    height: '2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: '#374151',
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    resize: 'vertical',
    fontFamily: 'inherit',
    minHeight: '100px',
    transition: 'all 0.2s',
    outline: 'none',
    boxSizing: 'border-box',
  },
  helperText: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.5rem',
  },
  screenshotPreview: {
    marginTop: '0.75rem',
    borderRadius: '0.5rem',
    overflow: 'hidden',
    border: '1px solid #d1d5db',
  },
  screenshotLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.625rem 0.875rem',
    backgroundColor: '#f0fdf4',
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: '#15803d',
  },
  screenshotImage: {
    width: '100%',
    height: '160px',
    objectFit: 'cover',
    display: 'block',
  },
  submitButton: {
    padding: '0.875rem',
    background: '#16a34a',
    color: 'white',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.9375rem',
    fontWeight: '600',
    width: '100%',
    transition: 'all 0.2s',
    marginTop: '0.5rem',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
};

const categories: Array<{
  value: BugReportCategory;
  label: string;
  icon: typeof AlertCircle;
  color: string;
}> = [
  { value: 'bug', label: 'Bug/Issue', icon: AlertCircle, color: '#ef4444' },
  {
    value: 'feature_request',
    label: 'New Feature',
    icon: Sparkles,
    color: '#8b5cf6',
  },
  { value: 'ui_design', label: 'UI/Design', icon: Palette, color: '#f59e0b' },
  { value: 'performance', label: 'Performance', icon: Zap, color: '#eab308' },
  { value: 'security', label: 'Security', icon: Shield, color: '#06b6d4' },
  { value: 'other', label: 'Other', icon: FileText, color: '#6b7280' },
];

const WIDGET_CSS = `
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }

          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          /* Mobile Responsive Styles */
          @media (max-width: 640px) {
            .bug-reporter-sdk .bug-reporter-card {
              max-width: 100% !important;
              margin: 0.5rem !important;
              border-radius: 0.75rem !important;
            }

            .bug-reporter-sdk .bug-reporter-header {
              padding: 1rem !important;
            }

            .bug-reporter-sdk .bug-reporter-title {
              font-size: 1.125rem !important;
            }

            .bug-reporter-sdk .bug-reporter-form-container {
              padding: 1rem !important;
            }

            .bug-reporter-sdk .bug-reporter-floating-btn {
              bottom: 1rem !important;
              right: 1rem !important;
              width: 3rem !important;
              height: 3rem !important;
            }
          }

          /* Hover Effects */
          .bug-reporter-sdk .bug-reporter-floating-btn:hover:not(:disabled) {
            transform: scale(1.1) !important;
            box-shadow: 0 12px 30px rgba(22, 163, 74, 0.4) !important;
          }

          .bug-reporter-sdk .bug-reporter-floating-btn:active:not(:disabled) {
            transform: scale(0.95) !important;
          }

          /* Smooth Scrolling for Modal */
          .bug-reporter-sdk .bug-reporter-card {
            scrollbar-width: thin;
            scrollbar-color: #16a34a #f3f4f6;
          }

          .bug-reporter-sdk .bug-reporter-card::-webkit-scrollbar {
            width: 6px;
          }

          .bug-reporter-sdk .bug-reporter-card::-webkit-scrollbar-track {
            background: #f9fafb;
          }

          .bug-reporter-sdk .bug-reporter-card::-webkit-scrollbar-thumb {
            background: #16a34a;
            borderRadius: 3px;
          }

          .bug-reporter-sdk .bug-reporter-card::-webkit-scrollbar-thumb:hover {
            background: #15803d;
          }
        `;

/**
 * The floating bug button and the report form behind it.
 *
 * Reconstructed from the published 1.3.2 bundle. The screenshot is taken when
 * the button is clicked, before the form opens, so the capture shows the page
 * as the reporter saw it rather than the form covering it.
 */
export function BugReporterWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<BugReportCategory>('bug');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const { apiClient, config } = useBugReporter();

  const resetForm = () => {
    setIsOpen(false);
    setTitle('');
    setDescription('');
    setCategory('bug');
    setScreenshot('');
    setAttachments([]);
  };

  const handleOpenWidget = async () => {
    setIsCapturing(true);
    try {
      const captured = await captureScreenshot();
      setScreenshot(captured);
      setIsOpen(true);
      toast.success('Screenshot captured successfully!');
    } catch (error) {
      console.error('[BugReporter SDK] Screenshot failed:', error);
      toast.error('Failed to capture screenshot. Please try again.', {
        duration: 5000,
      });
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSubmit = async () => {
    if (!apiClient) {
      toast.error('Bug Reporter not initialized');
      return;
    }
    if (!title || title.trim().length < 5) {
      toast.error('Please provide a title (at least 5 characters)');
      return;
    }
    if (!description || description.trim().length < 10) {
      toast.error('Please provide at least 10 characters description');
      return;
    }
    if (!screenshot || screenshot.trim().length === 0) {
      toast.error(
        'Screenshot is required! Please close and reopen to capture screenshot.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const consoleLogs = consoleLogger.getLogs();
      if (consoleLogs.length === 0) {
        console.warn(
          '[BugReporter SDK] No console logs captured, but proceeding with submission'
        );
      }

      const networkInterceptor = getNetworkInterceptor();
      const networkTrace = networkInterceptor?.getRequests() || [];

      const payload = {
        title: title.trim(),
        page_url: window.location.href,
        description: description.trim(),
        category,
        screenshot_data_url: screenshot,
        console_logs: consoleLogs,
        network_trace: networkTrace,
        attachments: attachments.length > 0 ? attachments : undefined,
        metadata: {
          userAgent: navigator.userAgent,
          screenResolution: `${screen.width}x${screen.height}`,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: new Date().toISOString(),
          consoleLogsCount: consoleLogs.length,
          networkRequestsCount: networkTrace.length,
          attachmentsCount: attachments.length,
        },
        // Include user context if provided
        reporter_email: config.userContext?.email,
        reporter_name: config.userContext?.name,
      };

      await apiClient.createBugReport(payload);

      consoleLogger.clearLogs();
      networkInterceptor?.clear();

      toast.success('Bug report submitted successfully!');
      resetForm();
    } catch (error) {
      console.error('[BugReporter SDK] Submit failed:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to submit bug report'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!config.enabled) return null;

  const submitBlocked =
    isSubmitting ||
    title.trim().length < 5 ||
    description.trim().length < 10 ||
    !screenshot;

  return (
    <>
      <style>{WIDGET_CSS}</style>

      <button
        onClick={handleOpenWidget}
        disabled={isCapturing}
        style={{
          ...styles.floatingButton,
          ...(isCapturing ? { transform: 'scale(0.9)' } : {}),
        }}
        className="bug-reporter-sdk bug-reporter-floating-btn bg-red-700 text-white"
        title="Report a Bug"
      >
        {isCapturing ? (
          <Camera size={28} strokeWidth={2} />
        ) : (
          <Bug size={28} strokeWidth={2} />
        )}
      </button>

      {isOpen && (
        <div style={styles.modal} className="bug-reporter-sdk" onClick={resetForm}>
          <div
            style={styles.card}
            className="bug-reporter-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.header} className="bug-reporter-header">
              <h2 style={styles.title} className="bug-reporter-title">
                <Bug size={22} strokeWidth={2.5} />
                JKKN Bug Bounty
              </h2>
              <button
                onClick={resetForm}
                style={styles.closeButton}
                onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                }}
                onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={styles.formContainer}
              className="bug-reporter-form-container"
            >
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Category
                  <span style={styles.requiredStar}>*</span>
                </label>
                <div style={styles.categoryGrid}>
                  {categories.map((cat) => {
                    const Icon = cat.icon;
                    const isSelected = category === cat.value;
                    return (
                      <div
                        key={cat.value}
                        style={{
                          ...styles.categoryCard,
                          ...(isSelected ? styles.categoryCardSelected : {}),
                        }}
                        onClick={() => setCategory(cat.value)}
                        onMouseEnter={(e: MouseEvent<HTMLDivElement>) => {
                          if (!isSelected) {
                            e.currentTarget.style.borderColor = '#d1d5db';
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e: MouseEvent<HTMLDivElement>) => {
                          if (!isSelected) {
                            e.currentTarget.style.borderColor = '#e5e7eb';
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        <div style={styles.categoryIcon}>
                          <Icon
                            size={28}
                            color={isSelected ? '#16a34a' : cat.color}
                            strokeWidth={2}
                          />
                        </div>
                        <div
                          style={{
                            ...styles.categoryLabel,
                            color: isSelected ? '#15803d' : '#374151',
                          }}
                        >
                          {cat.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Title
                  <span style={styles.requiredStar}>*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief summary of the issue"
                  style={styles.input}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#16a34a';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                />
                <div style={styles.helperText}>Minimum 5 characters required</div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Describe the issue
                  <span style={styles.requiredStar}>*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What went wrong? Please provide as much detail as possible..."
                  style={styles.textarea}
                  rows={4}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#16a34a';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                />
                <div style={styles.helperText}>
                  Minimum 10 characters required
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Screenshot
                  <span style={styles.requiredStar}>*</span>
                </label>
                {screenshot ? (
                  <div style={styles.screenshotPreview}>
                    <div style={styles.screenshotLabel}>
                      <Camera size={16} />
                      Screenshot Captured ✓
                    </div>
                    <img
                      src={screenshot}
                      alt="Screenshot Preview"
                      style={styles.screenshotImage}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '1rem',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      color: '#991b1b',
                    }}
                  >
                    ⚠️ Screenshot was not captured. Please close and click the bug
                    button again.
                  </div>
                )}
                <div style={styles.helperText}>
                  Screenshot is automatically captured when you open this form
                </div>
              </div>

              <FileUploadInput
                files={attachments}
                onChange={setAttachments}
                disabled={isSubmitting}
              />

              <button
                onClick={handleSubmit}
                disabled={submitBlocked}
                style={{
                  ...styles.submitButton,
                  ...(submitBlocked ? styles.buttonDisabled : {}),
                }}
                onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                  if (!submitBlocked) {
                    e.currentTarget.style.backgroundColor = '#15803d';
                  }
                }}
                onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.backgroundColor = '#16a34a';
                }}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
