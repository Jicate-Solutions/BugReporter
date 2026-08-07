import { useContext } from 'react';
import {
  BugReporterContext,
  type BugReporterContextValue,
} from '../components/BugReporterProvider';

/**
 * The API client and configuration for the surrounding provider.
 *
 * Throws rather than returning null: every consumer of this hook needs the
 * client to do anything at all, so a missing provider is a wiring mistake worth
 * failing loudly on rather than a state to handle.
 */
export function useBugReporter(): BugReporterContextValue {
  const context = useContext(BugReporterContext);
  if (!context) {
    throw new Error('useBugReporter must be used within BugReporterProvider');
  }
  return context;
}
