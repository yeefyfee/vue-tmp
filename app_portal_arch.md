# App 大门户 · 架构设计文档

> 版本 v1.0 · 2026-09-29
> 后端复用 `niulai-nest`，客户端采用 **Flutter**（Android + Windows Desktop）

---

## 一、设计目标

这是一个**门户型 App**：以「功能宫格」为入口，后续不断挂载各类功能模块（物品收纳、记账、待办、健康记录……）。

因此架构的第一诉求不是"把收纳做完"，而是**让第 2、第 3 个模块的接入成本趋近于零**。围绕这个目标，确定四条设计原则：

| 原则 | 具体含义 |
| --- | --- |
| **模块自洽** | 每个功能模块自带页面、状态、数据源、路由，删掉一个模块不影响其它模块 |
| **契约先行** | 模块与后端只通过 `ApiClient` + 明确的数据模型交互，不互相 import 内部实现 |
| **统一骨架** | 登录态、主题、路由、错误处理、加载态全部收口到 `core/`，模块不重复造轮子 |
| **可插拔注册** | 新增模块 = 在功能注册表加一条记录，首页宫格与路由自动生效 |

---

## 二、技术选型

| 层面 | 选型 | 理由 |
| --- | --- | --- |
| 状态管理 | **Riverpod 3.x** (`flutter_riverpod` + `riverpod_annotation`) | 编译期安全、天然支持依赖注入、脱离 Widget 树读取状态，适合模块多、依赖复杂的中大型工程 |
| 路由 | **go_router** | 声明式路由、支持嵌套与重定向，登录守卫可集中在 `redirect` 一处处理 |
| 网络 | **dio** + 自定义拦截器 | 生态成熟，拦截器可整洁地承载「鉴权注入 / 统一响应解包 / Token 刷新 / 错误映射」四件事 |
| 数据模型 | **freezed** + **json_serializable** | 不可变模型 + 自动生成的 `fromJson`/`copyWith`，杜绝手写样板 |
| 本地存储 | **flutter_secure_storage**（Token）+ **shared_preferences**（偏好） | Token 属敏感数据必须走系统密钥链，偏好配置走轻量存储 |
| 图片 | **image_picker** + **cached_network_image** | 相册选取/拍照 + 网络图缓存 |
| 主题 | Material 3 + 自定义 `AppTheme` | 统一色彩、圆角、间距，支持浅色/深色跟随系统 |

> 选 Riverpod 而非 Provider：门户的典型痛点是「一个 AuthState 被首页、个人中心、各业务模块同时依赖」，Riverpod 的全局 Provider 与 `ref.watch` 细粒度重建能显著减少无谓刷屏；同时它不依赖 `BuildContext`，便于在拦截器、Service 层读取登录态。

---

## 三、分层架构

采用 **Layered + Feature-First**：横向分层（core / shared / features），纵向按功能切分。

