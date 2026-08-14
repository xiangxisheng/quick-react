# 开发指南

安装依赖：

```bash
npm install
```

启动构建和服务：

```bash
node esbuild.cjs
```

启动监听模式：

```bash
npm run dev
```

执行类型检查：

```bash
npm run typecheck
```

前端代码位于 `src/`，后端代码位于 `server/`。新增后端模板或静态资源时，注意不要把服务端文件放入 `public/`。
