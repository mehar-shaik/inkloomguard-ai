export type DemoAvailabilityStatus = 'loading' | 'available' | 'unavailable' | 'error';

export const DEFAULT_DEMO_ORG_LABEL = 'AetherFlow Systems';
export const DEFAULT_DEMO_UNAVAILABLE_MESSAGE =
  'Pre-seeded organization sign-in is currently unavailable in this environment. Please sign in with your work email and password or create a new workspace.';
export const DEFAULT_DEMO_ERROR_MESSAGE =
  'Unable to verify pre-seeded organization availability right now. Please sign in with your work email and password or create a new workspace.';

export interface DemoAvailabilityState {
  status: DemoAvailabilityStatus;
  organizationName: string;
  message: string | null;
}

export function isDemoLoginVisible(status: DemoAvailabilityStatus): boolean {
  return status === 'available';
}

export function parseDemoAvailabilityFromHealth(payload: unknown): DemoAvailabilityStatus {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { demoAvailable?: unknown }).demoAvailable === true
  ) {
    return 'available';
  }
  return 'unavailable';
}

export function parseDemoAvailabilityDetails(payload: unknown): DemoAvailabilityState {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          demoAvailable?: unknown;
          demoOrganizationName?: unknown;
          demoMessage?: unknown;
        })
      : null;

  const organizationName =
    typeof obj?.demoOrganizationName === 'string' && obj.demoOrganizationName.trim()
      ? obj.demoOrganizationName.trim()
      : DEFAULT_DEMO_ORG_LABEL;

  if (obj?.demoAvailable === true) {
    return {
      status: 'available',
      organizationName,
      message: null,
    };
  }

  const serverMessage =
    typeof obj?.demoMessage === 'string' && obj.demoMessage.trim()
      ? obj.demoMessage.trim()
      : DEFAULT_DEMO_UNAVAILABLE_MESSAGE;

  return {
    status: 'unavailable',
    organizationName,
    message: serverMessage,
  };
}

export async function fetchDemoAvailability(
  loadHealth: () => Promise<unknown>
): Promise<DemoAvailabilityStatus> {
  try {
    const health = await loadHealth();
    return parseDemoAvailabilityFromHealth(health);
  } catch {
    return 'error';
  }
}

export async function fetchDemoAvailabilityDetails(
  loadHealth: () => Promise<unknown>
): Promise<DemoAvailabilityState> {
  try {
    const health = await loadHealth();
    return parseDemoAvailabilityDetails(health);
  } catch {
    return {
      status: 'error',
      organizationName: DEFAULT_DEMO_ORG_LABEL,
      message: DEFAULT_DEMO_ERROR_MESSAGE,
    };
  }
}
