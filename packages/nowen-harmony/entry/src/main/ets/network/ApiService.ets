import { HttpClient } from '../network/HttpClient';
import {
  User, Notebook, Note, NoteListItem, Tag, SearchResult,
  Task, TaskStats, TaskFilter, Share, SiteSettings
} from '../model/DataModels';

const http = HttpClient.getInstance();

export class ApiService {
  static async initBaseUrl(): Promise<void> {
    const serverUrl = await import('../constants/Constants').then(m => m.Constants.getServerUrl());
    if (serverUrl) {
      http.setBaseUrl(serverUrl);
    }
  }

  // ========== 认证 ==========
  static async login(username: string, password: string): Promise<{ token: string; user: User }> {
    return http.post('/auth/login', { username, password });
  }

  static async register(username: string, password: string): Promise<{ token: string; user: User }> {
    return http.post('/auth/register', { username, password });
  }

  static async verifyToken(): Promise<User> {
    return http.get('/me');
  }

  static async logout(): Promise<void> {
    try {
      await http.post('/auth/logout');
    } catch (e) {
      // ignore
    }
  }

  static async getRegisterConfig(): Promise<{ allowRegistration: boolean }> {
    try {
      return await http.get('/auth/register/config');
    } catch (e) {
      return { allowRegistration: true };
    }
  }

  // ========== 站点设置（无需认证） ==========
  static async getSiteSettingsPublic(): Promise<SiteSettings> {
    try {
      return await http.get('/settings');
    } catch (e) {
      return { site_title: 'Nowen Note', site_favicon: '', editor_font_family: '' };
    }
  }

  // ========== 用户 ==========
  static async getMe(): Promise<User> {
    return http.get('/me');
  }

  // ========== 笔记本 ==========
  static async getNotebooks(workspaceId?: string): Promise<Notebook[]> {
    const ws = workspaceId || (await import('../constants/Constants').then(m => m.Constants.getWorkspace()));
    const qs = ws ? `?workspaceId=${encodeURIComponent(ws)}` : '';
    return http.get(`/notebooks${qs}`);
  }

  static async createNotebook(data: Partial<Notebook>): Promise<Notebook> {
    return http.post('/notebooks', data);
  }

  static async updateNotebook(id: string, data: Partial<Notebook>): Promise<Notebook> {
    return http.put(`/notebooks/${id}`, data);
  }

  static async deleteNotebook(id: string): Promise<void> {
    return http.del(`/notebooks/${id}`);
  }

  static async moveNotebook(id: string, data: { parentId?: string | null; sortOrder?: number }): Promise<Notebook> {
    return http.put(`/notebooks/${id}/move`, data);
  }

  // ========== 笔记 ==========
  static async getNotes(params?: Record<string, string>): Promise<NoteListItem[]> {
    const finalParams: Record<string, string> = { ...(params || {}) };
    if (!('workspaceId' in finalParams)) {
      const ws = await import('../constants/Constants').then(m => m.Constants.getWorkspace());
      finalParams.workspaceId = ws;
    }
    const qs = '?' + Object.entries(finalParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return http.get(`/notes${qs}`);
  }

  static async getNote(id: string): Promise<Note> {
    return http.get(`/notes/${id}`);
  }

  static async createNote(data: Partial<Note>): Promise<Note> {
    return http.post('/notes', data);
  }

  static async updateNote(id: string, data: Partial<Note>): Promise<Note> {
    return http.put(`/notes/${id}`, data);
  }

  static async deleteNote(id: string): Promise<void> {
    return http.del(`/notes/${id}`);
  }

  static async emptyTrash(): Promise<{ success: boolean; count: number }> {
    return http.del('/notes/trash/empty');
  }

  // ========== 标签 ==========
  static async getTags(): Promise<Tag[]> {
    return http.get('/tags');
  }

  static async createTag(data: Partial<Tag>): Promise<Tag> {
    return http.post('/tags', data);
  }

  static async updateTag(id: string, data: Partial<Tag>): Promise<Tag> {
    return http.put(`/tags/${id}`, data);
  }

  static async deleteTag(id: string): Promise<void> {
    return http.del(`/tags/${id}`);
  }

  static async addTagToNote(noteId: string, tagId: string): Promise<void> {
    return http.post(`/tags/note/${noteId}/tag/${tagId}`);
  }

  static async removeTagFromNote(noteId: string, tagId: string): Promise<void> {
    return http.del(`/tags/note/${noteId}/tag/${tagId}`);
  }

  // ========== 搜索 ==========
  static async search(query: string): Promise<SearchResult[]> {
    return http.get(`/search?q=${encodeURIComponent(query)}`);
  }

  // ========== 任务 ==========
  static async getTasks(filter?: TaskFilter, noteId?: string): Promise<Task[]> {
    const params: string[] = [];
    if (filter && filter !== 'all') params.push(`filter=${filter}`);
    if (noteId) params.push(`noteId=${noteId}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return http.get(`/tasks${qs}`);
  }

  static async createTask(data: Partial<Task>): Promise<Task> {
    return http.post('/tasks', data);
  }

  static async updateTask(id: string, data: Partial<Task>): Promise<Task> {
    return http.put(`/tasks/${id}`, data);
  }

  static async toggleTask(id: string): Promise<Task> {
    return http.patch(`/tasks/${id}/toggle`);
  }

  static async deleteTask(id: string): Promise<void> {
    return http.del(`/tasks/${id}`);
  }

  static async getTaskStats(): Promise<TaskStats> {
    return http.get('/tasks/stats/summary');
  }

  // ========== 分享 ==========
  static async createShare(data: { noteId: string; permission?: string; password?: string; expiresAt?: string }): Promise<Share> {
    return http.post('/shares', data);
  }

  static async getShares(): Promise<Share[]> {
    return http.get('/shares');
  }

  static async getSharesByNote(noteId: string): Promise<Share[]> {
    return http.get(`/shares/note/${noteId}`);
  }

  static async deleteShare(id: string): Promise<void> {
    return http.del(`/shares/${id}`);
  }

  // ========== 设置 ==========
  static async getSiteSettings(): Promise<SiteSettings> {
    return http.get('/settings');
  }

  static async updateSiteSettings(data: Partial<SiteSettings>): Promise<SiteSettings> {
    return http.put('/settings', data);
  }

  // ========== 附件 ==========
  static getAttachmentUrl(id: string): string {
    return `${http.getBaseUrl()}/attachments/${id}`;
  }

  static async uploadAttachment(noteId: string, filePath: string): Promise<{ id: string; url: string; mimeType: string; size: number }> {
    return http.upload('/attachments', filePath, 'file', { noteId });
  }

  static async deleteAttachment(id: string): Promise<void> {
    return http.del(`/attachments/${id}`);
  }

  // ========== 健康检查 ==========
  static async healthCheck(): Promise<boolean> {
    try {
      await http.get('/health');
      return true;
    } catch (e) {
      return false;
    }
  }
}