```
lib/
├── main.dart                    # 入口：初始化依赖、挂载 ProviderScope
├── app.dart                     # MaterialApp.router 装配（主题 + 路由 + 全局 Provider）
│
├── core/                        # 基础设施层（与业务无关，全模块复用）
│   ├── config/
│   │   ├── app_config.dart      # 环境配置（API 地址、超时、开关）
│   │   └── env.dart             # 编译期环境（dev / prod）
│   ├── network/
│   │   ├── api_client.dart      # Dio 实例装配
│   │   ├── api_endpoints.dart   # 所有接口路径常量（单一出处）
│   │   ├── api_response.dart    # 统一响应模型 { code, msg, data }
│   │   ├── api_exception.dart   # 业务异常 / 网络异常 / 鉴权异常
│   │   └── interceptors/
│   │       ├── auth_interceptor.dart      # 注入 Bearer Token
│   │       ├── response_interceptor.dart  # 解包 code/msg/data，判定成败
│   │       ├── error_interceptor.dart     # 异常归一化
│   │       └── logger_interceptor.dart    # 调试期请求日志
│   ├── storage/
│   │   ├── token_storage.dart   # Token 安全读写
│   │   └── pref_storage.dart    # 偏好设置
│   ├── router/
│   │   ├── app_router.dart      # go_router 配置 + 登录守卫
│   │   └── route_names.dart     # 路由名常量
│   ├── theme/
│   │   ├── app_theme.dart       # ThemeData 工厂（亮/暗）
│   │   ├── app_colors.dart      # 色板
│   │   └── app_spacing.dart     # 间距/圆角规范
│   ├── utils/
│   │   ├── date_util.dart
│   │   ├── formatter_util.dart  # 金额、文件大小等格式化
│   │   └── toast_util.dart      # 统一提示
│   └── constants/
│       └── app_constants.dart
│
├── shared/                      # 跨模块共享 UI 与通用能力
│   ├── widgets/
│   │   ├── app_scaffold.dart    # 统一页面骨架（AppBar + 安全区）
│   │   ├── loading_view.dart    # 加载态
│   │   ├── empty_view.dart      # 空态
│   │   ├── error_view.dart      # 错误态 + 重试
│   │   ├── async_view.dart      # AsyncValue → 三态渲染封装
│   │   ├── app_button.dart
│   │   ├── app_text_field.dart
│   │   └── app_dialog.dart
│   ├── models/
│   │   └── page_result.dart     # 分页结果通用模型
│   └── extensions/
│       └── context_ext.dart     # BuildContext 便捷方法
│
└── features/                    # 业务功能模块（每个模块自洽）
    ├── auth/                    # 认证模块
    │   ├── data/
    │   │   ├── models/          # UserInfo, LoginResult
    │   │   └── auth_repository.dart
    │   ├── providers/
    │   │   └── auth_provider.dart   # AuthState + Notifier
    │   └── presentation/
    │       ├── pages/login_page.dart
    │       └── widgets/login_form.dart
    │
    ├── portal/                  # 门户首页（功能入口聚合）
    │   ├── data/
    │   │   └── feature_registry.dart  # ⭐ 功能注册表（扩展点）
    │   ├── providers/
    │   │   └── portal_provider.dart
    │   └── presentation/
    │       ├── pages/
    │       │   ├── portal_shell.dart  # 底部导航容器
    │       │   ├── home_page.dart     # 功能宫格首页
    │       │   ├── apps_page.dart     # 全部功能列表
    │       │   └── profile_page.dart  # 个人中心
    │       └── widgets/
    │           ├── feature_grid.dart
    │           ├── feature_card.dart
    │           └── greeting_header.dart
    │
    └── storage/                 # 个人物品收纳模块
        ├── data/
        │   ├── models/          # StorageItem, Category, Tag, Overview
        │   └── storage_repository.dart
        ├── providers/
        │   ├── item_list_provider.dart
        │   ├── category_provider.dart
        │   └── tag_provider.dart
        └── presentation/
            ├── pages/
            │   ├── storage_home_page.dart    # 收纳首页（概览+分类入口）
            │   ├── item_list_page.dart       # 物品列表（搜索/筛选）
            │   ├── item_detail_page.dart     # 物品详情
            │   ├── item_form_page.dart       # 新增/编辑
            │   ├── category_manage_page.dart # 分类管理
            │   └── tag_manage_page.dart      # 标签管理
            └── widgets/
                ├── item_card.dart
                ├── category_chip.dart
                └── quantity_stepper.dart
```

### 依赖方向（严格单向，禁止反向 import）

```
presentation  →  providers  →  data(repository)  →  core/network
      ↓                                                    ↑
   shared/widgets  ←──────────────────────────────────────┘
```

- `core/` 不 import 任何 `features/` 内容
- `shared/` 只依赖 `core/`，不依赖具体 feature
- feature 之间**不直接互相 import**；需要共享时下沉到 `shared/` 或 `core/`

---

## 四、核心机制

### 4.1 统一响应解包

后端返回固定结构（与 `vue3-element-admin` 一致）：

```json
{ "code": "00000", "msg": "成功", "data": { ... } }
```

`ResponseInterceptor` 统一处理：

- `code == "00000"` → 直接 resolve `data`，业务层拿到的就是纯数据
- 分页接口 `data: { list, total }` → 解包为 `PageResult<T>`
- `code` 属鉴权失效（`A0230` / `A0231`）→ 抛 `UnauthorizedException`，由全局逻辑跳登录
- 其它 → 抛 `ApiException(code, msg)`

这样 Repository 层代码保持极简：

```dart
Future<PageResult<StorageItem>> fetchItems({int pageNum = 1, ...}) async {
  final data = await _client.get(ApiEndpoints.storageItems, queryParameters: {...});
  return PageResult.fromJson(data, StorageItem.fromJson);
}
```

### 4.2 鉴权与 Token 刷新

```
请求 → AuthInterceptor 注入 Bearer
     → 响应 401 / code=A0230
     → RefreshInterceptor 用 refreshToken 换新 token（并发请求排队等待）
     → 重放原请求
     → 刷新也失败 → 清空登录态 → go_router redirect 到 /login
```

并发刷新用 `Completer` 做单飞控制，避免同时发起多次刷新。

### 4.3 功能注册表（门户扩展的核心）

`feature_registry.dart` 是新增模块的**唯一接入点**：

