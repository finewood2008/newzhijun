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

桌面配对配置 `desktop/resources/server-profile.json` 为本机生成文件，不入库。macOS 服务准备工具生成本机证书与配对信息；其他平台需要按自己的设备生成，不能复用他人的配对配置。

## 桌面资源

先生成本机 `desktop/resources/server-profile.json`（包含设备公钥、固定证书指纹和地址；不得复用其他人的私钥），再执行 `npm run build`、`node tools/prepare-desktop.mjs`。桌面开发使用 `npm --prefix desktop ci` 后启动。远程组件按 `remote-connect/README.md` 构建对应平台的二进制，随后在 `desktop/` 执行打包命令。仓库仅提交源码，不包含配对文件和安装包。

当 Web 与桌面 HTTPS 网关同时运行时，将两份私有 deployment.json 的 `roleStore` 配为同一个绝对目录。两个入口将实时读取同一份角色目录；账户会话仍按入口独立保存。该本地 JSON 目录适用于单机部署，不作为多服务器事务存储。
