export interface User {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  displayName?: string | null;
  role?: "admin" | "user";
  isDisabled?: 0 | 1 | number;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
  noteCount?: number;
  notebookCount?: number;
}

/** 搜索用户（用于 @提及、邀请等公开场景，只包含公开字段） */
export interface UserPublicInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// ========== 多用户协作（Phase 1） ==========

export type WorkspaceRole = "owner" | "admin" | "editor" | "commenter" | "viewer";
export type WorkspacePermission = "read" | "comment" | "write" | "manage";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  icon: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role?: WorkspaceRole;     // 当前用户在该工作区的角色
  memberCount?: number;
  notebookCount?: number;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  code: string;
  role: WorkspaceRole;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Notebook {
  id: string;
  userId: string;
  workspaceId: string | null;   // Phase 1 新增
  parentId: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string | null;
  sortOrder: number;
  isExpanded: number;
  createdAt: string;
  updatedAt: string;
  noteCount?: number;
  children?: Notebook[];
}

export interface Note {
  id: string;
  userId: string;
  notebookId: string;
  workspaceId: string | null;   // Phase 1 新增
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
  tags?: Tag[];
  permission?: WorkspacePermission; // Phase 1 新增
}

export interface NoteListItem {
  id: string;
  userId: string;
  notebookId: string;
  workspaceId: string | null;   // Phase 1 新增
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
  noteCount?: number;
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

export type ViewMode = "notebook" | "favorites" | "trash" | "all" | "search" | "tasks" | "tag" | "mindmaps" | "ai-chat" | "diary" | "files";

// ========== 文件管理（/api/files 聚合视图） ==========

/** 文件分类：按 MIME 粗分，UI 用图标/筛选。 */
export type FileCategory = "image" | "file";

/** 文件排序键（与后端 resolveOrderBy 白名单一致）。 */
export type FileSortKey =
  | "created_desc"
  | "created_asc"
  | "name_asc"
  | "name_desc"
  | "size_asc"
  | "size_desc";

/**
 * 文件管理列表 / 详情共用的基础行。
 *
 * - `url` 永远是相对路径 `/api/attachments/<id>`；前端消费时走 resolveAttachmentUrl()
 *   补 origin，避免把变动端口 / 多域部署写死进持久化数据。
 * - `primaryNote` 是首次归属的笔记；对"从文件管理直传"的附件，这里指向
 *   holder note（isArchived=1 的"未归档文件"占位笔记）。
 */
export interface FileItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  category: FileCategory;
  url: string;
  primaryNote: {
    id: string;
    title: string;
    notebookId: string | null;
    notebookName: string | null;
    notebookIcon: string | null;
    isTrashed: number;
  } | null;
}

/** 引用该附件的一条笔记（反向关联）。 */
export interface FileReference {
  id: string;
  title: string;
  notebookId: string | null;
  notebookName: string | null;
  notebookIcon: string | null;
  isTrashed: number;
  updatedAt: string;
  /** 是否为"首次归属"笔记（attachments.noteId 指向的那一条）。 */
  isPrimary: boolean;
}

export interface FileDetail extends FileItem {
  references: FileReference[];
}

export interface FileListResponse {
  items: FileItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FileStats {
  total: number;
  totalBytes: number;
  images: { count: number; bytes: number };
  files: { count: number; bytes: number };
  byMime: Array<{ mime: string; count: number; bytes: number }>;
}







export type TaskPriority = 1 | 2 | 3; // 1=低, 2=中, 3=高

export type TaskFilter = "all" | "today" | "week" | "overdue" | "completed";

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
  children?: Task[];
}

export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  today: number;
  overdue: number;
  week: number;
}

export interface CustomFont {
  id: string;
  name: string;
  fileName: string;
  format: string;
  fileSize?: number;
  createdAt: string;
}

export interface MindMapNode {
  id: string;
  text: string;
  children: MindMapNode[];
  collapsed?: boolean;
}

export interface MindMapData {
  root: MindMapNode;
}

export interface MindMap {
  id: string;
  userId: string;
  title: string;
  data: string; // JSON string of MindMapData
  createdAt: string;
  updatedAt: string;
}

export interface MindMapListItem {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Diary {
  id: string;
  userId: string;
  contentText: string;
  mood: string;
  /** 已绑定的说说图片 id 数组（顺序即展示顺序）。需要 URL 时拼 /api/diary/attachments/<id>。 */
  images: string[];
  createdAt: string;
}

export interface DiaryTimeline {
  items: Diary[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface DiaryStats {
  total: number;
  todayCount: number;
}

// 分享
export type SharePermission = "view" | "comment" | "edit";

export interface Share {
  id: string;
  noteId: string;
  ownerId: string;
  shareToken: string;
  shareType: string;
  permission: SharePermission;
  hasPassword: boolean;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  noteTitle?: string;
}

export interface ShareInfo {
  id: string;
  noteTitle: string;
  ownerName: string;
  permission: SharePermission;
  needPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface SharedNoteContent {
  /** 关联的笔记 ID（访客编辑时作为伪 Note.id 使用） */
  noteId?: string;
  title: string;
  content: string;
  contentText: string;
  permission: SharePermission;
  updatedAt: string;
  version?: number;
  /** 笔记是否被所有者锁定，锁定时即使 permission=edit 也禁止访客写入 */
  isLocked?: 0 | 1;
}

// 版本历史
export interface NoteVersion {
  id: string;
  noteId: string;
  userId: string;
  username?: string;
  title: string;
  content?: string;
  contentText?: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  createdAt: string;
}

// 评论批注
export interface ShareComment {
  id: string;
  noteId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  parentId: string | null;
  content: string;
  anchorData: string | null;
  isResolved: number;
  createdAt: string;
  updatedAt: string;
}
