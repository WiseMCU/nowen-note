import {
  User, Notebook, Note, NoteListItem, Tag, SearchResult,
  Task, TaskStats, ViewMode, SiteSettings
} from '../model/DataModels';

export class AppState {
  user: User | null = null;
  isAuthenticated: boolean = false;
  isLoading: boolean = false;
  noteLoading: boolean = false;

  notebooks: Notebook[] = [];
  notes: NoteListItem[] = [];
  activeNote: Note | null = null;
  tags: Tag[] = [];
  tasks: Task[] = [];
  taskStats: TaskStats | null = null;
  searchResults: SearchResult[] = [];

  selectedNotebookId: string | null = null;
  selectedTagId: string | null = null;
  viewMode: ViewMode = 'all';
  searchQuery: string = '';

  siteSettings: SiteSettings = { site_title: 'Nowen Note', site_favicon: '', editor_font_family: '' };

  syncStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  mobileView: 'list' | 'editor' = 'list';

  clone(): AppState {
    const state = new AppState();
    state.user = this.user;
    state.isAuthenticated = this.isAuthenticated;
    state.isLoading = this.isLoading;
    state.noteLoading = this.noteLoading;
    state.notebooks = this.notebooks;
    state.notes = this.notes;
    state.activeNote = this.activeNote;
    state.tags = this.tags;
    state.tasks = this.tasks;
    state.taskStats = this.taskStats;
    state.searchResults = this.searchResults;
    state.selectedNotebookId = this.selectedNotebookId;
    state.selectedTagId = this.selectedTagId;
    state.viewMode = this.viewMode;
    state.searchQuery = this.searchQuery;
    state.siteSettings = this.siteSettings;
    state.syncStatus = this.syncStatus;
    state.mobileView = this.mobileView;
    return state;
  }
}
