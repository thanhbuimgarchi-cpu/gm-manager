import { App } from "@capacitor/app";
import { Capacitor, CapacitorHttp, type PermissionState as NativePermissionState } from "@capacitor/core";
import { Geolocation, type PermissionStatus as NativeLocationStatus } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { NativeMobileBridge } from "../app/mobile-bridge";

const notificationChannel = "gm-manager-updates";

function locationPermission({ location, coarseLocation }: NativeLocationStatus): PermissionState {
  if (location === "granted" || coarseLocation === "granted") return "granted";
  if (location === "denied" && coarseLocation === "denied") return "denied";
  return "prompt";
}

function notificationPermission(display: NativePermissionState): NotificationPermission {
  return display === "granted" || display === "denied" ? display : "default";
}

function locationErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 1 || code === "OS-PLUG-GLOC-0003" || code === "OS-PLUG-GLOC-0008") return 1;
  if (code === "OS-PLUG-GLOC-0010") return 3;
  return 2;
}

function notificationId(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash, 31) + key.charCodeAt(index) | 0;
  return (hash & 0x7fffffff) || 1;
}

function openNotificationTarget(value: unknown) {
  if (typeof value !== "string") return;
  const current = new URL(window.location.href);
  try {
    const target = new URL(value, current);
    if (target.protocol !== current.protocol || target.host !== current.host || target.username || target.password) return;
    if (target.pathname !== "/" && target.pathname !== "/index.html") return;
    if (target.href !== current.href) window.location.assign(target.href);
  } catch { /* Ignore invalid notification URLs. */ }
}

export function installNativeMobileBridge() {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return;

  const bridge: NativeMobileBridge = {
    platform,
    async checkLocationPermission() {
      return locationPermission(await Geolocation.checkPermissions());
    },
    async getPosition(options) {
      try {
        let status = await Geolocation.checkPermissions();
        if (locationPermission(status) === "prompt") {
          status = await Geolocation.requestPermissions({ permissions: ["location"] });
        }
        if (locationPermission(status) !== "granted") throw Object.assign(new Error("Chưa được cấp quyền vị trí."), { code: 1 });
        return await Geolocation.getCurrentPosition({
          timeout: options.timeout,
          maximumAge: options.maximumAge,
          enableHighAccuracy: Boolean(options.enableHighAccuracy && status.location === "granted"),
        });
      } catch (error) {
        throw Object.assign(new Error("Không lấy được vị trí."), { code: locationErrorCode(error) });
      }
    },
    async checkNotificationPermission() {
      return notificationPermission((await LocalNotifications.checkPermissions()).display);
    },
    async requestNotificationPermission() {
      return notificationPermission((await LocalNotifications.requestPermissions()).display);
    },
    async showNotification({ title, body, url, tag }) {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") return false;
      if (platform === "android") {
        await LocalNotifications.createChannel({ id: notificationChannel, name: "GM Manager", importance: 4 });
      }
      const id = notificationId(tag || crypto.randomUUID());
      const result = await LocalNotifications.schedule({
        notifications: [{ id, title, body, channelId: notificationChannel, foreground: true, isExactNotification: false, extra: { url } }],
      });
      return result.notifications.some((notification) => notification.id === id);
    },
    async postAppsScript(url, payload) {
      const endpoint = new URL(url);
      if (endpoint.origin !== "https://script.google.com" || endpoint.username || endpoint.password || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname)) {
        throw new Error("Đường dẫn Google Apps Script không hợp lệ.");
      }
      const response = await CapacitorHttp.post({
        url: endpoint.href,
        headers: { "Content-Type": "text/plain;charset=UTF-8", Accept: "application/json" },
        data: JSON.stringify(payload),
        connectTimeout: 15_000,
        readTimeout: String(payload.action ?? "").includes("audio") ? 180_000 : 90_000,
        responseType: "text",
      });
      return { status: response.status, data: response.data };
    },
  };

  window.gmMobile = bridge;
  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event("focus"));
  }).catch(() => {});
  void LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
    openNotificationTarget(notification.extra?.url);
  }).catch(() => {});
}
