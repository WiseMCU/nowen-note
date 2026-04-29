import router from '@ohos.router';
import { Constants } from '../constants/Constants';
import { HttpClient } from '../network/HttpClient';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct ServerConfigPage {
  @State serverUrl: string = '';
  @State isConnecting: boolean = false;
  @State isHealthOk: boolean = false;

  async aboutToAppear(): Promise<void> {
    this.serverUrl = await Constants.getServerUrl();
    if (!this.serverUrl) {
      this.serverUrl = Constants.DEFAULT_SERVER_URL;
    }
  }

  build() {
    Navigation() {
      Column() {
        Text($r('app.string.server_config_title'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .margin({ bottom: 24 })

        Text('请输入 Nowen Note 后端服务地址')
          .fontSize(14)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          .width('100%')
          .margin({ bottom: 16 })

        TextInput({ placeholder: 'http://192.168.1.100:3001', text: this.serverUrl })
          .width('100%')
          .height(48)
          .borderRadius(8)
          .padding({ left: 16, right: 16 })
          .type(InputType.Normal)
          .onChange((value: string) => { this.serverUrl = value; })

        Text('提示：确保手机与服务器在同一局域网内')
          .fontSize(12)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          .width('100%')
          .margin({ top: 8 })

        Button($r('app.string.server_connect'))
          .width('100%')
          .height(48)
          .borderRadius(8)
          .type(ButtonType.Capsule)
          .backgroundColor($r('app.color.primary'))
          .fontColor(Color.White)
          .fontSize(16)
          .margin({ top: 24 })
          .enabled(!this.isConnecting && this.serverUrl.length > 0)
          .onClick(() => this.handleConnect())

        if (this.isHealthOk) {
          Row() {
            Text('\u2713')
              .fontColor($r('app.color.success'))
              .fontSize(16)
              .margin({ right: 4 })
            Text('服务器连接成功')
              .fontSize(14)
              .fontColor($r('app.color.success'))
          }
          .margin({ top: 16 })
        }
      }
      .width('100%')
      .padding({ left: 24, right: 24, top: 24 })
    }
    .titleMode(NavigationTitleMode.Mini)
    .mode(NavigationMode.Stack)
    .navDestination(this.buildNavDestination())
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  buildNavDestination(): void {
    // placeholder
  }

  private async handleConnect(): Promise<void> {
    this.isConnecting = true;
    this.isHealthOk = false;
    try {
      const url = this.serverUrl.replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) {
        promptAction.showToast({ message: '请输入有效的 HTTP/HTTPS 地址' });
        return;
      }
      HttpClient.getInstance().setBaseUrl(url);
      const isOk = await import('../network/ApiService').then(m => m.ApiService.healthCheck());
      if (isOk) {
        await Constants.setServerUrl(url);
        this.isHealthOk = true;
        promptAction.showToast({ message: '连接成功' });
        setTimeout(() => {
          router.back();
        }, 1000);
      } else {
        promptAction.showToast({ message: '服务器连接失败，请检查地址' });
      }
    } catch (e) {
      promptAction.showToast({ message: `连接失败: ${e}` });
    } finally {
      this.isConnecting = false;
    }
  }
}
