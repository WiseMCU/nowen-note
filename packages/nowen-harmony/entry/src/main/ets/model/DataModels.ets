export interface User {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  displayName: string | null;
  role: 'admin' | 'user';
  isDisabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface Notebook {
  id: string;
  userId: string;
  workspaceId: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string | null;
  sortOrder: number;
  isExpanded: number;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
  children: Notebook[];
}

export interface Note {
  id: string;
  userId: string;
  notebookId: string;
  workspaceId: string | null;
  title: string;
  content: string;
  contentText: string;
  isPinned: number;
  isFavorite: number;
  isLocked: number;
  isArchived: number;
  isTrashed: number;
  trashedAt: string | null;
  version: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface NoteListItem {
  id: string;
  userId: string;
  notebookId: string;
  workspaceId: string | null;
  title: string;
  contentText: string;
  isPinned: number;
  isFavorite: number;
  isLocked: number;
  isArchived: number;
  isTrashed: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
  noteCount: number;
}

export interface SearchResult {
  id: string;
  title: string;
  notebookId: string;
  updatedAt: string;
  isFavorite: number;
  isPinned: number;
  snippet: string;
}

export type TaskPriority = 1 | 2 | 3;

export type TaskFilter = 'all' | 'today' | 'week' | 'overdue' | 'completed';

export interface Task {
  id: string;
  userId: string;
  title: string;
  isCompleted: number;
  priority: TaskPriority;
  dueDate: string | null;
  noteId: string | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children: Task[];
}

export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  today: number;
  overdue: number;
  week: number;
}

export interface Share {
  id: string;
  noteId: string;
  ownerId: string;
  shareToken: string;
  shareType: string;
  permission: string;
  hasPassword: boolean;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  noteTitle: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  userId: string;
  username: string;
  title: string;
  content: string;
  contentText: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  icon: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role: string;
  memberCount: number;
  notebookCount: number;
}

export type ViewMode = 'all' | 'notebook' | 'favorites' | 'trash' | 'search' | 'tag' | 'tasks';

export interface SiteSettings {
  site_title: string;
  site_favicon: string;
  editor_font_family: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message: string;
}
