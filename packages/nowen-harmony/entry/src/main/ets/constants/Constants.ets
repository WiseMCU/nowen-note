import { PreferenceUtil } from './PreferenceUtil';

export class Constants {
  static readonly APP_NAME: string = 'Nowen Note';
  static readonly APP_VERSION: string = '1.0.0';

  static readonly PREF_KEY_SERVER_URL: string = 'nowen_server_url';
  static readonly PREF_KEY_TOKEN: string = 'nowen_token';
  static readonly PREF_KEY_USERNAME: string = 'nowen_username';
  static readonly PREF_KEY_WORKSPACE: string = 'nowen_workspace';

  static readonly DEFAULT_SERVER_URL: string = 'http://192.168.1.100:3001';

  static async getServerUrl(): Promise<string> {
    return await PreferenceUtil.getString(Constants.PREF_KEY_SERVER_URL, '');
  }

  static async setServerUrl(url: string): Promise<void> {
    const normalized = url.replace(/\/+$/, '');
    await PreferenceUtil.setString(Constants.PREF_KEY_SERVER_URL, normalized);
  }

  static async getToken(): Promise<string> {
    return await PreferenceUtil.getString(Constants.PREF_KEY_TOKEN, '');
  }

  static async setToken(token: string): Promise<void> {
    await PreferenceUtil.setString(Constants.PREF_KEY_TOKEN, token);
  }

  static async clearToken(): Promise<void> {
    await PreferenceUtil.remove(Constants.PREF_KEY_TOKEN);
  }

  static async getUsername(): Promise<string> {
    return await PreferenceUtil.getString(Constants.PREF_KEY_USERNAME, '');
  }

  static async setUsername(username: string): Promise<void> {
    await PreferenceUtil.setString(Constants.PREF_KEY_USERNAME, username);
  }

  static async getWorkspace(): Promise<string> {
    return await PreferenceUtil.getString(Constants.PREF_KEY_WORKSPACE, 'personal');
  }

  static async setWorkspace(workspaceId: string): Promise<void> {
    await PreferenceUtil.setString(Constants.PREF_KEY_WORKSPACE, workspaceId);
  }
}
