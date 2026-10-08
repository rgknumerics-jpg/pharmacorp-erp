export const APP_EVENTS_QUEUE = 'app-events';

export type AppEventJobName = 'user.created' | 'auth.login';

export interface AppEventJobData {
  tenantId: string;
  [key: string]: unknown;
}
