# 1Panel 部署指南（vue3-element-admin）

适用于服务器使用 **1Panel 面板** 的场景。1Panel 的 Web 服务基于 **OpenResty**（Nginx 增强版），
且**运行在 Docker 容器中**，因此操作方式与裸装 Nginx 有几处关键差异，第五节会重点说明。

> 若服务器是裸装 Nginx（无面板），请直接使用 [`nginx.conf`](./nginx.conf)。

---

## 一、前置：安装 OpenResty

1. 1Panel 左侧菜单 → **应用商店** → 搜索 `OpenResty` → **安装**
2. 安装时勾选 **「端口外部访问」**（否则 80 / 443 不会放行，外网访问不到）

---

## 二、创建网站

1. 左侧菜单 → **网站** → **创建网站**
2. 网站类型选择 **静态网站**
3. 填写：
   - **主域名**：你的前端域名（如 `admin.example.com`）
   - **网站目录**：保持默认即可，形如
     `/opt/1panel/apps/openresty/openresty/www/sites/admin.example.com/index`
4. 点击确认创建

> ⚠️ **不要选「反向代理」类型建站**。
> 那会生成 `location ^~ / { proxy_pass ... }`，把**前端页面**的请求也一并转发给后端，静态站点直接失效。
> 正确做法是：建静态网站托管前端，再单独为 `/prod-api/` 加一条反代规则（见第五节）。

---

## 三、上传前端构建产物

在本地构建：

```bash
cd vue3-element-admin
pnpm build          # 产物在 dist/
```

把 `dist/` **里面的所有文件**（不是 `dist` 目录本身）上传到第二步的网站目录。

可用面板的「文件」功能上传压缩包后解压，或用 scp / rsync。

**目录层级验收**（最容易出错的一步）：

```text
✅ 正确                                  ❌ 错误（多了一层 dist）
网站目录/                                网站目录/
├─ index.html                           └─ dist/
├─ js/                                      ├─ index.html
├─ css/                                     ├─ js/
└─ favicon.ico                              └─ css/
```

上传后可在浏览器直接访问 `http://你的域名/`：能看到登录页即层级正确；
若返回 404 或目录列表，说明多套了一层目录。

---

## 四、配置 HTTPS

1. **网站** → 找到刚建的站点 → **配置** → **HTTPS**
2. 点击 **申请证书** → 选择 `Let's Encrypt` → 申请（域名需已解析到本机）
   或选择 **上传证书** 填入已有的证书文件
3. 开启 **「强制 HTTPS」**

---

## 五、配置接口反向代理（关键）

这一步等价于裸装 Nginx 里的 [`nginx.conf`](./nginx.conf) 中的 `location /prod-api/` 段落。

### 方式 A：用面板表单创建，再手工修正

1. **网站** → 站点 → **配置** → **反向代理** → **创建反向代理**
2. 填写：
   | 字段 | 值 |
   | --- | --- |
   | 名称 | `prod-api` |
   | 匹配规则 | `^~` |
   | 路径 | `/prod-api` |
   | 后端代理地址 | `https://api.theobuild.top` |
3. 确认创建

**创建后必须手工修正——这是 1Panel 特有的坑。**

1Panel 生成的反代片段里默认带这两行：

```nginx
proxy_ssl_server_name off;
proxy_ssl_name $proxy_host;
```

而本项目的后端 `api.theobuild.top` 处于 **Cloudflare 之后**（响应头中可见 `server: cloudflare`）。
反代 HTTPS 上游时**不发 SNI 就无法完成 TLS 握手**，表现为 502 / SSL 报错。所以必须改成：

```nginx
proxy_ssl_server_name on;
proxy_ssl_name api.theobuild.top;
```

需修改的文件（宿主机路径）：

```text
/opt/1panel/apps/openresty/openresty/www/sites/<你的域名>/proxy/prod-api.conf
```

