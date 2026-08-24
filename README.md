# Tesla Dashcam

Tesla 行车记录仪素材查看器，使用 Electron、Vue 3 和 Element Plus 构建。

当前版本可在本地读取 TeslaCam 素材，按最近录像、已保存录像和哨兵录像分组，并连续同步播放最多六个摄像头的视频。原 React 版本的迁移约定和后续功能记录在 [VUE_REWRITE_HANDOFF.md](./VUE_REWRITE_HANDOFF.md)。

## 已实现

- 选择或拖入 TeslaCam、RecentClips、SavedClips、SentryClips 文件夹
- 按日期、类型、地点和事件原因筛选录像
- 读取 MP4 时长并组装连续时间线
- 前视、后视、左右侧和左右柱摄像头同步播放
- 六宫格、四宫格和前视单画面布局
- 播放、暂停、跳转、逐帧、倍速、静音和前视画中画
- 中英文界面和可调整宽度的素材侧栏
- 普通可调整大小的桌面窗口，不自动最大化，也不提供全屏模式

## 素材目录

支持 Tesla 的标准目录结构：

```text
TeslaCam/
  RecentClips/
    YYYY-MM-DD_HH-mm-ss-front.mp4
    ...
  SavedClips/
    YYYY-MM-DD_HH-mm-ss/
      YYYY-MM-DD_HH-mm-ss-front.mp4
      event.json
      thumb.png
  SentryClips/
    YYYY-MM-DD_HH-mm-ss/
      ...
```

支持的文件后缀为 `front`、`back`、`left_repeater`、`right_repeater`、`left_pillar` 和 `right_pillar`，文件扩展名必须是小写 `.mp4`。

## 开发

建议使用 Node.js 22.18+ 或 24.11+。

```sh
npm install
npm run dev
```

开发服务器默认使用 `.env.development` 中的端口配置，也可以临时覆盖：

```sh
VITE_DEV_PORT=5173 npm run dev
```

## 检查与构建

```sh
npm run typecheck
npm run build
npm run build:test
```

安装包输出到 `release/${version}`。

## 当前边界

当前版本聚焦素材整理和观看。SEI 驾驶数据、GPS 轨迹、截图、片段导出和移到系统回收站尚未迁入。项目已经集成 `ffmpeg-static`，主进程会解析并校验 FFmpeg 二进制路径，安装包构建时也会将其解包为可执行文件；后续多机位合成导出直接复用这项能力。

渲染进程关闭了 `nodeIntegration` 并启用了 `contextIsolation`。仅渲染进程使用的类型放在 `src/types`；后续需要跨主进程、预加载脚本和渲染进程共享的契约应放在 `shared/types`。
