export type NativeMobilePosition = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
};

export type NativeMobileNotification = { title: string; body: string; url: string; tag?: string };

export type NativeMobileBridge = {
  platform: "android" | "ios";
  checkLocationPermission(): Promise<PermissionState>;
  getPosition(options: PositionOptions): Promise<NativeMobilePosition>;
  checkNotificationPermission(): Promise<NotificationPermission>;
  requestNotificationPermission(): Promise<NotificationPermission>;
  showNotification(notification: NativeMobileNotification): Promise<boolean>;
  postAppsScript(url: string, payload: Record<string, unknown>): Promise<{ status: number; data: unknown }>;
};

declare global {
  interface Window {
    gmMobile?: NativeMobileBridge;
  }
}

export function mobileBridge() {
  return typeof window === "undefined" ? undefined : window.gmMobile;
}
