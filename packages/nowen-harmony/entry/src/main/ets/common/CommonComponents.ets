@Component
export struct LoadingOverlay {
  @Prop message: string = '加载中...';
  @Prop visible: boolean = false;

  build() {
    if (this.visible) {
      Stack() {
        Column() {
          LoadingProgress()
            .color($r('app.color.primary'))
            .width(40)
            .height(40)

          Text(this.message)
            .fontSize(14)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
            .margin({ top: 12 })
        }
        .padding(24)
        .borderRadius(12)
        .backgroundColor($r('app.color.surface'))
        .shadow({ radius: 16, color: '#1A000000' })
      }
      .width('100%')
      .height('100%')
      .backgroundColor('#66000000')
    }
  }
}

@Component
export struct EmptyState {
  @Prop icon: string = '\uD83D\uDCCB';
  @Prop message: string = '暂无数据';
  @Prop actionLabel: string = '';
  private onAction: () => void = () => {};

  build() {
    Column() {
      Text(this.icon)
        .fontSize(48)
        .margin({ bottom: 16 })

      Text(this.message)
        .fontSize(14)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .margin({ bottom: 16 })

      if (this.actionLabel) {
        Button(this.actionLabel)
          .height(36)
          .borderRadius(18)
          .backgroundColor($r('app.color.primary'))
          .fontColor(Color.White)
          .fontSize(14)
          .onClick(() => this.onAction())
      }
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
}

@Component
export struct SyncStatusIndicator {
  @Prop status: string = 'idle';

  build() {
    Row() {
      if (this.status === 'saving') {
        LoadingProgress()
          .width(14)
          .height(14)
          .color($r('app.color.primary'))
          .margin({ right: 4 })
        Text('保存中...')
          .fontSize(11)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
      } else if (this.status === 'saved') {
        Text('\u2713 已保存')
          .fontSize(11)
          .fontColor($r('app.color.success'))
      } else if (this.status === 'error') {
        Text('\u2717 保存失败')
          .fontSize(11)
          .fontColor($r('app.color.danger'))
      }
    }
  }
}

@Component
export struct TagChip {
  @Prop name: string = '';
  @Prop color: string = '#3B82F6';
  @Prop selected: boolean = false;
  private onTap: () => void = () => {};

  build() {
    Row() {
      Circle()
        .width(8)
        .height(8)
        .fill(this.color)
        .margin({ right: 6 })

      Text(this.name)
        .fontSize(12)
        .fontColor(this.selected ? Color.White : $r('sys.color.ohos_id_color_text_primary'))
    }
    .padding({ left: 10, right: 10, top: 4, bottom: 4 })
    .borderRadius(12)
    .backgroundColor(this.selected ? this.color : $r('app.color.surface'))
    .borderWidth(1)
    .borderColor(this.selected ? this.color : $r('app.color.border'))
    .onClick(() => this.onTap())
  }
}

@Component
export struct NoteCard {
  @Prop title: string = '';
  @Prop preview: string = '';
  @Prop date: string = '';
  @Prop isPinned: boolean = false;
  @Prop isFavorite: boolean = false;
  @Prop isActive: boolean = false;
  private onTap: () => void = () => {};

  build() {
    Column() {
      Row() {
        Text(this.title || '无标题')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)

        if (this.isPinned) {
          Text('\uD83D\uDCCC')
            .fontSize(12)
            .margin({ left: 4 })
        }
        if (this.isFavorite) {
          Text('\u2B50')
            .fontSize(12)
            .margin({ left: 4 })
        }
      }

      if (this.preview) {
        Text(this.preview)
          .fontSize(12)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 4 })
      }

      Text(this.date)
        .fontSize(11)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .margin({ top: 4 })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.isActive ? $r('app.color.primary') + '14' : Color.Transparent)
    .borderRadius(8)
    .onClick(() => this.onTap())
  }
}

@Component
export struct PriorityBadge {
  @Prop priority: number = 2;

  build() {
    if (this.priority === 3) {
      Text('高')
        .fontSize(10)
        .fontColor($r('app.color.danger'))
        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
        .borderRadius(4)
        .backgroundColor('#14EF4444')
    } else if (this.priority === 2) {
      Text('中')
        .fontSize(10)
        .fontColor($r('app.color.warning'))
        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
        .borderRadius(4)
        .backgroundColor('#14F59E0B')
    } else {
      Text('低')
        .fontSize(10)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
        .borderRadius(4)
        .backgroundColor($r('app.color.border'))
    }
  }
}
