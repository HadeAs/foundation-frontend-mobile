# WGT 热更新接入与发布指南

## 已实现的客户端流程

用户登录成功后立即检查更新，随后每隔 60 秒检查一次；已有登录会话的 App-Plus 冷启动也会恢复轮询。检查时读取原生版本、当前 WGT 版本和 uni 运行时版本，发现新版本后提示用户、下载 WGT、显示进度、安装并提示重启。重复检查会被合并；接口不可用、离线或无更新时静默跳过，不影响现有业务。

此功能只在 **App-Plus 自定义基座或正式安装包** 中生效。HBuilderX 内置浏览器是 H5，条件编译会移除 WGT 更新代码。

## 系统参数约定

在系统参数中新增以下两条记录：

```json
[
  {
    "configKey": "foundation.app.latest-version",
    "configValue": "1.0.0",
    "remark": "工业移动端最新 WGT 版本"
  },
  {
    "configKey": "foundation.app.wgt-file-id",
    "configValue": "123",
    "remark": "最新 WGT 在文件管理中的文件 ID"
  }
]
```

客户端启动时通过现有系统参数接口读取两个值：

```http
GET /api/v1/system/configs/value/foundation.app.latest-version
GET /api/v1/system/configs/value/foundation.app.wgt-file-id
```

第一个响应的 `data` 是最新版本号，例如 `1.0.1`；第二个响应的 `data` 是上传接口返回的 `fileId`。客户端比较最新版本与 `plus.runtime.getProperty` 返回的当前资源版本；仅当远端版本更高时下载：

```http
GET /api/v1/files/{fileId}/download
```

例如 `foundation.app.wgt-file-id=123`，下载地址就是 `/api/v1/files/123/download`。版本号必须是纯数字点分格式，文件 ID 必须是正整数。

系统参数读取和文件下载接口均受 Bearer 鉴权保护。客户端会携带已保存的登录 Token，并在登录成功后再次检查更新；因此无需开放匿名文件下载。

## 制作与发布 WGT

1. 保持 `src/manifest.json` 的 `appid` 与已安装 App 完全一致。
2. 将 `versionName` 从 `1.0.0` 递增为 `1.0.1`，同时递增 `versionCode`。
3. 使用与正式整包兼容的 HBuilderX/uni 编译器；不要用标准运行基座验证生产 WGT。
4. 在 HBuilderX 选择项目，执行“发行 → 原生 App-制作应用 wgt 包”。
5. 通过文件管理上传 WGT，记录上传响应 `data.fileId`，例如 `123`。
6. 将 `foundation.app.wgt-file-id` 改为 `123`，确认 `/api/v1/files/123/download` 能返回完整文件。
7. 最后将 `foundation.app.latest-version` 改为 `1.0.1`。版本参数必须最后修改，避免客户端提前下载错误文件。
8. 先向测试设备或小比例用户下发，验证登录、扫码、页面跳转和重启后的版本，再扩大范围。

原生插件、SDK、权限、App 图标或 `manifest.json` 原生能力发生变化时，必须发布新的 APK/IPA 整包，不能用 WGT。回滚也不能下发低版本；应使用旧代码重新制作一个更高版本号的 WGT。

## 验证清单

1. 用旧版本自定义基座或正式包连接测试环境并启动 App。
2. 确认出现更新说明，下载进度能到 100%，安装成功后可重启。
3. 重启后再次调用接口，应返回无更新；日志不应重复下载安装。
4. 分别验证取消更新、未登录读取、断网、无效版本号、下载 404 和损坏 WGT。

iOS App Store 对动态更新可执行代码限制严格；App Store 渠道应优先使用整包审核更新，WGT 仅用于符合组织分发政策的场景。
