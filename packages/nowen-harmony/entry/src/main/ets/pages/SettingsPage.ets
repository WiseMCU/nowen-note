import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import { Constants } from '../constants/Constants';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct SettingsPage {
  @State username: string = '';
  @State serverUrl: string = '';
  @State isLoggingOut: boolean = false;
  private viewModel: AppViewModel = AppViewModel.getInstance();

  async aboutToAppear(): Promise<void> {
    this.username = await Constants.getUsername();
    this.serverUrl = await Constants.getServerUrl();
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Text($r('app.string.settings_title'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      // 用户信息卡片
      Column() {
        Row() {
          Stack() {
            Circle()
              .width(48)
              .height(48)
              .fill($r('app.color.primary'))
            Text(this.username.charAt(0).toUpperCase())
              .fontSize(20)
              .fontColor(Color.White)
              .fontWeight(FontWeight.Bold)
          }
          .margin({ right: 16 })

          Column() {
            Text(this.username)
              .fontSize(16)
              .fontWeight(FontWeight.Medium)

            Text(this.serverUrl)
              .fontSize(12)
              .fontColor($r('sys.color.ohos_id_color_text_secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .margin({ top: 2 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(12)
      .margin({ left: 16, right: 16, top: 8 })

      // 设置列表
      List({ space: 0 }) {
        ListItemGroup({ header: this.SectionHeader('通用') }) {
          ListItem() {
            this.SettingRow('服务器设置', '', () => {
              router.pushUrl({ url: 'pages/ServerConfigPage' });
            })
          }
        }

        ListItemGroup({ header: this.SectionHeader('数据') }) {
          ListItem() {
            this.SettingRow('数据管理', '导入/导出/备份', () => {
              promptAction.showToast({ message: '开发中' });
            })
          }
          ListItem() {
            this.SettingRow('清除缓存', '', () => {
              promptAction.showToast({ message: '开发中' });
            })
          }
        }

        ListItemGroup({ header: this.SectionHeader('关于') }) {
          ListItem() {
            this.SettingRow('版本', '1.0.0', () => {})
          }
          ListItem() {
            this.SettingRow('开源许可', '', () => {
              promptAction.showToast({ message: '开发中' });
            })
          }
        }
      }
      .width('100%')
      .layoutWeight(1)
      .margin({ top: 16 })
      .divider({ strokeWidth: 0.5, color: $r('app.color.border') })

      // 退出登录
      Button($r('app.string.settings_logout'))
        .width('90%')
        .height(48)
        .borderRadius(8)
        .type(ButtonType.Capsule)
        .backgroundColor($r('app.color.danger'))
        .fontColor(Color.White)
        .fontSize(16)
        .margin({ top: 16, bottom: 32 })
        .enabled(!this.isLoggingOut)
        .onClick(() => this.handleLogout())
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  SectionHeader(title: string): void {
    Row() {
      Text(title)
        .fontSize(12)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        .fontWeight(FontWeight.Medium)
    }
    .width('100%')
    .padding({ left: 16, top: 16, bottom: 4 })
  }

  @Builder
  SettingRow(title: string, subtitle: string, onTap: () => void): void {
    Row() {
      Column() {
        Text(title)
          .fontSize(15)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))

        if (subtitle) {
          Text(subtitle)
            .fontSize(12)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
            .margin({ top: 2 })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Image($r('sys.media.ohos_ic_public_arrow_right'))
        .width(20)
        .height(20)
        .fillColor($r('sys.color.ohos_id_color_text_secondary'))
    }
    .width('100%')
    .height(48)
    .padding({ left: 16, right: 16 })
    .onClick(() => onTap())
  }

  private async handleLogout(): Promise<void> {
    this.isLoggingOut = true;
    try {
      await this.viewModel.logout();
      router.replaceUrl({ url: 'pages/LoginPage' });
    } catch (e) {
      promptAction.showToast({ message: '退出失败' });
    } finally {
      this.isLoggingOut = false;
    }
  }
}
