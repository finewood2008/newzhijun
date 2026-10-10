# 部署配置

将 deployment.example.json 复制为 deployment.json，填写实际环境，切勿提交实际配置。

- upstream：WANX 的 HTTP(S) origin，不包含令牌、用户名或查询参数。
- host、port、publicOrigin：客户端监听地址和唯一受信任访问入口。局域网访问时配置对应实际地址；Host/Origin 校验必须匹配。
- bindings：键为用户数字 ID，值至少含 agentId；可选 libraryId 固定默认私人知识库。
- provisioning：键为用户数字 ID；管理员配置 sourceAgentId（能力模板）、workspaceRoot（该用户独立的绝对路径）、rules（审阅过的共同行为规则）、auxModel（记忆提取模型）。配置后该用户可创建角色。
- memoryPortableImport：默认 false。启用前安装记忆包补丁，备份源数据并核对 namespace。

示例中的用户 ID、实例 ID 与路径均须替换。创建实例时只复制能力规则，不复制来源专家的个人记忆、文档、工作区、知识库或微信凭据。

```json
{
  "upstream": "http://127.0.0.1:8088",
  "host": "127.0.0.1",
  "port": 28730,
  "publicOrigin": "http://127.0.0.1:28730",
  "bindings": {"1": {"agentId": "private-agent-id"}},
  "provisioning": {"1": {
    "sourceAgentId": "expert-template-id",
    "workspaceRoot": "/srv/zhijun/agents/private-agent-id",
    "rules": "这里填写已审阅的知君专家规则。",
    "auxModel": "provider/model"
  }},
  "memoryPortableImport": false
}
```

Windows 0.4.2 起在客户端直接发现、连接 WANX，不读取 Web 服务的 `deployment.json`，也不读取旧 `desktop/resources/server-profile.json`。旧配置保留用于原部署，不进入新安装包。

## 桌面资源

执行 `npm run build`、`node tools/prepare-desktop.mjs`，准备同一套前端与直连适配代码。桌面开发使用 `npm --prefix desktop ci` 后启动；在 `desktop/` 执行 `npm run package:win -- --publish never` 生成安装包。无需构建旧远程网络进程。跨平台打包时可以用 `--config.directories.output=/本机临时目录` 避开云盘文件系统的写入限制。

桌面进程只监听本机 loopback 随机端口。服务地址、角色索引和加密会话位于原用户目录下新的 `direct-wanx/`；Windows 会话使用系统安全存储加密，不写入本地明文令牌或密码。安全存储不可用时会话只保留在内存，下次需重新登录。旧 `connection.enc` 和远程配对目录不会被导入、修改或删除。

升级 0.4.2 首次需重新选择 WANX 并登录。旧网关本地维护的角色索引不会自动迁入新客户端，服务器上的原有专家实例与数据保留；不要删除或覆盖旧目录来排查连接问题。

旧 Web 与旧桌面 HTTPS 网关同时运行时，可将两份私有 deployment.json 的 `roleStore` 配为同一个绝对目录。这仅适用于旧网关部署；0.4.2 直连客户端不依赖它。角色索引的本地 JSON 目录不作为多服务器事务存储。
