import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import { Tag, NoteListItem } from '../model/DataModels';

@Entry
@Component
struct TagDetailPage {
  @State tagId: string = '';
  @State tagName: string = '';
  @State tagColor: string = '#3B82F6';
  @State notes: NoteListItem[] = [];
  @State isLoading: boolean = false;
  private viewModel: AppViewModel = AppViewModel.getInstance();
  private unsubscribe: (() => void) | null = null;

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    if (params) {
      this.tagId = params['tagId'] || '';
      this.tagName = params['tagName'] || '';
      this.tagColor = params['tagColor'] || '#3B82F6';
    }
    this.unsubscribe = this.viewModel.subscribe(() => this.syncState());
    this.loadTagNotes();
  }

  aboutToDisappear(): void {
    if (this.unsubscribe) this.unsubscribe();
  }

  private syncState(): void {
    this.notes = this.viewModel.state.notes;
    this.isLoading = this.viewModel.state.isLoading;
  }

  private async loadTagNotes(): Promise<void> {
    if (this.tagId) {
      this.viewModel.setSelectedTag(this.tagId);
    }
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Image($r('sys.media.ohos_ic_public_arrow_left'))
          .width(24)
          .height(24)
          .fillColor($r('sys.color.ohos_id_color_text_primary'))
          .onClick(() => router.back())

        Circle()
          .width(12)
          .height(12)
          .fill(this.tagColor)
          .margin({ left: 12, right: 8 })

        Text(this.tagName)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

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
      } else if (this.notes.length === 0) {
        Column() {
          Text('该标签下暂无笔记')
            .fontSize(14)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List() {
          ForEach(this.notes, (note: NoteListItem) => {
            ListItem() {
              Column() {
                Text(note.title || '无标题')
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
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

                Text(note.updatedAt)
                  .fontSize(11)
                  .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                  .margin({ top: 4 })
              }
              .width('100%')
              .padding(16)
              .alignItems(HorizontalAlign.Start)
            }
            .onClick(() => {
              this.viewModel.loadNote(note.id);
              router.pushUrl({ url: 'pages/NoteEditPage' });
            })
          }, (note: NoteListItem) => note.id)
        }
        .width('100%')
        .layoutWeight(1)
        .divider({ strokeWidth: 0.5, color: $r('app.color.border') })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }
}
