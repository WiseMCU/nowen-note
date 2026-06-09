import { Capacitor } from "@capacitor/core";

interface CapacitorPluginHeader {
  name?: string;
}

export function hasNativePlugin(pluginName: string): boolean {
  try {
    if (!Capacitor.isNativePlatform()) return false;
    const headers = (globalThis as any).Capacitor?.PluginHeaders;
    return Array.isArray(headers)
      && headers.some((header: CapacitorPluginHeader) => header?.name === pluginName);
  } catch {
    return false;
  }
}

export function hasAllNativePlugins(pluginNames: string[]): boolean {
  return pluginNames.every((pluginName) => hasNativePlugin(pluginName));
}

export function hasSecureStorageNativePlugin(): boolean {
  return hasNativePlugin("SecureStorage");
}

export function hasBiometricAuthNativePlugin(): boolean {
  return hasNativePlugin("BiometricAuthNative");
}

export function hasQuickLoginNativePlugins(): boolean {
  return hasAllNativePlugins(["SecureStorage", "BiometricAuthNative"]);
}

export function hasZeroConfNativePlugin(): boolean {
  return hasNativePlugin("ZeroConf");
}

export function hasClipboardNativePlugin(): boolean {
  return hasNativePlugin("Clipboard");
}