> 该路径存在版本差异（部分版本为 `/opt/1panel/www/sites/...`），
> 可用下面这条命令确认 OpenResty 容器的实际挂载目录：
>
> ```bash
> docker inspect $(docker ps --format '{{.Names}}' | grep -i openresty | head -n1) \
>   --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
> ```

### 方式 B：直接编辑网站配置文件（推荐，最直观）

1. **网站** → 站点 → **配置** → **配置文件**
2. 在 `server { }` 内部加入下面这段（放在已有的 `location /` 之前），
   若方式 A 已生成过 `prod-api` 的反代 include，请先把对应内容删掉，避免重复：

```nginx
# ===== 接口反向代理：/prod-api/ → 后端 /api/v1/... =====
location ^~ /prod-api/ {
    # 前端与后端同机时建议改为：proxy_pass http://127.0.0.1:8000/;
    proxy_pass https://api.theobuild.top/;

    proxy_http_version 1.1;

    # 后端在 Cloudflare 之后，必须发 SNI（1Panel 默认是 off，务必改掉）
    proxy_ssl_server_name on;
    proxy_ssl_name        api.theobuild.top;

    proxy_set_header Host              api.theobuild.top;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header Connection        "";

    proxy_connect_timeout 30s;
    proxy_send_timeout    300s;
    # 兼容 SSE 长连接，避免 60s 默认超时被掐断
    proxy_read_timeout    3600s;

    # SSE 需要关闭缓冲
    proxy_buffering off;
    proxy_cache     off;
    proxy_redirect  off;
}
```

3. 点击 **保存并重载**

### ⚠️ 配置后仍报 404？先看 `proxy_pass` 有没有结尾斜杠

这是本项目部署时最高频的一个错误。Nginx 的规则是：

- `proxy_pass` **带 URI 部分**（域名后面有 `/`）→ 用它替换掉 location 匹配的前缀
- `proxy_pass` **不带 URI 部分**（域名后面什么都没有）→ **原样透传完整路径**，前缀不会被剥掉

> 注意：`proxy_pass` 带 URI 的写法**不适合 1Panel 的表单方式** ——
> 在面板「反向代理」里保存时，配置会按表单字段重新生成，你手补的尾斜杠可能被抹掉。
> 更稳妥的是下面第二节的 `rewrite` 写法，它不依赖尾斜杠。

实测对照（后端同一个接口，2026-09-29 实测）：

| 写法 | 实际转发到 | 结果 |
| --- | --- | --- |
| `proxy_pass https://api.theobuild.top;` | `.../prod-api/api/v1/auth/captcha` | **404** `{"code":"C0113","msg":"接口不存在"}` |
| `proxy_pass https://api.theobuild.top/;` | `.../api/v1/auth/captcha` | **200** `code=00000` |

`location` 本身也建议写规范：

```nginx
location ^~/prod-api     { }   # ✗ 能解析但不规范
location ^~ /prod-api/   { }   # ✓ 推荐：修饰符与路径间留空格，路径带尾斜杠
```

### 🔴 已补上尾斜杠，仍然报 `C0113 接口不存在`？

如果返回的仍是后端那段 JSON `{"code":"C0113","msg":"接口不存在"}`，
说明**请求确实到达了后端，但路径里还带着 `/prod-api`**。
此时问题已经不在斜杠写法上，而是 —— **你改的配置没有生效到运行中的 Nginx**。

判断依据（后端的三种响应是可以区分的）：

| 如果你看到 | 说明 |
| --- | --- |
| `{"code":"C0113","msg":"接口不存在"}` | 反代命中、请求到达后端，但**前缀没被剥掉** → 看本节 |
| HTML（`<!DOCTYPE html>` / `<div id="app">`） | 反代**没命中**，请求被 SPA 的 `try_files` 兜底吃掉了 → 看下一节 |
| 502 / SSL 错误 | `proxy_ssl_server_name` 仍为 `off` |

#### 零成本自查：不登录服务器也能判断（实测有效）

用浏览器直接打开下面这个地址（它只会被「前缀匹配」吃掉）：

