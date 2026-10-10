# 全功能 Mock 验证

测试分成接口策略、真实 React 组件、Python 后端隔离夹具、桌面连接生命周期，以及真实 HTTP/WebSocket 网关到 Mock WANX 的流程验证。Mock 回复不用于评估模型质量。

```sh
npm test
npm run test:ui
npm --prefix desktop test
node --test remote-connect/tests/*.test.mjs
npm run build
# 在另一终端启动隔离夹具，端口随机且只监听 loopback。
node tools/mock-qa.mjs
# 根据 mock-runtime.json 连接已启动的测试夹具。
node tools/mock-smoke.mjs
```

可使用 WANX 自带的 Python 执行 `tests/test_role_ontology.py`、`tests/native_portable_test.py` 和 `tests/native_reference_test.py`；测试中的工作区、模型处理器及记忆均为 Mock。网络程序测试在 `remote-connect` 内执行 `go test ./...`。

`tools/mock-qa.mjs` 不读取部署配置，不使用真实账户。数据与结果放在 `verification/full-mock-20261010`，使用独立的 `zhijun_mock_qa_session` cookie；角色注册表每次启动新建，避免上次测试状态影响下一次测试。

网页可访问输出中的 Mock upstream 地址加 `/__qa/browser-login`，建立一个仅用于夹具的登录会话。登录表单的验证行为由组件测试覆盖，这个入口不绕过正式登录验证。正式客户端不包含这些工具和 Mock 数据。

覆盖功能包括登录与会话、对话历史/发送/流式/确认/取消/重连、对话附件、角色创建与隔离、九个记忆视图、记忆写入/修正/撤回/沉淀、提取和主动关心设置、记忆包导出/诊断/试导入、本体修正/确认/停用、知识库批量上传/部分失败/重试/预览/删除，以及账户/阅读/微信设置。

正式的验证码厂商、真实微信消息、真实模型、Windows 实机和跨互联网连接需独立验收。Windows 构建后的资源一致性与安装载荷检查使用 `node desktop/tools/audit-win.cjs`。
