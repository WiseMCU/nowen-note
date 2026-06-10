# Android 运行时排查清单

这份文档记录一次真实排查里踩过的坑，目标不是复盘情绪，而是把经验沉淀成以后可重复执行的检查步骤。

适用场景：

- Android APK 已重新编译，但界面看起来“没有变化”
- 浏览器里验证正常，Android 原生壳里仍然异常
- 用户截图与本地验证结果冲突
- 文件管理、AI 面板、复制按钮、侧边栏等移动端 UI 在 Web 和 Android 上表现不一致

## 先记住的几条经验

1. **浏览器手机视口验证，不等于 Android WebView 验证。**
   Vite 页面、Docker 页面、Android 壳内页面，可能根本不是同一份前端。

2. **“编译成功”不等于“新包已经真正装到设备上”。**
   `installDebug` 成功后，仍要核对设备上的包版本、安装时间、实际 APK 哈希。

3. **“包里是新代码”不等于“运行时已经进入目标页面”。**
   Android 壳可能还停在登录页、空白页、加载页，或者连到了错误的后端。

4. **用户截图优先级高于本地想当然。**
   如果用户截图和本地结论冲突，不要先解释“我这里是好的”，先验证运行时事实。

5. **要先区分问题属于哪一层。**
   一次排查里至少要分清：
   - 本地前端开发页（例如 `http://127.0.0.1:5173`）
   - 本地或 Docker 的后端服务（例如 `http://127.0.0.1:3001`）
   - Android WebView 当前实际加载的页面（例如 `https://localhost/`）

## 本次踩坑后定下来的标准流程

### 1. 先确认自己在看哪一份页面

不要看到 `127.0.0.1:3001` 就默认那是当前工作区的最新页面。

排查时先回答这三个问题：

- 当前浏览器打开的是 Vite dev server、Docker 部署，还是别的历史实例？
- Android App 里加载的是内置静态资源，还是 Live Reload / 外部 `server.url`？
- 用户截图来自手机 App、模拟器，还是内置浏览器？

如果这一步没做，后面所有“已经修好 / 还没修好”的判断都可能是错的。

### 2. 构建后先同步，再安装，再验设备

推荐顺序：

```bash
cd frontend
npm run cap:build

cd android
gradlew.bat installDebug
```

安装完成后，不要停在 “BUILD SUCCESSFUL”。

继续检查设备侧：

```bash
adb shell dumpsys package com.nowen.note
adb shell pm path com.nowen.note
```

至少确认：

- `versionName` / `versionCode` 是预期值
- 设备上确实存在当前包
- 安装时间发生了更新

必要时把本地 APK 与设备中的 `base.apk` 拉出来比哈希，排除“看似安装成功，其实装的还是旧包”：

```bash
adb pull <device-base.apk> ./emulator-base.apk
Get-FileHash .\app-debug.apk
Get-FileHash .\emulator-base.apk
```

### 3. 明确 Android WebView 当前实际加载的 URL

对 Capacitor Android，不要只看配置文件，要看运行时。

先拿进程 PID：

```bash
adb shell pidof com.nowen.note
```

再转发 WebView 调试端口：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

读取当前页面列表：

```bash
http://127.0.0.1:9222/json/list
```

本次排查里，真正运行中的页面是：

- `https://localhost/`

这一步的意义是：

- 可以确认没有误连到 Vite / Docker 的旧页面
- 可以直接知道 Android 壳是不是在加载内置静态资源

### 4. 不要只截屏，要读运行时 DOM

如果用户说 “按钮没出现”“布局还是旧的”，单靠截图可能会误判。

更稳的做法：

- 通过 WebView DevTools 读取 `document.body.innerText`
- 读取目标按钮的 `getBoundingClientRect()`
- 必要时确认 `window.innerWidth`、`devicePixelRatio`

例如这次排查里，就直接验证了：

- `图床`
- `选择`
- `上传文件`
- `清理未引用`

四个按钮在 Android WebView 的 412px 宽视口里都在屏内，而不是被裁掉。

结论要基于“运行时元素位置”，而不是基于肉眼猜测。

### 5. 如果页面不对，先确认是否真的进入了目标模块

一次很常见的误判是：

- 代码已经进包
- App 也已经更新
- 但运行时还停在登录页或加载页

这时你去看“文件管理有没有修好”，结论一定不可靠。

排查顺序应该是：

1. 先确认后端健康
2. 再确认 App 已登录
3. 再切到目标页面
4. 最后验证目标元素

本次实战里，先抓到 Android WebView 的真实文本，发现它当时还停在登录页；只有完成登录并切到文件管理后，顶栏按钮验证才有意义。

### 6. 模拟器访问宿主机后端要用 `10.0.2.2`

Android Emulator 里：

- `127.0.0.1` 指向模拟器自身
- 宿主机应通过 `10.0.2.2` 访问

所以当 APK 要连接本机后端 `:3001` 时，应验证：

```bash
http://10.0.2.2:3001/api/health
```

如果这一步没通，前端再新也只是空壳。

## 本次问题里最容易犯错的点

### 误区 1：把浏览器视口当成 Android 结果

浏览器里手机宽度正常，只能说明 CSS 在浏览器里正常；
不能说明 Capacitor Android 的安全区、字体缩放、容器宽度、WebView 行为也正常。

### 误区 2：看到用户截图没变化，就直接继续改样式

如果不先确认用户拿的包是不是最新，很容易进入“代码越改越多，但问题其实是旧包/旧页”的假修复循环。

### 误区 3：把 `127.0.0.1:3001` 当成唯一真相

一次线程里可能同时存在：

- 当前工作区 dev server
- 本机 Docker 旧部署
- Android 壳内置页面

它们都可能指向“本机”，但不是同一份前端。

### 误区 4：只看构建日志，不看设备运行时

`BUILD SUCCESSFUL` 只能说明构建/安装链路没有报错；
不能替代：

- 设备已安装目标版本
- WebView 已加载目标页面
- 用户实际问题已复现/已消失

## 建议加入回归标准

以后 Android UI 修复完成后，至少做下面 4 项再说“已修好”：

1. **构建与安装确认**
   - `cap:build`
   - `installDebug` 或正式包安装成功
   - 设备 `versionName` 正确

2. **运行时来源确认**
   - WebView 当前 URL 正确
   - 没连错旧 Docker / 旧 dev server

3. **目标页面确认**
   - 已登录
   - 已切到对应模块
   - 不是空白页 / 加载页 / 登录页

4. **目标元素确认**
   - 关键文本存在
   - 关键按钮可见
   - 必要时记录元素坐标或截图

## 建议保留的常用命令

```bash
# 构建并同步 Android 资源
cd frontend
npm run cap:build

# 安装调试包
cd android
gradlew.bat installDebug

# 查看设备上已安装包信息
adb shell dumpsys package com.nowen.note

# 查看包路径
adb shell pm path com.nowen.note

# 查看 App 进程 PID
adb shell pidof com.nowen.note

# 转发 WebView 调试端口
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

## 最后一句

Android 问题最怕“看起来像同一个页面，其实不是同一个运行时”。  
以后先分清页面来源、安装来源、运行时状态，再判断是不是代码问题，会省掉大量无效改动。
