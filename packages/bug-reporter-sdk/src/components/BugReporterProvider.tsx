'use client';

import { createContext, useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'react-hot-toast';
import { BugReporterApiClient } from '../api/client';
import { consoleLogger } from '../utils/console-logger';
import {
  createNetworkInterceptor,
  destroyNetworkInterceptor,
} from '../utils/network-interceptor';
import { BugReporterWidget } from './BugReporterWidget';

export interface BugReporterConfig {
  apiKey: string;
  apiUrl: string;
  enabled?: boolean;
  debug?: boolean;
  userContext?: {
    userId?: string;
    email?: string;
    name?: string;
  };
  /**
   * Enable automatic capture of network requests
   * @default true
   */
  networkCapture?: boolean;
  /**
   * Maximum number of network requests to store in circular buffer
   * @default 10
   */
  networkBufferSize?: number;
  /**
   * Custom regex patterns to exclude from network capture
   * SDK's own API calls are automatically excluded
   */
  networkExcludePatterns?: RegExp[];
}

export interface BugReporterContextValue {
  apiClient: BugReporterApiClient | null;
  config: BugReporterConfig;
  isEnabled: boolean;
}

export interface BugReporterProviderProps {
  children: ReactNode;
  apiKey: string;
  apiUrl: string;
  enabled?: boolean;
  debug?: boolean;
  userContext?: BugReporterConfig['userContext'];
  networkCapture?: boolean;
  networkBufferSize?: number;
  networkExcludePatterns?: RegExp[];
}

export const BugReporterContext = createContext<BugReporterContextValue | null>(
  null
);

/**
 * Wraps the application, owns the API client, and mounts the widget.
 *
 * Reconstructed from the published 1.3.2 bundle.
 */
export function BugReporterProvider({
  children,
  apiKey,
  apiUrl,
  enabled = true,
  debug = false,
  userContext,
  networkCapture,
  networkBufferSize,
  networkExcludePatterns,
}: BugReporterProviderProps) {
  const [apiClient, setApiClient] = useState<BugReporterApiClient | null>(null);

  const config: BugReporterConfig = {
    apiKey,
    apiUrl,
    enabled,
    debug,
    userContext,
    networkCapture,
    networkBufferSize,
    networkExcludePatterns,
  };

  useEffect(() => {
    if (enabled && apiKey && apiUrl) {
      const client = new BugReporterApiClient({ apiUrl, apiKey, debug });
      setApiClient(client);
      consoleLogger.startCapture();

      if (networkCapture !== false) {
        const interceptor = createNetworkInterceptor({
          bufferSize: networkBufferSize ?? 10,
          excludePatterns: [
            ...(networkExcludePatterns || []),
            // Auto-exclude SDK's own API endpoint
            new RegExp(apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          ],
        });
        interceptor.init();
        if (debug) {
          console.log('[BugReporter SDK] Network interceptor initialized');
        }
      }

      if (debug) {
        console.log('[BugReporter SDK] Initialized with config:', {
          apiUrl,
          enabled,
          hasUserContext: !!userContext,
          networkCapture: networkCapture !== false,
        });
        console.log('[BugReporter SDK] Console logging started');
      }
    }

    return () => {
      if (enabled) {
        consoleLogger.stopCapture();
        if (networkCapture !== false) {
          destroyNetworkInterceptor();
          if (debug) {
            console.log('[BugReporter SDK] Network interceptor destroyed');
          }
        }
        if (debug) {
          console.log('[BugReporter SDK] Console logging stopped');
        }
      }
    };
  }, [
    apiKey,
    apiUrl,
    enabled,
    debug,
    userContext,
    networkCapture,
    networkBufferSize,
    networkExcludePatterns,
  ]);

  return (
    <BugReporterContext.Provider
      value={{ apiClient, config, isEnabled: enabled }}
    >
      {children}
      {enabled && apiClient && <BugReporterWidget />}
      <Toaster
        position="top-right"
        // The container has no stable class of its own, and screenshots now
        // keep the page's overlays. Tag it so it is still recognised as ours
        // and stays out of the capture.
        containerClassName="bug-reporter-sdk"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#16a34a',
              secondary: '#fff',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </BugReporterContext.Provider>
  );
}