```text
https://你的域名/prod-apixyz
```

| 结果 | 说明 |
| --- | --- |
| 返回后端 JSON `C0113` | 生效的 location 是 `location ^~ /prod-api`（**无尾斜杠**），且 `proxy_pass` 不带 URI → **前缀一定不会被剥掉** |
| 返回 openresty 的 404 页 | location 带尾斜杠（`^~ /prod-api/`），`/prod-apixyz` 不匹配 → 说明前缀剥离多半已生效 |

同样的手法，用「前缀里加个字符」也能验证是否被前缀匹配吞掉：

| 请求路径 | 预期 |
| --- | --- |
| `/xprod-api/api/v1/auth/captcha` | 应返回 openresty 404（前缀从头匹配，不该命中） |
| `/prod-api/__notexist__` | 返回后端 `C0113` 说明反代已命中 |

#### 第一步：看运行中的真实配置（决定性）

`nginx -T` 输出的是**所有 include 合并后的最终配置**，且每个片段前会标明来源文件：

```bash
NAME=$(docker ps --format '{{.Names}}' | grep -i openresty | head -n1)

# 若提示 nginx: command not found，换成这个完整路径：
#   /usr/local/openresty/nginx/sbin/nginx -T
docker exec "$NAME" nginx -T > /tmp/nginx-running.conf 2>&1

# 看 /prod-api 相关段落的真实内容与来源文件
grep -n -B4 -A16 'prod-api' /tmp/nginx-running.conf
```

重点确认三件事：

1. **`proxy_pass` 实际写的是什么** —— 有没有 `/`，或者有没有 `rewrite`；
2. **是否存在两个** `prod-api` 的 location —— 一个来自面板「反向代理」生成的
   `sites/<域名>/proxy/prod-api.conf`，一个来自你手改的站点「配置文件」；
3. **这段配置落在哪个 server 块** —— 开「强制 HTTPS」后，80 端口那块通常只有 `return 301`。

#### 第二步：查有没有语法错误导致重载失败

```bash
docker exec "$NAME" nginx -t
```

面板点「保存并重载」时若报 `duplicate location` 之类的错误，
**旧配置会继续服务**，表现就是「我明明改了却毫无变化」。这种情况必须先删掉重复的那一份。

#### 最常见的几个原因

| 情况 | 说明 |
| --- | --- |
| 改完**毫无变化** | 用面板「反向代理」**表单**保存时，会按字段值**重新生成** `proxy/prod-api.conf`，把你手工补的尾斜杠覆盖掉（表单的目标地址栏通常不保留末尾 `/`） |
| 改完**毫无变化** | 站点「配置文件」里又加了一份，与 `proxy/prod-api.conf` 里的重复 → 重载失败 → 旧配置继续跑 |
| 只在 **80 端口**生效 | 配置加到了 `return 301` 的那个 server 块里 |
| `location` 尾斜杠没写 | `location ^~ /prod-api` 会连 `/prod-apixyz` 这种无关路径一起吞掉（前缀匹配）。建议写成 `location ^~ /prod-api/` |
| **`proxy_pass` 里是变量** | 形如 `proxy_pass $target;` 时，nginx **不会做前缀替换**，此时必须自己用 `rewrite`/`$request_uri` 处理路径。看到变量写法就改用本节推荐的 `rewrite` 方案 |

> 结论：**不要靠手补尾斜杠** —— 只要你在面板表单里点过保存，它就可能被复原。
> 改用下面这种写法，从根上免疫。

#### 推荐改法：用 `rewrite` 显式剥前缀

这样写，无论面板把目标地址记成 `https://api.theobuild.top` 还是 `https://api.theobuild.top/`，
前缀都一定会被剥掉：

