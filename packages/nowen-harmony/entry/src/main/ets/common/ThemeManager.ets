import { PreferenceUtil } from '../utils/PreferenceUtil';

export class ThemeManager {
  private static readonly PREF_KEY_THEME: string = 'nowen_theme_mode';

  static readonly THEME_LIGHT: string = 'light';
  static readonly THEME_DARK: string = 'dark';
  static readonly THEME_SYSTEM: string = 'system';

  static async getThemeMode(): Promise<string> {
    return await PreferenceUtil.getString(ThemeManager.PREF_KEY_THEME, ThemeManager.THEME_SYSTEM);
  }

  static async setThemeMode(mode: string): Promise<void> {
    await PreferenceUtil.setString(ThemeManager.PREF_KEY_THEME, mode);
  }

  static isDarkMode(mode: string): boolean {
    if (mode === ThemeManager.THEME_DARK) return true;
    if (mode === ThemeManager.THEME_LIGHT) return false;
    return false;
  }
}

export class ColorTokens {
  static readonly LIGHT = {
    appBg: '#F5F5F5',
    surface: '#FFFFFF',
    sidebar: '#FAFAFA',
    border: '#E5E7EB',
    textPrimary: '#1F2937',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    primary: '#3B82F6',
    primaryDark: '#2563EB',
    danger: '#EF4444',
    warning: '#F59E0B',
    success: '#10B981',
  };

  static readonly DARK = {
    appBg: '#111111',
    surface: '#1F2937',
    sidebar: '#1A1A1A',
    border: '#374151',
    textPrimary: '#F9FAFB',
    textSecondary: '#D1D5DB',
    textTertiary: '#9CA3AF',
    primary: '#60A5FA',
    primaryDark: '#3B82F6',
    danger: '#F87171',
    warning: '#FBBF24',
    success: '#34D399',
  };
}

export class SpacingTokens {
  static readonly xs: number = 4;
  static readonly sm: number = 8;
  static readonly md: number = 12;
  static readonly lg: number = 16;
  static readonly xl: number = 24;
  static readonly xxl: number = 32;
  static readonly xxxl: number = 48;
}

export class RadiusTokens {
  static readonly sm: number = 4;
  static readonly md: number = 8;
  static readonly lg: number = 12;
  static readonly xl: number = 16;
  static readonly full: number = 999;
}

export class FontTokens {
  static readonly xs: number = 11;
  static readonly sm: number = 12;
  static readonly base: number = 14;
  static readonly md: number = 15;
  static readonly lg: number = 16;
  static readonly xl: number = 18;
  static readonly xxl: number = 20;
  static readonly title: number = 24;
  static readonly hero: number = 28;
}
