export type DemoAvailabilityStatus = 'loading' | 'available' | 'unavailable' | 'error';

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