```nginx
location ^~ /prod-api/ {
    # 显式剥掉 /prod-api 前缀，不依赖 proxy_pass 的尾斜杠规则
    rewrite ^/prod-api/(.*)$ /$1 break;

    proxy_pass https://api.theobuild.top;   # ← 这里故意不写尾斜杠

    proxy_http_version 1.1;

    proxy_ssl_server_name on;
    proxy_ssl_name        api.theobuild.top;

    proxy_set_header Host              api.theobuild.top;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header Connection        "";

    proxy_connect_timeout 30s;
    proxy_send_timeout    300s;
    proxy_read_timeout    3600s;

    proxy_buffering off;
    proxy_cache     off;
    proxy_redirect  off;
}
```

> 原理：`rewrite ... break` 先把 URI 改写成 `/api/v1/...`，
> 而 `proxy_pass` **不带 URI 部分**时会转发「当前（已改写的）URI」，结果正确。
> 与「`proxy_pass` 带尾斜杠」殊途同归，但这一种不会被面板的地址栏改写破坏。

**改完必须做的两件事**：先 `docker exec "$NAME" nginx -t` 确认语法通过，
再点面板的「保存并重载」，然后重新执行一次本节的 `nginx -T` 确认改动真的落到了运行配置里。

#### 一步到位的判别方法

访问一个**后端肯定不存在**的路径，用来区分「前缀没剥掉」和「反代没命中」：

```bash
curl -i https://你的域名/prod-api/__notexist__
```

- 返回后端 JSON `C0113 接口不存在` → 反代命中了、确实转到了后端，但**前缀没剥掉**
- 返回 HTML → 反代**没命中**，请求被 SPA 的 `try_files` 吃掉了

#### 兜底方案：绕开 Nginx 直连后端

后端的 CORS 已实测为全放开（回显任意 Origin、`allow-credentials: true`、
放行 `content-type,authorization`）。如果不想继续和面板配置纠缠，改前端一个变量重新构建即可：

```dotenv
# vue3-element-admin/.env.production
VITE_APP_BASE_API=https://api.theobuild.top
```

`pnpm build` 后 axios 会直接请求 `https://api.theobuild.top/api/v1/...`，完全不经过反代。
（代价：接口在公网跨域下直接暴露。）

### 仍返回 404 时的排查顺序

**1. 配置是否加在了 443 的 server 块里**

开启「强制 HTTPS」后，80 端口那个 server 块通常只有 `return 301`，
把反代加在那里不会生效。两个块都加最保险，或直接改用面板的「反向代理」标签——它会自动加到正确位置。

**2. 是否点了「保存并重载」**

OpenResty 跑在容器里，改完文件不重载不生效。想确认语法，用：

```bash
docker exec $(docker ps --format '{{.Names}}' | grep -i openresty | head -n1) \
  /usr/local/openresty/nginx/sbin/nginx -t
```

**3. 是否有别的 location 抢先匹配**

检查「配置文件」里是否存在 `location ~ /prod-api` 之类的**正则**规则——
正则匹配的优先级高于普通前缀匹配，会把你的 `^~` 规则挤掉。

**4. 从服务器本机直接验证**（排除浏览器缓存与前端干扰）：

```bash
curl -i https://你的域名/prod-api/api/v1/auth/captcha
```

- 返回 `code=00000` → 反代已通，问题在前端（检查 `VITE_APP_BASE_API` 与实际请求路径）
- 返回 `C0113 接口不存在` → 前缀没被剥掉，回到本节开头检查斜杠
- 返回 502 / SSL 错误 → `proxy_ssl_server_name` 仍为 `off`
- 返回 HTML → 反代规则没命中，请求被 SPA 回退 `try_files` 吃掉了

### 补充：`Connection` 与 `Upgrade` 两行要不要留？

1Panel 默认模板里带有这两行，它们是给 **WebSocket** 用的标准写法：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $http_connection;
```

本项目用的是 fetch 流式 SSE，不走协议升级，**保留这两行不影响功能**，但更推荐精简为：

```nginx
proxy_set_header Connection "";   # 配 proxy_http_version 1.1 使用
```

由 Nginx 自行管理与上游的长连接。真正影响 SSE 的是 `proxy_read_timeout` 和 `proxy_buffering`，那两处别漏。

---

## 六、配置 SPA 路由回退

本项目前端路由是 **hash 模式**（`src/router/index.ts` 中 `createWebHashHistory()`），
真实地址形如 `https://你的域名/#/system/user`，浏览器只会向服务器请求 `/`，
因此**当前并非必需**——直接访问 `/system/user`（不带 `#`）返回 404 是正常的，不是故障。

