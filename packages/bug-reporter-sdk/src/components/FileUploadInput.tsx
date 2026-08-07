'use client';

import { useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import type { Attachment } from '@boobalan_jkkn/shared';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
];

export interface FileUploadInputProps {
  files: Attachment[];
  onChange: (files: Attachment[]) => void;
  disabled?: boolean;
}

/**
 * File picker for the report form, with previews.
 *
 * Reconstructed from the published 1.3.2 bundle. Everything is inline-styled
 * because this renders inside a customer's application and cannot rely on a
 * stylesheet being present.
 */
export function FileUploadInput({
  files,
  onChange,
  disabled = false,
}: FileUploadInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File "${file.name}" exceeds maximum size of 10MB`,
      };
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return {
        valid: false,
        error: `File type "${file.type}" is not allowed`,
      };
    }
    return { valid: true };
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setError('');
    const selectedFiles = Array.from(event.target.files || []);

    if (files.length + selectedFiles.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files allowed`);
      return;
    }

    const newAttachments: Attachment[] = [];
    for (const file of selectedFiles) {
      const validation = validateFile(file);
      if (!validation.valid) {
        // One bad file does not discard the rest of the selection.
        setError(validation.error || 'Invalid file');
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        newAttachments.push({
          filename: file.name,
          filesize: file.size,
          filetype: file.type,
          data_url: dataUrl,
        });
      } catch (err) {
        console.error('[FileUpload] Error reading file:', err);
        setError(`Failed to read file: ${file.name}`);
      }
    }

    onChange([...files, ...newAttachments]);

    // Clear the input, or picking the same file twice in a row does nothing.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onChange(newFiles);
  };

  const isImage = (filetype: string) => filetype.startsWith('image/');

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pickerDisabled = disabled || files.length >= MAX_FILES;

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label
        style={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 500,
          marginBottom: '0.5rem',
          color: '#374151',
        }}
      >
        Attachments (Optional)
      </label>

      <div style={{ marginBottom: '0.75rem' }}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleFileChange}
          disabled={pickerDisabled}
          style={{ display: 'none' }}
          id="file-upload-input"
        />
        <label
          htmlFor="file-upload-input"
          style={{
            display: 'inline-block',
            padding: '0.5rem 1rem',
            backgroundColor: pickerDisabled ? '#e5e7eb' : '#3b82f6',
            color: pickerDisabled ? '#9ca3af' : '#ffffff',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: pickerDisabled ? 'not-allowed' : 'pointer',
            border: 'none',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e: MouseEvent<HTMLLabelElement>) => {
            if (!pickerDisabled) {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }
          }}
          onMouseLeave={(e: MouseEvent<HTMLLabelElement>) => {
            if (!pickerDisabled) {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }
          }}
        >
          📎 Choose Files
        </label>
        <span
          style={{
            marginLeft: '0.75rem',
            fontSize: '0.75rem',
            color: '#6b7280',
          }}
        >
          {files.length}/{MAX_FILES} files • Max 10MB each
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.375rem',
            marginBottom: '0.75rem',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#dc2626', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {files.length > 0 && (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          {files.map((file, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem',
                backgroundColor: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '0.375rem',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '3rem',
                  height: '3rem',
                  borderRadius: '0.375rem',
                  overflow: 'hidden',
                  backgroundColor: '#e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isImage(file.filetype) && file.data_url ? (
                  <img
                    src={file.data_url}
                    alt={file.filename}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: '1.5rem' }}>
                    {file.filetype === 'application/pdf' ? '📄' : '📎'}
                  </span>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#111827',
                    margin: 0,
                    marginBottom: '0.25rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {file.filename}
                </p>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0 }}>
                  {formatFileSize(file.filesize)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleRemoveFile(index)}
                disabled={disabled}
                style={{
                  flexShrink: 0,
                  padding: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  color: '#dc2626',
                  fontSize: '1.25rem',
                  lineHeight: 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
                  if (!disabled) {
                    e.currentTarget.style.backgroundColor = '#fee2e2';
                  }
                }}
                onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
                  if (!disabled) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
                aria-label={`Remove ${file.filename}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
        Allowed: Images (PNG, JPG, GIF, WebP), PDF, Text, CSV, JSON
      </p>
    </div>
  );
}
