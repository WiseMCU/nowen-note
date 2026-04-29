import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct NoteEditPage {
  @State title: string = '';
  @State content: string = '';
  @State isLoading: boolean = false;
  @State isSaving: boolean = false;
  @State syncStatus: string = 'idle';
  @State showMenu: boolean = false;
  private viewModel: AppViewModel = AppViewModel.getInstance();
  private saveTimer: number = -1;
  private unsubscribe: (() => void) | null = null;

  aboutToAppear(): void {
    this.syncState();
    this.unsubscribe = this.viewModel.subscribe(() => {
      this.syncState();
    });
  }

  aboutToDisappear(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.saveTimer !== -1) {
      clearTimeout(this.saveTimer);
    }
  }

  private syncState(): void {
    const note = this.viewModel.state.activeNote;
    if (note) {
      this.title = note.title;
      this.content = note.content;
    }
    this.isLoading = this.viewModel.state.noteLoading;
    this.syncStatus = this.viewModel.state.syncStatus;
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Image($r('sys.media.ohos_ic_public_arrow_left'))
          .width(24)
          .height(24)
          .fillColor($r('sys.color.ohos_id_color_text_primary'))
          .onClick(() => this.handleBack())

        // 同步状态
        if (this.syncStatus === 'saving') {
          LoadingProgress()
            .width(16)
            .height(16)
            .color($r('app.color.primary'))
            .margin({ left: 8 })
        } else if (this.syncStatus === 'saved') {
          Text('\u2713')
            .fontSize(14)
            .fontColor($r('app.color.success'))
            .margin({ left: 8 })
        }

        Blank()
          .layoutWeight(1)

        // 更多操作菜单
        Image($r('sys.media.ohos_ic_public_more'))
          .width(24)
          .height(24)
          .fillColor($r('sys.color.ohos_id_color_text_primary'))
          .onClick(() => { this.showMenu = !this.showMenu; })
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })
      .justifyContent(FlexAlign.SpaceBetween)

      // 下拉菜单
      if (this.showMenu) {
        this.MoreMenu()
      }

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
      } else {
        // 标题输入
        TextInput({ text: this.title, placeholder: '无标题' })
          .width('100%')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .backgroundColor(Color.Transparent)
          .padding({ left: 16, right: 16 })
          .onChange((value: string) => {
            this.title = value;
            this.viewModel.setActiveNoteTitle(value);
            this.debounceSave();
          })

        // 内容编辑器（Markdown 模式）
        TextArea({ text: this.content, placeholder: '开始书写...' })
          .width('100%')
          .layoutWeight(1)
          .fontSize(15)
          .lineHeight(22)
          .backgroundColor(Color.Transparent)
          .padding({ left: 16, right: 16, top: 8 })
          .onChange((value: string) => {
            this.content = value;
            this.viewModel.setActiveNoteContent(value, value.replace(/[#*`~>\[\]()!|-]/g, ''));
            this.debounceSave();
          })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  MoreMenu(): void {
    Column() {
      this.MenuItem('置顶', () => {
        const note = this.viewModel.state.activeNote;
        if (note) this.viewModel.togglePin(note.id, note.isPinned);
        this.showMenu = false;
      })

      this.MenuItem('收藏', () => {
        const note = this.viewModel.state.activeNote;
        if (note) this.viewModel.toggleFavorite(note.id, note.isFavorite);
        this.showMenu = false;
      })

      this.MenuItem('删除', () => {
        this.handleDelete();
        this.showMenu = false;
      })
    }
    .width(160)
    .borderRadius(8)
    .backgroundColor($r('app.color.surface'))
    .shadow({ radius: 8, color: '#1A000000', offsetY: 2 })
    .position({ x: '65%', y: 56 })
    .zIndex(10)
  }

  @Builder
  MenuItem(label: string, onTap: () => void): void {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor(label === '删除' ? $r('app.color.danger') : $r('sys.color.ohos_id_color_text_primary'))
    }
    .width('100%')
    .height(44)
    .padding({ left: 16 })
    .onClick(() => onTap())
  }

  private debounceSave(): void {
    if (this.saveTimer !== -1) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.viewModel.saveNote();
    }, 1500);
  }

  private async handleBack(): Promise<void> {
    if (this.viewModel.state.syncStatus === 'saving') {
      await this.viewModel.saveNote();
    }
    this.viewModel.setMobileView('list');
    this.viewModel.dispatch(new (import('../model/AppReducer').AppAction)(
      import('../model/AppReducer').AppActionType.SET_ACTIVE_NOTE, null
    ));
    router.back();
  }

  private handleDelete(): void {
    const note = this.viewModel.state.activeNote;
    if (!note) return;

    promptAction.showDialog({
      title: $r('app.string.confirm_delete'),
      buttons: [
        { text: $r('app.string.cancel'), color: '#666666' },
        { text: $r('app.string.confirm'), color: '#EF4444' }
      ]
    }).then((result) => {
      if (result.index === 1) {
        this.viewModel.deleteNote(note.id);
        router.back();
      }
    });
  }
}
