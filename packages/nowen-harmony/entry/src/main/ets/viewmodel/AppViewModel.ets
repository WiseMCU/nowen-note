import { AppState } from '../model/AppState';
import { AppAction, AppActionType, appReducer } from '../model/AppReducer';
import { ApiService } from '../network/ApiService';
import { Constants } from '../constants/Constants';
import { Note, NoteListItem, TaskFilter } from '../model/DataModels';

export class AppViewModel {
  private static instance: AppViewModel;
  private _state: AppState = new AppState();
  private listeners: Set<() => void> = new Set();

  private constructor() {}

  static getInstance(): AppViewModel {
    if (!AppViewModel.instance) {
      AppViewModel.instance = new AppViewModel();
    }
    return AppViewModel.instance;
  }

  get state(): AppState {
    return this._state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  private dispatch(action: AppAction): void {
    this._state = appReducer(this._state, action);
    this.notify();
  }

  // ========== 初始化 ==========

  async init(): Promise<void> {
    await ApiService.initBaseUrl();
    const token = await Constants.getToken();
    if (token) {
      try {
        const user = await ApiService.verifyToken();
        this.dispatch(new AppAction(AppActionType.SET_USER, user));
        this.dispatch(new AppAction(AppActionType.SET_AUTHENTICATED, true));
        await this.loadInitialData();
      } catch (e) {
        await Constants.clearToken();
        this.dispatch(new AppAction(AppActionType.SET_AUTHENTICATED, false));
      }
    }
    try {
      const settings = await ApiService.getSiteSettingsPublic();
      this.dispatch(new AppAction(AppActionType.SET_SITE_SETTINGS, settings));
    } catch (e) {
      // ignore
    }
  }

  private async loadInitialData(): Promise<void> {
    this.dispatch(new AppAction(AppActionType.SET_LOADING, true));
    try {
      const [notebooks, tags] = await Promise.all([
        ApiService.getNotebooks(),
        ApiService.getTags()
      ]);
      this.dispatch(new AppAction(AppActionType.SET_NOTEBOOKS, notebooks));
      this.dispatch(new AppAction(AppActionType.SET_TAGS, tags));
      await this.loadNotes();
    } catch (e) {
      console.error('[AppViewModel] loadInitialData failed:', e);
    } finally {
      this.dispatch(new AppAction(AppActionType.SET_LOADING, false));
    }
  }

  // ========== 认证 ==========

  async login(username: string, password: string): Promise<boolean> {
    try {
      const result = await ApiService.login(username, password);
      await Constants.setToken(result.token);
      await Constants.setUsername(username);
      this.dispatch(new AppAction(AppActionType.SET_USER, result.user));
      this.dispatch(new AppAction(AppActionType.SET_AUTHENTICATED, true));
      await this.loadInitialData();
      return true;
    } catch (e) {
      console.error('[AppViewModel] login failed:', e);
      throw e;
    }
  }

  async register(username: string, password: string): Promise<boolean> {
    try {
      const result = await ApiService.register(username, password);
      await Constants.setToken(result.token);
      await Constants.setUsername(username);
      this.dispatch(new AppAction(AppActionType.SET_USER, result.user));
      this.dispatch(new AppAction(AppActionType.SET_AUTHENTICATED, true));
      await this.loadInitialData();
      return true;
    } catch (e) {
      console.error('[AppViewModel] register failed:', e);
      throw e;
    }
  }

  async logout(): Promise<void> {
    await ApiService.logout();
    await Constants.clearToken();
    await Constants.remove(Constants.PREF_KEY_USERNAME);
    this.dispatch(new AppAction(AppActionType.SET_USER, null));
    this.dispatch(new AppAction(AppActionType.SET_AUTHENTICATED, false));
    this.dispatch(new AppAction(AppActionType.SET_NOTES, []));
    this.dispatch(new AppAction(AppActionType.SET_NOTEBOOKS, []));
    this.dispatch(new AppAction(AppActionType.SET_TAGS, []));
    this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, null));
  }

  // ========== 笔记 ==========

  async loadNotes(): Promise<void> {
    try {
      const params: Record<string, string> = {};
      const vm = this._state.viewMode;

      if (vm === 'notebook' && this._state.selectedNotebookId) {
        params.notebookId = this._state.selectedNotebookId;
      } else if (vm === 'favorites') {
        params.favorite = '1';
      } else if (vm === 'trash') {
        params.trashed = '1';
      } else if (vm === 'tag' && this._state.selectedTagId) {
        params.tagId = this._state.selectedTagId;
      }

      const notes = await ApiService.getNotes(params);
      this.dispatch(new AppAction(AppActionType.SET_NOTES, notes));
    } catch (e) {
      console.error('[AppViewModel] loadNotes failed:', e);
    }
  }

  async loadNote(id: string): Promise<void> {
    this.dispatch(new AppAction(AppActionType.SET_NOTE_LOADING, true));
    try {
      const note = await ApiService.getNote(id);
      this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, note));
      this.dispatch(new AppAction(AppActionType.SET_MOBILE_VIEW, 'editor'));
    } catch (e) {
      console.error('[AppViewModel] loadNote failed:', e);
    } finally {
      this.dispatch(new AppAction(AppActionType.SET_NOTE_LOADING, false));
    }
  }

  async createNote(title?: string, notebookId?: string): Promise<Note | null> {
    try {
      const data: Record<string, Object> = {
        title: title || '无标题',
        content: '',
        contentText: ''
      };
      if (notebookId || this._state.selectedNotebookId) {
        data['notebookId'] = notebookId || this._state.selectedNotebookId!;
      }
      const note = await ApiService.createNote(data as Partial<Note>);
      this.dispatch(new AppAction(AppActionType.ADD_NOTE_TO_LIST, note as NoteListItem));
      this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, note));
      this.dispatch(new AppAction(AppActionType.SET_MOBILE_VIEW, 'editor'));
      return note;
    } catch (e) {
      console.error('[AppViewModel] createNote failed:', e);
      return null;
    }
  }

  async saveNote(): Promise<void> {
    const note = this._state.activeNote;
    if (!note) return;

    this.dispatch(new AppAction(AppActionType.SET_SYNC_STATUS, 'saving'));
    try {
      const updated = await ApiService.updateNote(note.id, {
        title: note.title,
        content: note.content,
        contentText: note.contentText,
        version: note.version
      });
      this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, updated));
      this.dispatch(new AppAction(AppActionType.UPDATE_NOTE_IN_LIST, {
        id: updated.id,
        title: updated.title,
        contentText: updated.contentText,
        updatedAt: updated.updatedAt
      }));
      this.dispatch(new AppAction(AppActionType.SET_SYNC_STATUS, 'saved'));
    } catch (e) {
      this.dispatch(new AppAction(AppActionType.SET_SYNC_STATUS, 'error'));
      console.error('[AppViewModel] saveNote failed:', e);
    }
  }

  async deleteNote(id: string): Promise<void> {
    try {
      await ApiService.deleteNote(id);
      this.dispatch(new AppAction(AppActionType.REMOVE_NOTE_FROM_LIST, id));
      if (this._state.activeNote?.id === id) {
        this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, null));
      }
    } catch (e) {
      console.error('[AppViewModel] deleteNote failed:', e);
    }
  }

  async togglePin(id: string, isPinned: number): Promise<void> {
    try {
      await ApiService.updateNote(id, { isPinned: isPinned ? 0 : 1 } as Partial<Note>);
      this.dispatch(new AppAction(AppActionType.UPDATE_NOTE_IN_LIST, { id, isPinned: isPinned ? 0 : 1 }));
    } catch (e) {
      console.error('[AppViewModel] togglePin failed:', e);
    }
  }

  async toggleFavorite(id: string, isFavorite: number): Promise<void> {
    try {
      await ApiService.updateNote(id, { isFavorite: isFavorite ? 0 : 1 } as Partial<Note>);
      this.dispatch(new AppAction(AppActionType.UPDATE_NOTE_IN_LIST, { id, isFavorite: isFavorite ? 0 : 1 }));
    } catch (e) {
      console.error('[AppViewModel] toggleFavorite failed:', e);
    }
  }

  // ========== 笔记本 ==========

  async loadNotebooks(): Promise<void> {
    try {
      const notebooks = await ApiService.getNotebooks();
      this.dispatch(new AppAction(AppActionType.SET_NOTEBOOKS, notebooks));
    } catch (e) {
      console.error('[AppViewModel] loadNotebooks failed:', e);
    }
  }

  // ========== 标签 ==========

  async loadTags(): Promise<void> {
    try {
      const tags = await ApiService.getTags();
      this.dispatch(new AppAction(AppActionType.SET_TAGS, tags));
    } catch (e) {
      console.error('[AppViewModel] loadTags failed:', e);
    }
  }

  // ========== 搜索 ==========

  async search(query: string): Promise<void> {
    if (!query.trim()) {
      this.dispatch(new AppAction(AppActionType.SET_SEARCH_RESULTS, []));
      return;
    }
    try {
      const results = await ApiService.search(query);
      this.dispatch(new AppAction(AppActionType.SET_SEARCH_RESULTS, results));
    } catch (e) {
      console.error('[AppViewModel] search failed:', e);
    }
  }

  // ========== 任务 ==========

  async loadTasks(filter?: TaskFilter): Promise<void> {
    try {
      const [tasks, stats] = await Promise.all([
        ApiService.getTasks(filter),
        ApiService.getTaskStats()
      ]);
      this.dispatch(new AppAction(AppActionType.SET_TASKS, tasks));
      this.dispatch(new AppAction(AppActionType.SET_TASK_STATS, stats));
    } catch (e) {
      console.error('[AppViewModel] loadTasks failed:', e);
    }
  }

  async createTask(title: string, priority?: number): Promise<void> {
    try {
      const task = await ApiService.createTask({ title, priority: priority || 2 });
      this.dispatch(new AppAction(AppActionType.SET_TASKS, [task, ...this._state.tasks]));
    } catch (e) {
      console.error('[AppViewModel] createTask failed:', e);
    }
  }

  async toggleTask(id: string): Promise<void> {
    try {
      const updated = await ApiService.toggleTask(id);
      this.dispatch(new AppAction(AppActionType.SET_TASKS,
        this._state.tasks.map(t => t.id === id ? updated : t)
      ));
    } catch (e) {
      console.error('[AppViewModel] toggleTask failed:', e);
    }
  }

  async deleteTask(id: string): Promise<void> {
    try {
      await ApiService.deleteTask(id);
      this.dispatch(new AppAction(AppActionType.SET_TASKS, this._state.tasks.filter(t => t.id !== id)));
    } catch (e) {
      console.error('[AppViewModel] deleteTask failed:', e);
    }
  }

  // ========== 视图模式 ==========

  setViewMode(mode: string): void {
    this.dispatch(new AppAction(AppActionType.SET_VIEW_MODE, mode));
    this.loadNotes();
  }

  setSelectedNotebook(id: string | null): void {
    this.dispatch(new AppAction(AppActionType.SET_SELECTED_NOTEBOOK, id));
    this.dispatch(new AppAction(AppActionType.SET_VIEW_MODE, id ? 'notebook' : 'all'));
    this.loadNotes();
  }

  setSelectedTag(id: string | null): void {
    this.dispatch(new AppAction(AppActionType.SET_SELECTED_TAG, id));
    this.dispatch(new AppAction(AppActionType.SET_VIEW_MODE, 'tag'));
    this.loadNotes();
  }

  setMobileView(view: 'list' | 'editor'): void {
    this.dispatch(new AppAction(AppActionType.SET_MOBILE_VIEW, view));
  }

  setActiveNoteTitle(title: string): void {
    if (this._state.activeNote) {
      const note = this._state.activeNote;
      this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, { ...note, title }));
    }
  }

  setActiveNoteContent(content: string, contentText: string): void {
    if (this._state.activeNote) {
      const note = this._state.activeNote;
      this.dispatch(new AppAction(AppActionType.SET_ACTIVE_NOTE, { ...note, content, contentText }));
    }
  }
}
