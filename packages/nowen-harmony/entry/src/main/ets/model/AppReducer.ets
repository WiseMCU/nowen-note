import { AppState } from '../model/AppState';
import {
  User, Notebook, Note, NoteListItem, Tag, SearchResult,
  Task, TaskStats, ViewMode, SiteSettings
} from '../model/DataModels';

export enum AppActionType {
  SET_USER,
  SET_AUTHENTICATED,
  SET_LOADING,
  SET_NOTE_LOADING,
  SET_NOTEBOOKS,
  SET_NOTES,
  SET_ACTIVE_NOTE,
  SET_TAGS,
  SET_TASKS,
  SET_TASK_STATS,
  SET_SEARCH_RESULTS,
  SET_SELECTED_NOTEBOOK,
  SET_SELECTED_TAG,
  SET_VIEW_MODE,
  SET_SEARCH_QUERY,
  SET_SITE_SETTINGS,
  SET_SYNC_STATUS,
  SET_MOBILE_VIEW,
  UPDATE_NOTE_IN_LIST,
  REMOVE_NOTE_FROM_LIST,
  ADD_NOTE_TO_LIST,
}

export class AppAction {
  type: AppActionType;
  payload?: Object;

  constructor(type: AppActionType, payload?: Object) {
    this.type = type;
    this.payload = payload;
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  const newState = state.clone();

  switch (action.type) {
    case AppActionType.SET_USER:
      newState.user = action.payload as User | null;
      break;
    case AppActionType.SET_AUTHENTICATED:
      newState.isAuthenticated = action.payload as boolean;
      break;
    case AppActionType.SET_LOADING:
      newState.isLoading = action.payload as boolean;
      break;
    case AppActionType.SET_NOTE_LOADING:
      newState.noteLoading = action.payload as boolean;
      break;
    case AppActionType.SET_NOTEBOOKS:
      newState.notebooks = action.payload as Notebook[];
      break;
    case AppActionType.SET_NOTES:
      newState.notes = action.payload as NoteListItem[];
      break;
    case AppActionType.SET_ACTIVE_NOTE:
      newState.activeNote = action.payload as Note | null;
      break;
    case AppActionType.SET_TAGS:
      newState.tags = action.payload as Tag[];
      break;
    case AppActionType.SET_TASKS:
      newState.tasks = action.payload as Task[];
      break;
    case AppActionType.SET_TASK_STATS:
      newState.taskStats = action.payload as TaskStats | null;
      break;
    case AppActionType.SET_SEARCH_RESULTS:
      newState.searchResults = action.payload as SearchResult[];
      break;
    case AppActionType.SET_SELECTED_NOTEBOOK:
      newState.selectedNotebookId = action.payload as string | null;
      break;
    case AppActionType.SET_SELECTED_TAG:
      newState.selectedTagId = action.payload as string | null;
      break;
    case AppActionType.SET_VIEW_MODE:
      newState.viewMode = action.payload as ViewMode;
      break;
    case AppActionType.SET_SEARCH_QUERY:
      newState.searchQuery = action.payload as string;
      break;
    case AppActionType.SET_SITE_SETTINGS:
      newState.siteSettings = action.payload as SiteSettings;
      break;
    case AppActionType.SET_SYNC_STATUS:
      newState.syncStatus = action.payload as 'idle' | 'saving' | 'saved' | 'error';
      break;
    case AppActionType.SET_MOBILE_VIEW:
      newState.mobileView = action.payload as 'list' | 'editor';
      break;
    case AppActionType.UPDATE_NOTE_IN_LIST: {
      const updated = action.payload as Partial<NoteListItem> & { id: string };
      newState.notes = newState.notes.map(n => n.id === updated.id ? { ...n, ...updated } : n);
      break;
    }
    case AppActionType.REMOVE_NOTE_FROM_LIST: {
      const id = action.payload as string;
      newState.notes = newState.notes.filter(n => n.id !== id);
      break;
    }
    case AppActionType.ADD_NOTE_TO_LIST: {
      const note = action.payload as NoteListItem;
      newState.notes = [note, ...newState.notes];
      break;
    }
    default:
      break;
  }

  return newState;
}