但如果将来改用 history 模式（`createWebHistory()`），就必须加上回退：
**网站** → 站点 → **配置** → **伪静态**（部分版本在「配置文件」里），加入：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

> ⚠️ 1Panel 的静态网站配置里**可能已经存在 `location /`**。
> 请先检查「配置文件」中是否已有同名的 `location /` 块——**有则修改它，不要新增**，否则 Nginx 会因重复定义而报错。
> （实测：本站点当前对未知路径返回 openresty 的 404 页，说明并未配置该回退。）

若面板的伪静态模板里有 `Vue` / `SPA` 之类的预设项，也可直接选用。

---

## 七、验证

SSH 到服务器执行：

```bash
# 0. 先确认后端自己活着（把「后端故障」与「Nginx 配置问题」分开）
curl -i -m 5 http://127.0.0.1:8000/api/v1/auth/captcha
# 期望：HTTP 200，body 中 code 为 "00000"

# 1. 接口是否通（经反代）
curl -i https://你的域名/prod-api/api/v1/auth/captcha
# 期望：HTTP 200，body 中 code 为 "00000"

# 2. 静态页面是否正常
curl -I https://你的域名/
# 期望：HTTP 200，content-type: text/html
```

> 第 0 步不通（卡住/502）时，第 1 步必然是 502/504 —— 此时应直接去看第十节，不必改 Nginx。

然后浏览器打开 `https://你的域名`，用 `admin / 123456` 尝试登录。

**排错对照**：

| 现象 | 原因 |
| --- | --- |
| 接口 404，返回后端 JSON `接口不存在` | 反代命中了但前缀没被剥掉（或改动未生效到运行配置，见第五节） |
| 接口 502 | `proxy_ssl_server_name` 仍为 `off`（1Panel 默认值）；或后端**连接被拒**（进程没起 / 端口不对） |
| 接口 **504** | **后端起不来响应** —— Nginx 连上了但等不到回应，见第十节 |
| 接口 **521 / 522**（错误页由 Cloudflare 给出） | **请求根本没到你的服务器** —— 源站宕机 / Web 服务停摆 / 443 未放行；与 Nginx 配置、前端代码无关，见第十节 |
| 接口超时无响应（浏览器一直转） | 同上，只是 Nginx 的超时还没到（默认 60 秒后才写 504） |
| 接口 404 且返回 HTML | 反代规则没命中，请求被静态处理吃掉了 |
| 页面白屏、JS/CSS 404 | dist 多套了一层目录，或站点不在域名根路径 |
| 刷新子路由 404 | 本项目是 hash 模式，正常现象；若改用 history 模式则需 `try_files` 回退（第六节） |
| SSE 每 60 秒断一次 | `proxy_read_timeout` 未放宽 / 未关 `proxy_buffering` |

---

## 八、与裸装 Nginx 的差异小结

| 项 | 裸装 Nginx | 1Panel |
| --- | --- | --- |
| 修改配置 | 编辑 `/etc/nginx/conf.d/*.conf` | 面板 → 网站 → 配置 → 配置文件 / 反向代理 |
| 语法检查与重载 | `nginx -t && nginx -s reload` | 面板「保存并重载」按钮 |
| 命令行操作 | 直接执行 | OpenResty 在容器内，需 `docker exec 1panel-openresty-xxx /usr/local/openresty/nginx/sbin/nginx -t` |
| 反代默认 SNI | 无默认值 | **默认 `proxy_ssl_server_name off`，必须改 `on`** |
| 站点根目录 | 自定义 | `/opt/1panel/apps/openresty/openresty/www/sites/<域名>/` |
| 反代片段存放 | 手写 | `.../sites/<域名>/proxy/<名称>.conf`（被主配置 include） |

