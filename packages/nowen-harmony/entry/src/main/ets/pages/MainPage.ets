import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import { NoteListItem, Notebook, Tag } from '../model/DataModels';

@Entry
@Component
struct MainPage {
  @State currentTabIndex: number = 0;
  @State sidebarVisible: boolean = false;
  @State selectedNotebookId: string | null = null;
  @State noteList: NoteListItem[] = [];
  @State notebookList: Notebook[] = [];
  @State tagList: Tag[] = [];
  @State isLoading: boolean = false;
  @State activeNoteId: string | null = null;
  private viewModel: AppViewModel = AppViewModel.getInstance();
  private unsubscribe: (() => void) | null = null;

  async aboutToAppear(): Promise<void> {
    await this.viewModel.init();
    this.syncState();
    this.unsubscribe = this.viewModel.subscribe(() => {
      this.syncState();
    });
  }

  aboutToDisappear(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private syncState(): void {
    const state = this.viewModel.state;
    this.noteList = state.notes;
    this.notebookList = state.notebooks;
    this.tagList = state.tags;
    this.isLoading = state.isLoading;
    this.activeNoteId = state.activeNote?.id || null;
  }

  build() {
    Tabs({ index: this.currentTabIndex }) {
      // Tab 1: 笔记
      TabContent() {
        this.NoteTab()
      }
      .tabBar($r('app.string.tab_notes'))

      // Tab 2: 搜索
      TabContent() {
        this.SearchTab()
      }
      .tabBar($r('app.string.tab_search'))

      // Tab 3: 任务
      TabContent() {
        this.TaskTab()
      }
      .tabBar($r('app.string.tab_tasks'))

      // Tab 4: 设置
      TabContent() {
        this.SettingsTab()
      }
      .tabBar($r('app.string.tab_settings'))
    }
    .barPosition(BarPosition.End)
    .barMode(BarMode.Fixed)
    .barHeight(56)
    .scrollable(false)
    .onChange((index: number) => {
      this.currentTabIndex = index;
      if (index === 2) {
        this.viewModel.loadTasks();
      }
    })
    .width('100%')
    .height('100%')
  }

  // ========== 笔记 Tab ==========

  @Builder
  NoteTab(): void {
    Row() {
      // 侧边栏（笔记本树 + 标签）
      if (this.sidebarVisible) {
        this.SidebarPanel()
      }

      // 笔记列表
      this.NoteListPanel()
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  SidebarPanel(): void {
    Column() {
      // 顶栏
      Row() {
        Text($r('app.string.app_name'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
          .layoutWeight(1)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      List() {
        // 全部笔记
        ListItem() {
          this.SidebarItem('全部笔记', this.selectedNotebookId === null, () => {
            this.selectedNotebookId = null;
            this.viewModel.setSelectedNotebook(null);
          })
        }

        // 收藏
        ListItem() {
          this.SidebarItem('收藏', false, () => {
            this.viewModel.setViewMode('favorites');
          })
        }

        // 回收站
        ListItem() {
          this.SidebarItem('回收站', false, () => {
            this.viewModel.setViewMode('trash');
          })
        }

        // 笔记本列表
        ListItemGroup({ header: ItemHeader('笔记本') }) {
          ForEach(this.notebookList, (nb: Notebook) => {
            ListItem() {
              this.SidebarItem(nb.name, this.selectedNotebookId === nb.id, () => {
                this.selectedNotebookId = nb.id;
                this.viewModel.setSelectedNotebook(nb.id);
              })
            }
          }, (nb: Notebook) => nb.id)
        }

        // 标签列表
        ListItemGroup({ header: ItemHeader('标签') }) {
          ForEach(this.tagList, (tag: Tag) => {
            ListItem() {
              this.SidebarItem(`${tag.name} (${tag.noteCount})`, false, () => {
                this.viewModel.setSelectedTag(tag.id);
              })
            }
          }, (tag: Tag) => tag.id)
        }
      }
      .width('100%')
      .layoutWeight(1)
      .divider({ strokeWidth: 0.5, color: $r('app.color.border') })
    }
    .width(260)
    .height('100%')
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  SidebarItem(label: string, isActive: boolean, onTap: () => void): void {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor(isActive ? $r('app.color.primary') : $r('sys.color.ohos_id_color_text_primary'))
        .fontWeight(isActive ? FontWeight.Medium : FontWeight.Normal)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .height(44)
    .padding({ left: 16, right: 16 })
    .backgroundColor(isActive ? $r('app.color.primary') + '14' : Color.Transparent)
    .borderRadius(8)
    .onClick(() => onTap())
  }

  @Builder
  NoteListPanel(): void {
    Column() {
      // 顶栏
      Row() {
        Image($r('sys.media.ohos_ic_public_drawer'))
          .width(24)
          .height(24)
          .fillColor($r('sys.color.ohos_id_color_text_primary'))
          .margin({ right: 12 })
          .onClick(() => { this.sidebarVisible = !this.sidebarVisible; })

        Text('笔记')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)

        // 新建按钮
        Image($r('sys.media.ohos_ic_public_add'))
          .width(24)
          .height(24)
          .fillColor($r('app.color.primary'))
          .onClick(() => this.handleCreateNote())
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      // 笔记列表
      if (this.isLoading) {
        Column() {
          LoadingProgress()
            .color($r('app.color.primary'))
            .width(32)
            .height(32)
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.noteList.length === 0) {
        Column() {
          Text($r('app.string.empty_note'))
            .fontSize(14)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List() {
          ForEach(this.noteList, (note: NoteListItem) => {
            ListItem() {
              this.NoteItem(note)
            }
          }, (note: NoteListItem) => note.id)
        }
        .width('100%')
        .layoutWeight(1)
        .divider({ strokeWidth: 0.5, color: $r('app.color.border'), startMargin: 72 })
      }
    }
    .layoutWeight(1)
    .height('100%')
  }

  @Builder
  NoteItem(note: NoteListItem): void {
    Row() {
      Column() {
        Text(note.title || '无标题')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (note.contentText) {
          Text(note.contentText)
            .fontSize(12)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 4 })
        }

        Text(this.formatDate(note.updatedAt))
          .fontSize(11)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          .margin({ top: 4 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // 置顶/收藏标记
      Row() {
        if (note.isPinned) {
          Text('\uD83D\uDCCC')
            .fontSize(14)
            .margin({ right: 4 })
        }
        if (note.isFavorite) {
          Text('\u2B50')
            .fontSize(14)
        }
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .backgroundColor(this.activeNoteId === note.id ? $r('app.color.primary') + '14' : Color.Transparent)
    .onClick(() => this.handleOpenNote(note.id))
  }

  // ========== 搜索 Tab ==========

  @Builder
  SearchTab(): void {
    this.SearchContent()
  }

  // ========== 任务 Tab ==========

  @Builder
  TaskTab(): void {
    this.TaskContent()
  }

  // ========== 设置 Tab ==========

  @Builder
  SettingsTab(): void {
    this.SettingsContent()
  }

  @Builder
  SearchContent(): void {
    Column() {
      TextInput({ placeholder: $r('app.string.search_hint') })
        .width('100%')
        .height(48)
        .borderRadius(8)
        .padding({ left: 16, right: 16 })
        .margin({ left: 16, right: 16, top: 16 })
        .onChange((value: string) => {
          if (value.length >= 2) {
            this.viewModel.search(value);
          }
        })

      List() {
        ForEach(this.viewModel.state.searchResults, (result: SearchResult) => {
          ListItem() {
            Column() {
              Text(result.title)
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })

              Text(result.snippet)
                .fontSize(12)
                .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .margin({ top: 4 })
            }
            .width('100%')
            .padding(16)
            .alignItems(HorizontalAlign.Start)
          }
          .onClick(() => this.handleOpenNote(result.id))
        }, (result: SearchResult) => result.id)
      }
      .width('100%')
      .layoutWeight(1)
      .margin({ top: 8 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  TaskContent(): void {
    Column() {
      Row() {
        Text($r('app.string.tab_tasks'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)

        Image($r('sys.media.ohos_ic_public_add'))
          .width(24)
          .height(24)
          .fillColor($r('app.color.primary'))
          .onClick(() => this.handleCreateTask())
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      // 任务统计
      if (this.viewModel.state.taskStats) {
        this.TaskStatsBar()
      }

      List() {
        ForEach(this.viewModel.state.tasks, (task: Task) => {
          ListItem() {
            Row() {
              Checkbox()
                .select(task.isCompleted === 1)
                .onChange((checked: boolean) => {
                  this.viewModel.toggleTask(task.id);
                })

              Text(task.title)
                .fontSize(15)
                .fontColor(task.isCompleted ? $r('sys.color.ohos_id_color_text_secondary') : $r('sys.color.ohos_id_color_text_primary'))
                .decoration({ type: task.isCompleted ? TextDecorationType.LineThrough : TextDecorationType.None })
                .layoutWeight(1)
                .margin({ left: 8 })

              if (task.dueDate) {
                Text(this.formatDate(task.dueDate))
                  .fontSize(11)
                  .fontColor($r('sys.color.ohos_id_color_text_secondary'))
              }
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 10, bottom: 10 })
          }
          .swipeAction({ end: this.TaskSwipeAction(task.id) })
        }, (task: Task) => task.id)
      }
      .width('100%')
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  TaskStatsBar(): void {
    Row() {
      this.StatChip('总计', this.viewModel.state.taskStats?.total || 0)
      this.StatChip('待办', this.viewModel.state.taskStats?.pending || 0)
      this.StatChip('今日', this.viewModel.state.taskStats?.today || 0)
      this.StatChip('逾期', this.viewModel.state.taskStats?.overdue || 0)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 8 })
  }

  @Builder
  StatChip(label: string, count: number): void {
    Row() {
      Text(label)
        .fontSize(11)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .margin({ right: 4 })
      Text(`${count}`)
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
    }
    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
    .borderRadius(12)
    .backgroundColor($r('app.color.border'))
    .margin({ right: 8 })
  }

  @Builder
  TaskSwipeAction(taskId: string): void {
    Button({ type: ButtonType.Circle }) {
      Image($r('sys.media.ohos_ic_public_delete'))
        .width(20)
        .height(20)
        .fillColor(Color.White)
    }
    .width(40)
    .height(40)
    .backgroundColor($r('app.color.danger'))
    .margin({ right: 16 })
    .onClick(() => this.viewModel.deleteTask(taskId))
  }

  @Builder
  SettingsContent(): void {
    Column() {
      Row() {
        Text($r('app.string.settings_title'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      List() {
        ListItem() {
          Row() {
            Text($r('app.string.settings_server'))
              .fontSize(15)
              .layoutWeight(1)
            Image($r('sys.media.ohos_ic_public_arrow_right'))
              .width(20)
              .height(20)
              .fillColor($r('sys.color.ohos_id_color_text_secondary'))
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/ServerConfigPage' });
          })
        }

        ListItem() {
          Row() {
            Text($r('app.string.settings_logout'))
              .fontSize(15)
              .fontColor($r('app.color.danger'))
              .layoutWeight(1)
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
          .onClick(() => this.handleLogout())
        }
      }
      .width('100%')
      .divider({ strokeWidth: 0.5, color: $r('app.color.border') })
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  // ========== 操作方法 ==========

  private async handleOpenNote(id: string): Promise<void> {
    await this.viewModel.loadNote(id);
    router.pushUrl({ url: 'pages/NoteEditPage' });
  }

  private async handleCreateNote(): Promise<void> {
    const note = await this.viewModel.createNote();
    if (note) {
      router.pushUrl({ url: 'pages/NoteEditPage' });
    }
  }

  private handleCreateTask(): void {
    // 使用 TextInputDialog 创建任务
  }

  private async handleLogout(): Promise<void> {
    await this.viewModel.logout();
    router.replaceUrl({ url: 'pages/LoginPage' });
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
      return `${date.getMonth() + 1}/${date.getDate()}`;
    } catch (e) {
      return dateStr;
    }
  }
}

@Component
struct ItemHeader {
  @Prop title: string = '';

  build() {
    Row() {
      Text(this.title)
        .fontSize(12)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .fontWeight(FontWeight.Medium)
    }
    .width('100%')
    .padding({ left: 16, top: 12, bottom: 4 })
  }
}
