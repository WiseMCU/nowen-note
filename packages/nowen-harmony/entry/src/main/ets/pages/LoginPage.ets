import router from '@ohos.router';
import { AppViewModel } from '../viewmodel/AppViewModel';
import { Constants } from '../constants/Constants';
import { HttpClient } from '../network/HttpClient';

@Entry
@Component
struct LoginPage {
  @State username: string = '';
  @State password: string = '';
  @State isLoading: boolean = false;
  @State errorMsg: string = '';
  @State allowRegister: boolean = true;
  @State hasServerUrl: boolean = false;
  private viewModel: AppViewModel = AppViewModel.getInstance();

  async aboutToAppear(): Promise<void> {
    const serverUrl = await Constants.getServerUrl();
    this.hasServerUrl = !!serverUrl;
    if (serverUrl) {
      HttpClient.getInstance().setBaseUrl(serverUrl);
      try {
        const { allowRegistration } = await import('../network/ApiService').then(m => m.ApiService.getRegisterConfig());
        this.allowRegister = allowRegistration;
      } catch (e) {
        this.allowRegister = true;
      }
    }
    const token = await Constants.getToken();
    if (token && serverUrl) {
      try {
        const user = await import('../network/ApiService').then(m => m.ApiService.verifyToken());
        this.viewModel.dispatch(import('../model/AppReducer').then(m => new m.AppAction(m.AppActionType.SET_USER, user)));
        this.viewModel.dispatch(import('../model/AppReducer').then(m => new m.AppAction(m.AppActionType.SET_AUTHENTICATED, true)));
        router.replaceUrl({ url: 'pages/MainPage' });
      } catch (e) {
        await Constants.clearToken();
      }
    }
  }

  build() {
    Column() {
      // Logo 区域
      Column() {
        Text($r('app.string.app_name'))
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
          .margin({ bottom: 8 })

        Text('连接你的笔记世界')
          .fontSize(14)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
      }
      .width('100%')
      .margin({ top: 80, bottom: 48 })

      // 表单
      Column() {
        TextInput({ placeholder: $r('app.string.login_username') })
          .width('100%')
          .height(48)
          .borderRadius(8)
          .padding({ left: 16, right: 16 })
          .backgroundColor($r('sys.color.ohos_id_color_background_transparent'))
          .onChange((value: string) => { this.username = value; })

        TextInput({ placeholder: $r('app.string.login_password') })
          .type(InputType.Password)
          .width('100%')
          .height(48)
          .borderRadius(8)
          .padding({ left: 16, right: 16 })
          .backgroundColor($r('sys.color.ohos_id_color_background_transparent'))
          .margin({ top: 12 })
          .onChange((value: string) => { this.password = value; })

        if (this.errorMsg) {
          Text(this.errorMsg)
            .fontSize(12)
            .fontColor($r('app.color.danger'))
            .width('100%')
            .margin({ top: 8 })
        }

        Button($r('app.string.login_button'))
          .width('100%')
          .height(48)
          .borderRadius(8)
          .type(ButtonType.Capsule)
          .backgroundColor($r('app.color.primary'))
          .fontColor(Color.White)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .margin({ top: 24 })
          .enabled(!this.isLoading && this.username.length > 0 && this.password.length > 0)
          .onClick(() => this.handleLogin())

        if (this.allowRegister) {
          Button($r('app.string.register_button'))
            .width('100%')
            .height(48)
            .borderRadius(8)
            .type(ButtonType.Capsule)
            .backgroundColor(Color.Transparent)
            .fontColor($r('app.color.primary'))
            .fontSize(16)
            .borderWidth(1)
            .borderColor($r('app.color.primary'))
            .margin({ top: 12 })
            .enabled(!this.isLoading && this.username.length > 0 && this.password.length > 0)
            .onClick(() => this.handleRegister())
        }

        // 服务器配置入口
        Text($r('app.string.settings_server'))
          .fontSize(14)
          .fontColor($r('app.color.primary'))
          .margin({ top: 24 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/ServerConfigPage' });
          })
      }
      .width('100%')
      .padding({ left: 32, right: 32 })

      if (this.isLoading) {
        LoadingProgress()
          .color($r('app.color.primary'))
          .width(32)
          .height(32)
          .margin({ top: 24 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
    .padding({ left: 16, right: 16 })
  }

  private async handleLogin(): Promise<void> {
    this.isLoading = true;
    this.errorMsg = '';
    try {
      await this.viewModel.login(this.username, this.password);
      router.replaceUrl({ url: 'pages/MainPage' });
    } catch (e) {
      this.errorMsg = e instanceof Error ? e.message : '登录失败';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleRegister(): Promise<void> {
    this.isLoading = true;
    this.errorMsg = '';
    try {
      await this.viewModel.register(this.username, this.password);
      router.replaceUrl({ url: 'pages/MainPage' });
    } catch (e) {
      this.errorMsg = e instanceof Error ? e.message : '注册失败';
    } finally {
      this.isLoading = false;
    }
  }
}