---

## 九、配合后端部署

前端搞定后，后端同样可以在 1Panel 上装 NestJS 的运行环境；若后端部署在另一台机器或已由 Cloudflare 托管，
只需保证本文第五节的 `proxy_pass` 指向它即可。

后端自身的部署方式（原生 / Docker）见根目录 [README.md](../README.md) 的「七、生产部署」。

---

## 十、接口 502 / 504 / 521：故障已经不在前端与 Nginx

当反代本身已经通了（请求确实到了后端站点），却返回网关类错误时，
问题**在后端**，不要再改 Nginx 配置了。

### 先分清几个「网关错误」

| 状态码 | 谁返回的 | 含义 | 通常原因 |
| --- | --- | --- | --- |
| **502** Bad Gateway | Nginx 或 CDN | 连不上上游 | 后端进程没起、端口写错、上游是 HTTPS 但没发 SNI |
| **504** Gateway Time-out | Nginx 或 CDN | 连上了但等不到响应 | 后端**进程卡死**（常见：数据库/Redis 连不上导致请求挂住） |
| **521** Web Server Is Down | **Cloudflare** | 源站**拒绝连接**（TCP 层就被拒） | 源站整机宕机、Web 服务已停、安全组/防火墙把 443 关掉 |
| **522** Connection Timed Out | **Cloudflare** | 源站 **TCP 握手超时** | 源站 IP 不可达、安全组只放行部分来源 |
| **520** | **Cloudflare** | 源站返回空响应 / 非法响应 | 源站 Web 服务异常退出、进程半死 |

> 判断特征：状态码 5xx + `$body_bytes_sent` 很小（几百字节）→ 那是 Nginx / CDN 自己的错误页，
> 不是后端返回的业务报文。（后端业务失败会返回 `{"code":"C0113",...}` 这样的 JSON。）
>
> **一句话区分**：502/504 是「请求已经到了你的服务器」；**521/522 是「请求根本没到你的服务器」**。
> 后者的排查对象是**整台机器与 Web 服务本身**，和 Nginx 配置、前端代码完全无关。

### 怎么确认「请求真的到达了后端站点」

看**后端站点**（如 `api.你的域名`）的访问日志。若能被前端站点的 Referer 串起来，说明整条链路是通的：

```text
104.22.127.127 - - [29/Sep/2026:14:03:43 +0800] "GET /api/v1/auth/captcha HTTP/2.0" 504 566 \
  "https://dash.theobuild.top/" "Mozilla/5.0 ... Chrome/153 ..." "112.97.116.192, 104.22.14.28,32.236.59.77"
```

逐段读这条日志：

| 片段 | 说明 |
| --- | --- |
| `"GET /api/v1/auth/captcha"` | 路径**不带 `/prod-api`** → 前端站点的**前缀剥离已经生效** |
| `$remote_addr` = `104.22.127.127` | 是 Cloudflare 的 IP → 最外层还有一层 CDN |
| `$http_referer` = `https://dash.theobuild.top/`、UA 是 Chrome | 请求源自前端页面，是**前端站点的 Nginx 转发过来的**（反代会透传原始 Referer/UA） |
| `$http_x_forwarded_for` 三段 | 中间经过两跳代理：浏览器 → CDN → 前端站点 → CDN → 后端站点 |
| `504 566` | 后端站点自己的 Nginx 等上游超时了，566 字节是它自己的错误页 |

> 所以：**前端站点的日志里出现 `/prod-api/...` 的 504 也是正常的**——
> 那正是它剥完前缀转发出去的那一跳。

### 后端排查清单（在服务器上按顺序执行）

