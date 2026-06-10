---
name: computer-control
description: Use for Xiaomi MiMo screen understanding and carefully gated Windows keyboard/mouse control through Pi tools.
---

# Computer Control

Use this skill when the user asks Pi to inspect the screen, understand an image/screenshot, or control the local Windows desktop with keyboard and mouse actions.

## Model Routing

- Use `describe_screen` for visual interpretation. It captures a screenshot and sends it to Xiaomi `mimo-v2.5`, the multimodal model.
- Use `mimo-v2.5` by default for both text reasoning and image/screenshot understanding.
- If a task requires visual coordinates, first call `describe_screen` with a prompt asking for visible UI elements and approximate coordinates.

## Safe Workflow

1. Confirm the target application is open before interacting with it.
2. Observe with `screenshot_screen` or `describe_screen`.
3. Explain the intended next action in normal assistant text.
4. Use one sensitive action tool at a time, except `capture_scroll_region` which intentionally performs a bounded calibration and scroll-capture loop.
5. Re-observe after clicks, typing, hotkeys, drag operations, or ordinary scrolls.

## Application State

- Before controlling a desktop application, call `check_application_open` with reliable `processNames` and/or `windowTitleIncludes`.
- For WeChat/Weixin, use `check_application_open` with process names `WeChat` and `Weixin`, or call `start_wechat`.
- `start_wechat` first checks whether WeChat/Weixin is already open. If it is open, do not start another instance.
- If the target software is not open and there is no dedicated start tool, ask the user for the intended launch path or command before using `windows_powershell`.

## Tools

- Read-only tools: `screenshot_screen`, `describe_screen`, `wait`, `check_application_open`, `start_wechat`.
- Sensitive tools: `windows_powershell`, `click`, `double_click`, `right_click`, `move_mouse`, `drag`, `scroll`, `capture_scroll_region`, `type_text`, `press_key`, `hotkey`.

Sensitive tools require user confirmation by default. If confirmation is denied, treat the action as not executed and re-plan.

On Windows, do not use Pi's built-in `bash` tool for Windows commands. Use `start_wechat` to open WeChat and `windows_powershell` for Windows shell checks.

After every sensitive action, inspect the returned `afterScreenshot` or call `describe_screen` before choosing the next action. Do not chain multiple clicks, drags, hotkeys, or typing actions without an observation step.

## Coordinate Rules

- Prefer normalized coordinates for all mouse actions: pass `nx` and `ny`, each from 0 to 1, instead of pixel `x` and `y`.
- `nx=0, ny=0` is the top-left of the current virtual screen; `nx=1, ny=1` is the bottom-right; `nx=0.5, ny=0.5` is screen center.
- `describe_screen` asks MiMo to return both normalized `nx/ny` and best-effort pixel `x/y`; use `nx/ny` when available.
- Pixel `x/y` remains supported, but it is less reliable across resolution, DPI scaling, or monitor-layout changes.
- For mouse targeting, prefer full-screen `describe_screen` calls. If `describe_screen` was called with `region`, its `nx/ny` are relative to that cropped region and must not be passed directly to mouse tools.
- `screenshot_screen` and `describe_screen` `region` values are always absolute virtual-screen coordinates. Do not convert a cropped screenshot to `{x: 0, y: 0}` unless the real target region starts at the top-left of the desktop.
- Do not guess coordinates from memory. Use `describe_screen` or a screenshot before clicking.
- For drag, prefer `fromNx/fromNy/toNx/toNy` instead of `fromX/fromY/toX/toY`.

## Scrolling Rules

- For precise scrolling, first identify the fixed scrollable region with `describe_screen` or `screenshot_screen`.
- Pass `region` to `scroll` when the target is a known panel. The tool moves the mouse to the region center before scrolling.
- If no region is available, pass `x/y` or `nx/ny` so the tool moves the mouse to the intended scroll area before scrolling.
- Use bare `scroll` without a target only for low-risk interactive navigation, not for collecting data.
- Configure ordinary scroll defaults with `PI_CONTROL_SCROLL_STEP`, `PI_CONTROL_SCROLL_REPEAT`, and `PI_CONTROL_SCROLL_DELAY_MS`.
- Positive `delta` scrolls up. Negative `delta` scrolls down.

## Fast Region Capture

- For WeChat chat-record extraction by chat or group name, prefer `capture_wechat_chat_records` over manual search/click/menu steps. Pass `chatName` and optionally `outputDir`; the tool opens WeChat, scans the left conversation list with VLM, falls back to search only if the list scan cannot find the chat, opens the chat-records window, temporarily topmosts the windows, captures the records region, writes a stitched PNG, and creates OCR-friendly chunks.
- After `capture_wechat_chat_records`, inspect the returned `preflight.wechatTopmostScreenshot`, `preflight.recordsWindowTopmostScreenshot`, `manifestPath`, `stitchedPath`, and `ocrChunks` instead of redoing the navigation manually.
- Use `capture_scroll_region` for fixed areas such as WeChat chat history when the goal is to collect content quickly.
- Always capture only the target scroll region, not the full screen, so later content extraction is not polluted by sidebars or unrelated windows.
- For a screenshot-only chat-history task, once the target contact and message region are confirmed, call `capture_scroll_region` immediately. Do not take extra cropped screenshots, do not describe the cropped chat content, and do not summarize messages.
- For WeChat history with `direction: "up"`, the tool first moves the mouse into the region, uses `End` when keyboard focus is available, then confirms the latest-message bottom boundary by scrolling down until the region stops changing.
- If the bottom-boundary restore cannot settle within its bound, the tool stops with `boundaryRestoreFailed` instead of blindly capturing from an uncertain position.
- After boundary restore, the tool captures `frame-000`, moves and focuses the mouse in that region, performs calibration, captures calibration frames, then calculates a scroll step that keeps about 10% overlap by default.
- If mouse-wheel calibration does not move the region, the tool automatically falls back to WeChat keyboard scrolling and records `inputMethod: "keyboard-page"` in the manifest. In this mode, `PageUp` is used for older history and `PageDown` is used to return toward the bottom.
- After calibration, accepted production frames must have 1% to 10% measured overlap with the previous accepted frame. If overlap is too high, the tool adds scroll distance and retakes that frame instead of saving a duplicate-heavy frame.
- During production capture, if a scroll produces an identical region screenshot or the measured vertical movement is only a tiny repaint/noise movement, treat it as the top/bottom boundary and stop immediately with `unchanged`; do not keep scrolling upward.
- The default output is separate region PNG frames plus `manifest.json`; do not ask for a long stitched image unless the user explicitly needs one.
- For WeChat chat history, default to `direction: "up"` to collect older messages from the restored bottom boundary.
- Use `maxFrames` and `unchangedFrameLimit` to bound capture. Defaults come from `PI_CONTROL_LONG_CAPTURE_MAX_FRAMES` and `PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES`.
- Configure calibration with `PI_CONTROL_SCROLL_OVERLAP_RATIO`, `PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO`, and `PI_CONTROL_SCROLL_CALIBRATION_STEP`; defaults are `0.1` maximum overlap and `0.01` minimum overlap.

## Text Entry

`type_text` uses clipboard paste with best-effort text clipboard restoration. Avoid using it for secrets unless the user explicitly asks.
