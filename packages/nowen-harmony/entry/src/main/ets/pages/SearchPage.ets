import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import { SearchResult } from '../model/DataModels';

@Entry
@Component
struct SearchPage {
  @State query: string = '';
  @State results: SearchResult[] = [];
  @State isSearching: boolean = false;
  private viewModel: AppViewModel = AppViewModel.getInstance();
  private searchTimer: number = -1;

  build() {
    Column() {
      Row() {
        TextInput({ placeholder: $r('app.string.search_hint'), text: this.query })
          .width('100%')
          .height(40)
          .borderRadius(20)
          .padding({ left: 16, right: 16 })
          .backgroundColor($r('app.color.surface'))
          .onChange((value: string) => {
            this.query = value;
            this.debounceSearch();
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8 })

      if (this.isSearching) {
        LoadingProgress()
          .color($r('app.color.primary'))
          .width(32)
          .height(32)
          .margin({ top: 32 })
      } else if (this.results.length === 0 && this.query.length >= 2) {
        Text('未找到匹配笔记')
          .fontSize(14)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          .margin({ top: 32 })
      } else {
        List() {
          ForEach(this.results, (item: SearchResult) => {
            ListItem() {
              Column() {
                Text(item.title)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })

                Text(item.snippet)
                  .fontSize(12)
                  .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 4 })

                Text(item.updatedAt)
                  .fontSize(11)
                  .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                  .margin({ top: 2 })
              }
              .width('100%')
              .padding(16)
              .alignItems(HorizontalAlign.Start)
            }
            .onClick(() => {
              this.viewModel.loadNote(item.id);
              router.pushUrl({ url: 'pages/NoteEditPage' });
            })
          }, (item: SearchResult) => item.id)
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

  private debounceSearch(): void {
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(async () => {
      if (this.query.length >= 2) {
        this.isSearching = true;
        await this.viewModel.search(this.query);
        this.results = this.viewModel.state.searchResults;
        this.isSearching = false;
      } else {
        this.results = [];
      }
    }, 300);
  }
}