```bash
# A. 后端进程/容器还活着吗
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
pm2 list                                  # 若用 pm2
systemctl status <你的后端服务名>          # 若用 systemd
ss -lntp | grep -E ':(8000|3000)'         # 端口是否真的在监听

# B. 绕过 Nginx 与 CDN，本机直连后端 —— 最关键的一步
curl -i -m 5 http://127.0.0.1:8000/api/v1/auth/captcha
```

| `curl` 结果 | 结论 |
| --- | --- |
| `200` + `code=00000` | 后端正常 → 问题在 Nginx 的 upstream 指向（地址/端口/协议） |
| **卡住，5 秒无响应** | 后端进程**卡死**（端口在监听但不处理请求）→ 继续 C/D/E |
| `Connection refused` | 进程没起 → 启动它 |
| `502` | 上游配错（写成了 `https://` 但后端是 `http://`，或 SNI 未开） |

```bash
# C. 后端依赖的 MySQL / Redis 是否正常（同机部署时）
docker ps -a | grep -E 'mysql|redis|mariadb'
docker logs --tail 50 <mysql容器>
#   典型死法：too many connections、被 OOM 杀掉、磁盘写满导致拒绝写入

# D. 后端自己的日志
docker logs --tail 120 <后端容器>
tail -n 120 <后端日志文件路径>
#   找：数据库连接超时、连接池耗尽、未捕获异常

# E. 资源层面
free -m
docker stats --no-stream
dmesg | grep -i -E 'oom|killed' | tail -20
df -h
```

### 为什么「端口在监听」也会超时

最常见的是**应用层被阻塞**：进程还在、TCP 也能握手，但所有请求都卡在
数据库连接池等待 / Redis 超时上，于是 Nginx 一直等到自己的 `proxy_read_timeout`
（默认 60 秒）才写 504。所以 504 往往是**后端依赖挂掉的表象**，不是 Nginx 的问题。

> 排查顺序建议：**先执行 B 步直连后端** —— 一步就能把「后端问题」和「Nginx 配置问题」分开，
> 比反复改 Nginx 配置高效得多。

### 故障升级：从 504 变成 521 说明什么

这是同一次事故的**两个阶段**，很容易被误判成「改配置改坏了」：

| 阶段 | 表现 | 含义 |
| --- | --- | --- |
| 第一阶段 | 接口 **504**，且**后端站点**的 Nginx 日志里留下了记录 | 后端站点的 Nginx 还活着 → 它能收请求、能写日志；只是它等**后端应用**（`127.0.0.1:8000`）等不到 |
| 第二阶段 | 接口 **521**（或 522），错误页由 **Cloudflare** 吐出来 | 后端站点的 Nginx **自己也连不上了** → 源站整机或 Web 服务已经停摆 |

结论：**504 → 521 是后端从「应用卡死」恶化为「整台机器/服务不可达」**，
通常伴随 OOM 被杀、磁盘写满、机器重启、或有人手动停掉了服务。
此时第一阶段的排查清单（尤其 E 步的 `free -m` / `dmesg | grep oom`）必须回头看。

### 外部自查：不登服务器判断「是哪一层挂了」

浏览器 F12 只能给出状态码，**拿不到关键信息**。用下面的脚本从外部打三层探针，
一眼定位故障层级（把域名替换成你的）：