```dart
class FeatureEntry {
  final String id;            // 'storage'
  final String title;         // '物品收纳'
  final IconData icon;
  final Color color;
  final String route;         // '/storage'
  final bool requiresAuth;
  final int order;            // 宫格排序
}

const kFeatureRegistry = <FeatureEntry>[
  FeatureEntry(id: 'storage', title: '物品收纳', icon: Icons.inventory_2_outlined,
               color: Color(0xFF4F7CFF), route: '/storage', requiresAuth: true, order: 1),
  // 后续新增模块只需在此追加一行 + 在路由表注册对应 GoRoute
];
```

首页宫格、全部功能页、路由表全部由这份注册表驱动，新增模块**不需要改动首页代码**。

### 4.4 三态渲染

所有异步页面统一用 `AsyncView` 包裹，消除重复的 loading/error/empty 分支：

```dart
AsyncView<PageResult<StorageItem>>(
  value: ref.watch(itemListProvider),
  onRetry: () => ref.invalidate(itemListProvider),
  builder: (data) => ItemListView(items: data.list),
)
```

---

## 五、后端接口契约

后端新增 `StorageModule`（`/api/v1/storage`），全部接口按 `ownerId` 做数据隔离。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/storage/overview` | 收纳概览统计 |
| GET | `/storage/items` | 物品分页列表（keywords / categoryId / tagId / status / sortBy） |
| GET | `/storage/items/:id` | 物品详情（含标签） |
| POST | `/storage/items` | 新增物品 |
| PUT | `/storage/items/:id` | 修改物品 |
| DELETE | `/storage/items/:ids` | 删除物品（逗号分隔批量，逻辑删除） |
| PATCH | `/storage/items/:id/quantity` | 调整数量 `{ delta }` |
| PATCH | `/storage/items/:id/status?status=` | 归档 / 恢复 |
| GET | `/storage/categories` | 分类分页列表（含物品数） |
| GET | `/storage/categories/options` | 分类下拉选项 |
| POST/PUT/DELETE | `/storage/categories[/:id\|/:ids]` | 分类增改删 |
| GET | `/storage/tags` | 标签列表（含物品数） |
| POST/PUT/DELETE | `/storage/tags[/:id\|/:ids]` | 标签增改删 |

复用现有认证体系：
- 登录：`POST /api/v1/auth/login`（body 含 `username` / `password` / `captchaId` / `captchaCode`）
- 图形验证码：`GET /api/v1/auth/captcha` → `{ captchaBase64, captchaId }`
- 当前用户：`GET /api/v1/users/me`
- 文件上传：`POST /api/v1/files`（multipart，字段名 `file`）→ `{ name, url }`

### 数据模型（单分类 + 多标签）

```
storage_category (扁平分类)
  id, name, icon, color, sort, status, remark, owner_id
        ↑ 1:N (item.category_id)
storage_item
  id, name, category_id, cover_url, image_urls(json), quantity, unit,
  price, purchase_date, expire_date, location, remark, status, owner_id
        ↕ N:M (storage_item_tag)
storage_tag
  id, name, color, owner_id
```

- `owner_id IS NULL` 表示**公共分类/标签**，所有用户可见但不可修改；
- 物品的 `owner_id` 必填，所有查询强制带 `owner_id` 过滤，从数据层保证隔离。

---

## 六、扩展指南：如何新增一个功能模块

以"记账"模块为例，只需四步：

1. **建目录** `lib/features/ledger/{data,providers,presentation}`
2. **写数据层**：models + repository，复用 `ApiClient` 与 `ApiEndpoints`
3. **写状态层**：`Notifier` / `FutureProvider`
4. **接路由**：在 `route_names.dart` 加常量、`app_router.dart` 注册 `GoRoute`，
   并在 `feature_registry.dart` 追加一条 `FeatureEntry`

首页宫格、全部功能页、登录守卫**自动生效**，无需改动门户代码。

---

## 七、开发与运行

```bash
# 后端（端口 8000）
cd niulai-nest
# 1) 先导入建表脚本（公共分类/标签会一并初始化）
#    mysql -u root -p nest_db < sql/mysql/storage_module.sql
pnpm start:dev

