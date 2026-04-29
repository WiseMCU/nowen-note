import dataPreferences from '@ohos.data.preferences';

const PREFERENCE_NAME = 'nowen_note_prefs';

export class PreferenceUtil {
  private static preference: dataPreferences.Preferences | null = null;

  static async init(context: Context): Promise<void> {
    try {
      PreferenceUtil.preference = await dataPreferences.getPreferences(context, PREFERENCE_NAME);
    } catch (e) {
      console.error('[PreferenceUtil] init failed:', e);
    }
  }

  static async getString(key: string, defaultValue: string = ''): Promise<string> {
    if (!PreferenceUtil.preference) return defaultValue;
    try {
      return await PreferenceUtil.preference.get(key, defaultValue) as string;
    } catch (e) {
      return defaultValue;
    }
  }

  static async setString(key: string, value: string): Promise<void> {
    if (!PreferenceUtil.preference) return;
    try {
      await PreferenceUtil.preference.put(key, value);
      await PreferenceUtil.preference.flush();
    } catch (e) {
      console.error('[PreferenceUtil] setString failed:', e);
    }
  }

  static async getNumber(key: string, defaultValue: number = 0): Promise<number> {
    if (!PreferenceUtil.preference) return defaultValue;
    try {
      return await PreferenceUtil.preference.get(key, defaultValue) as number;
    } catch (e) {
      return defaultValue;
    }
  }

  static async setNumber(key: string, value: number): Promise<void> {
    if (!PreferenceUtil.preference) return;
    try {
      await PreferenceUtil.preference.put(key, value);
      await PreferenceUtil.preference.flush();
    } catch (e) {
      console.error('[PreferenceUtil] setNumber failed:', e);
    }
  }

  static async getBoolean(key: string, defaultValue: boolean = false): Promise<boolean> {
    if (!PreferenceUtil.preference) return defaultValue;
    try {
      return await PreferenceUtil.preference.get(key, defaultValue) as boolean;
    } catch (e) {
      return defaultValue;
    }
  }

  static async setBoolean(key: string, value: boolean): Promise<void> {
    if (!PreferenceUtil.preference) return;
    try {
      await PreferenceUtil.preference.put(key, value);
      await PreferenceUtil.preference.flush();
    } catch (e) {
      console.error('[PreferenceUtil] setBoolean failed:', e);
    }
  }

  static async remove(key: string): Promise<void> {
    if (!PreferenceUtil.preference) return;
    try {
      await PreferenceUtil.preference.delete(key);
      await PreferenceUtil.preference.flush();
    } catch (e) {
      console.error('[PreferenceUtil] remove failed:', e);
    }
  }

  static async clear(): Promise<void> {
    if (!PreferenceUtil.preference) return;
    try {
      await PreferenceUtil.preference.clear();
      await PreferenceUtil.preference.flush();
    } catch (e) {
      console.error('[PreferenceUtil] clear failed:', e);
    }
  }
}
