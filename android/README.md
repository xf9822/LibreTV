# LibreTV 安卓 App

两个版本（Gradle 的 `phone` / `tv` 变体，代码共用）：手机版投屏到电视；电视版（包名 `io.github.wxst.libretv.tv`）出现在电视桌面（Leanback），User-Agent 带 ` TV`，网站据此切换成遥控器操作的界面（`js/tv-mode.js`），且只申请上网权限。

一个很小的外壳：全屏 WebView 打开你自己部署的 LibreTV 网站，并补上浏览器做不到的三件事：

- **DLNA 投屏**：`DlnaClient.java` 用 SSDP 组播查找局域网里带 AVTransport 服务的电视（媒体渲染器），用 SOAP 让电视播放视频地址（`SetAVTransportURI` → `Play`，以及 `Pause` / `Seek` / `Stop`）。只用 `java.net`，不依赖第三方库。
- **有声自动播放**：`setMediaPlaybackRequiresUserGesture(false)`。
- **全屏横屏**：视频进入全屏时切到横屏并隐藏系统栏。

返回键先交给网页的 `window.LibreTVBack()`（关闭选集、设置面板、退出网页全屏），网页没处理才后退或退出。网页通过 `window.LibreTVApp` 调用 App（`discover`、`control`、`keepScreenOn`、`siteUrl`、`changeSite`、`version`），App 把结果回调到网页的 `window.LibreTVCast`（见 `js/app-cast.js`）。网站地址在第一次打开时输入，保存在 App 本地，不写进代码。

## 权限

只申请两个权限，都是安装时自动授予的普通权限，不会弹窗：

| 权限 | 安装界面显示 | 用途 |
|---|---|---|
| `INTERNET` | 完全的网络访问权限 | 打开网站、播放视频、给电视发投屏指令 |
| `CHANGE_WIFI_MULTICAST_STATE` | 允许接收 WLAN 多播 | 在 Wi-Fi 里用组播查找电视（DLNA 发现设备靠组播） |

不读取通讯录、存储、定位、电话或设备信息。

## 编译

需要 JDK 17+ 和 Android SDK（platform 35、build-tools 35）。

```bash
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew testPhoneReleaseUnitTest   # DLNA 单元测试
./gradlew assemblePhoneRelease assembleTvRelease
# 输出 app/build/outputs/apk/phone/release/app-phone-release.apk 和 app/build/outputs/apk/tv/release/app-tv-release.apk
```

## 签名

正式版必须一直用同一个签名密钥，否则手机会拒绝覆盖安装旧版本。密钥不进仓库，编译时从 `android/keystore.properties`（已在 `.gitignore` 中）或环境变量读取：

```properties
storeFile=/path/to/libretv-release.jks
storePassword=******
keyAlias=libretv
keyPassword=******
```

对应的环境变量：`LIBRETV_KEYSTORE`、`LIBRETV_KEYSTORE_PASSWORD`、`LIBRETV_KEY_ALIAS`、`LIBRETV_KEY_PASSWORD`。云端编译环境里不方便放文件时，可以把密钥文件转成 Base64 放进 `LIBRETV_KEYSTORE_BASE64`（`base64 -w0 libretv-release.jks`），再配上 `LIBRETV_KEYSTORE_PASSWORD`，别名默认 `libretv`、密钥密码默认与密钥库密码相同。没有配置签名时只能编译调试包（`assembleDebug`）。

当前发布的 APK 证书 SHA-256：`17:AF:9C:A2:70:B6:2A:90:8E:DF:89:68:0C:D0:66:87:9D:70:DC:76:79:2C:0C:7C:26:5E:F3:23:26:1E:A7:D9`

## 发布

编译后把手机版复制为仓库根目录的 `download/LibreTV.apk`、电视版复制为 `download/LibreTV-TV.apk`，随网站一起部署：网站设置里的「安卓 App」卡片指向它们。改了 App 的代码要同时把 `app/build.gradle` 的 `versionCode` 加一、`versionName` 更新，否则手机不会提示升级。