# 客户端
cd app_portal
flutter pub get
flutter run -d windows     # 桌面调试（最快）
flutter run -d android     # 真机/模拟器
```

后端接口文档：<http://localhost:8000/api/v1/api-docs>

> ⚠️ 客户端默认 API 地址由 `core/config/app_config.dart` 控制：
> - Android 模拟器访问宿主机需用 `10.0.2.2:8000`
> - Windows 桌面直接用 `localhost:8000`
> 已在 `app_config.dart` 按平台自动分支处理。

---

## 八、代码规范

| 项 | 约定 |
| --- | --- |
| 文件命名 | `snake_case.dart` |
| 类命名 | `PascalCase`，页面以 `Page` 结尾，Provider 以 `Provider` 结尾 |
| 模型 | 手写不可变类（`final` 字段 + `const` 构造 + 工厂 `fromJson` / `toJson`）；如需 `copyWith` 自行补充，**不引入 freezed 代码生成** |
| 状态 | 用 `AsyncValue` 表达加载/成功/失败，禁止在 UI 里手写 `isLoading` 标志位 |
| 异常 | 业务异常统一抛 `ApiException`，UI 层不解析 `code` |
| 常量 | 接口路径集中在 `ApiEndpoints`，禁止在 Repository 里写字符串路径 |
| 主题 | 颜色/间距一律取自 `AppColors` / `AppSpacing`，禁止硬编码色值 |

> 说明：`pubspec.yaml` 中保留的 `freezed` / `json_serializable` / `build_runner` 为可选依赖，
> 当前实现**未使用代码生成**；若不打算启用，可将其移除以免每次 `pub get` 拉取多余包。
> 若启用，需在模型上加 `@freezed` 并执行 `dart run build_runner build`。

---

## 九、交付物与验证状态

### 工程结构（已落地）

```
app_portal/
├── android/            24 文件 —— 标准模板（AGP 8.9.1 / Gradle 8.12 / Kotlin 2.1.0，Kotlin DSL）
├── windows/            15 文件 —— 标准模板（CMake + runner 全套）
├── lib/                42 个 Dart 文件
│   ├── core/           config / network / storage / theme / router / utils / providers
│   ├── shared/         models / widgets
│   └── features/
│       ├── auth/       登录（模型 + repository + provider + 页面）
│       ├── portal/     门户壳层、首页宫格、全部功能、我的 + ⭐ feature_registry
│       └── storage/    个人物品收纳（物品 / 分类 / 标签）
├── pubspec.yaml
├── pubspec.lock        135 个依赖已解析
└── .metadata / .gitignore
```

- 工程名 `app_portal`，包名 / namespace `com.niulai.app_portal`
- 目标平台：**Android + Windows Desktop**

### 验证状态

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 依赖解析 | ✅ | `dart pub get` 成功，`Changed 135 dependencies!` |
| 静态分析 | ✅ | 42 个文件 **0 error / 0 warning / 0 info**（全量 LSP 诊断） |
| 后端编译 | ✅ | `niulai-nest` storage 模块编译通过 |
| 真机编译 | ⏳ 待用户执行 | `flutter build windows` / `flutter build apk` |

### ⚠️ 本机环境注意事项（重要）

本机沙箱在长会话或桌面高负载下，**Dart / Node 会无法创建任何子进程**，报：

```
CreateFile failed 231                       ← ERROR_PIPE_BUSY
ProcessException: 所有的管道范例都在使用中。
```

表现为 `flutter.bat` 启动即崩（`Unable to create dart snapshot for flutter tool`）、`dart analyze` 失败、
`flutter pub get` 失败。**这与代码无关**，是会话级 handle 资源压力。

已确定的绕行方式：

| 目标 | 做法 |
| --- | --- |
| 让 flutter 命令能跑 | 已生成 `<sdk>/bin/cache/flutter.version.json`，跳过 git 版本探测 |
| `flutter create` 等 | 直接跑 `<sdk>/bin/cache/flutter_tools.snapshot` |
| 依赖解析 | 直接 `dart pub get`（不经 flutter 包装层） |
| 静态分析 | 见 skill `flutter-sandbox-workaround` 的 `scripts/lsp_analyze.py` |
| **真实编译 / 运行** | **交给用户在自己的终端执行** |

🔴 `flutter.bat` 子进程失败时会**无限重试并堆积 38MB 的 `flutter_tools.snapshot.old*`**
（实测一次事故累积 39 个 ≈ 1.5GB）。**发现失败要立刻杀掉整个进程树**：

```
tasklist /FO CSV /V /FI "IMAGENAME eq cmd.exe"      # 找 CPU 时间异常、标题为空的
taskkill /F /T /PID <该 PID>
```

---

## 十、在用户终端执行的完整启动步骤

```bash
# 1) 后端：建表 + 启动（端口 8000）
cd niulai-nest
mysql -u root -p nest_db < sql/mysql/storage_module.sql
pnpm start:dev

# 2) 客户端：拉依赖 + 运行
cd app_portal
flutter pub get
flutter run -d windows       # Windows 桌面（最快验证路径）
flutter run -d android       # Android 模拟器/真机

# 3) 发布构建
flutter build windows --release
flutter build apk --release
```