```bash
node -e '
const net=require("net"),tls=require("tls");
const H=process.argv[1]||"api.theobuild.top";
const CRLF=String.fromCharCode(13,10);
function tcp(){return new Promise(r=>{const t0=Date.now();const s=net.createConnection({host:H,port:443});
 const d=o=>{s.destroy();r(Object.assign({ms:Date.now()-t0},o))};s.setTimeout(8000);
 s.on("connect",()=>d({ok:1,n:"TCP 连通"}));s.on("timeout",()=>d({ok:0,n:"TCP 超时"}));
 s.on("error",e=>d({ok:0,n:"TCP 失败 "+e.code}));})}
function tlsk(){return new Promise(r=>{const t0=Date.now();
 const s=tls.connect({host:H,port:443,servername:H,rejectUnauthorized:false});
 const d=o=>{s.destroy();r(Object.assign({ms:Date.now()-t0},o))};s.setTimeout(8000);
 s.on("secureConnect",()=>d({ok:1,n:"TLS 握手完成"}));s.on("timeout",()=>d({ok:0,n:"TLS 超时"}));
 s.on("error",e=>d({ok:0,n:"TLS 失败 "+e.code}));})}
function http(){return new Promise(r=>{const t0=Date.now();let raw="";
 const s=tls.connect({host:H,port:443,servername:H,rejectUnauthorized:false});
 const d=o=>{s.destroy();r(Object.assign({ms:Date.now()-t0,raw:raw},o))};s.setTimeout(20000);
 s.on("secureConnect",()=>s.write(["GET / HTTP/1.1","Host: "+H,"Connection: close","",""].join(CRLF)));
 s.on("data",x=>{raw+=x;if(raw.indexOf(CRLF+CRLF)>=0)d({ok:1,n:"收到响应"})});
 s.on("timeout",()=>d({ok:0,n:"20000ms 内零响应字节"}));s.on("error",e=>d({ok:0,n:"错误 "+e.code}));})}
(async()=>{for(const f of [["TCP",tcp],["TLS",tlsk],["HTTP",http]]){
 const x=await f[1]();console.log(f[0].padEnd(5),(x.ok?"OK ":"FAIL"),x.ms+"ms",x.n);
 if(x.raw){console.log("   状态行:",x.raw.split(CRLF)[0]);
 const m=x.raw.match(/error code:?\s*(\d{3})/i);if(m)console.log("   >>> CF 错误码:",m[1]);}}})();
' api.theobuild.top
```

| 探测结果 | 结论 |
| --- | --- |
| TCP 失败 / 超时 | 网络或 CDN 边缘层问题，与你的服务无关 |
| TCP、TLS 都 OK，**HTTP 零响应字节** | 🔴 **源站已不可达**（521/522）→ 查源站整机与 Web 服务，别再碰 Nginx 配置 |
| 三者都 OK 但返回 502 | 源站 Web 服务活着，上游（后端应用）连不上 |
| 三者都 OK，返回 504 | 源站 Web 服务活着，上游（后端应用）**卡死** |

### 报 521/522 时的服务器排查清单

按这个顺序，第 1、2 步就能定性：

```bash
# 1. 机器本身还活着吗（在本地电脑执行）
ping <源站IP>                 # 通了才有下一步；超时说明整机或网络挂了
ssh <user>@<源站IP>           # 连不上 → 去云控制台看实例状态与「安全组」

# 2. Web 服务 / 面板还活着吗
systemctl is-active nginx openresty
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'   # 注意 Status 是不是 Exited / Restarting
curl -I -m 5 http://127.0.0.1/                                # 本机访问自己，排除防火墙干扰

# 3. 端口是否真在监听（521 常见：服务没起 或 端口没放行）
ss -lntp | grep -E ':(80|443|8000)'
防火墙/安全组：确认 80、443 对 Cloudflare 回源 IP 段放行

# 4. 后端应用
curl -i -m 5 http://127.0.0.1:8000/api/v1/auth/captcha
docker logs --tail 120 <后端容器>

# 5. 是不是被系统杀了（504 恶化成 521 的头号嫌疑）
free -m
df -h
dmesg -T | grep -i -E 'oom|killed' | tail -20
journalctl -u <后端服务名> --since '1 hour ago' | tail -50
```

**为什么内存/磁盘要重点看**：如果后端是「跑着跑着卡死 → 整机不可达」，
典型链条是 `内存耗尽 → OOM Killer 杀掉进程 → 若连 Nginx 或系统关键进程一起被杀，就表现为 521`。
`dmesg` 里的 `Out of memory: Killed process` 是决定性证据。

> ⚠️ 注意：**1Panel 面板本身打不开**也是一种判据 ——
> 面板打不开说明整机已挂（或面板服务停了），此时任何 Nginx 配置层面的操作都无意义。
