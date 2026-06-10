# Pi Agent + Xiaomi MiMo Computer Control

This workspace contains a project-local Pi extension that adds Xiaomi MiMo model routing and Windows computer-control tools.

## Layout

- `.pi/extensions/computer-control/index.ts` is the Pi auto-discovered extension entrypoint.
- `.pi/skills/computer-control.md` is the Pi skill that explains when to use the tools.
- `.env` stores local Xiaomi MiMo credentials and model routing. It is intentionally ignored by Git.
- `docs/references/` contains local summaries of the referenced Pi and MiMo docs.

Pi's current project-local auto-discovery paths are `.pi/extensions/` and `.pi/skills/`. The earlier `.pi/agent/...` path is global-only in current Pi docs, so this project uses the local paths.

## Model Routing

- Text planning and multimodal understanding both default to `mimo-v2.5`.
- Override with `MIMO_TEXT_MODEL` or `MIMO_VISION_MODEL` only when you need a different Xiaomi MiMo model.
- Xiaomi MiMo calls use the OpenAI-compatible `chat/completions` endpoint with the `api-key` header.

## Safety

Read-only tools (`screenshot_screen`, `describe_screen`, `wait`, `check_application_open`, `start_wechat`) run directly. Sensitive tools (`windows_powershell`, `click`, `double_click`, `right_click`, `move_mouse`, `drag`, `scroll`, `capture_scroll_region`, `type_text`, `press_key`, `hotkey`) require user confirmation by default.

Set `PI_CONTROL_REQUIRE_CONFIRM=false` only when you intentionally want unattended keyboard and mouse execution.

Each sensitive keyboard/mouse action waits for `PI_CONTROL_ACTION_DELAY_MS` after execution and returns a fresh screenshot path in `afterScreenshot`, so the agent can inspect after every step instead of chaining blind clicks.

On Windows, prefer the extension tools `start_wechat` and `windows_powershell` over Pi's built-in `bash` tool. The built-in `bash` may use WSL and can fail on systems without a configured Linux distribution.

Mouse tools support normalized coordinates for cross-resolution use. Prefer `nx` and `ny` in the range `0..1` over pixel `x/y`. Drag supports `fromNx/fromNy/toNx/toNy`.

Before controlling desktop software, use `check_application_open` to confirm the target app is already open. `start_wechat` performs this check automatically and will not start a duplicate WeChat/Weixin process.

For scrolling, prefer passing a fixed `region` to `scroll`; the tool moves the mouse to the region center before scrolling. For fixed panels such as WeChat chat history, use `capture_scroll_region` to capture only that region. For upward WeChat history capture, the Pi tool first restores the region to the latest-message bottom boundary with `End` when keyboard focus is available and then confirms it by scrolling, calibrates the scroll step with one trial scroll, falls back to WeChat PageUp/PageDown navigation when mouse-wheel scrolling does not move WeChat, stops when the region is unchanged or only shows tiny repaint/noise movement, keeps accepted production frames within 1% to 10% measured overlap, saves separate region frames plus `manifest.json`, and only creates a stitched PNG when `outputStitched=true`. Scroll defaults are configurable with `PI_CONTROL_SCROLL_STEP`, `PI_CONTROL_SCROLL_REPEAT`, `PI_CONTROL_SCROLL_DELAY_MS`, `PI_CONTROL_SCROLL_OVERLAP_RATIO`, `PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO`, `PI_CONTROL_SCROLL_CALIBRATION_STEP`, `PI_CONTROL_SCROLL_OUTPUT_STITCHED`, `PI_CONTROL_LONG_CAPTURE_MAX_FRAMES`, `PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES`, and `PI_CONTROL_LONG_CAPTURE_OUTPUT_DIR`.


## Setup

```powershell
npm install
npm test
npm run typecheck
```

The `pi` command was not present on PATH during setup. Install or expose Pi CLI before launching this project with Pi.

## Go WeChat iLink Agent

The Go prototype runs independently from Pi. It scans into WeChat iLink, polls text messages, uses Xiaomi MiMo to convert an admin's natural-language request into a PowerShell plan, asks for WeChat confirmation, then executes inside the workspace.

```powershell
go test ./...
go run ./cmd/wechat-ilink-agent
```

Optional flags:

```powershell
go run ./cmd/wechat-ilink-agent --root C:\Users\28444\Documents\wechat --config wechat_bot_config.json
```

Local secrets and runtime state stay untracked: `.env`, `wechat_bot_config.json`, and `.wechat-agent-output/`.

During login the QR code is written to `.wechat-agent-qrcode.png` and opened automatically, avoiding terminal QR rendering issues on Windows.

Windows automation confirmation defaults to disabled (`PI_CONTROL_REQUIRE_CONFIRM=false`) so mouse and keyboard actions can run without an extra UI confirmation step.

## Window Sketch Audit Extension

The project also includes a Pi tool for checking door/window elevation sketch photos:

```text
audit_window_elevation_sketch
```

It reads `.pi/window-checklist.md`, sends the sketch image to Xiaomi MiMo vision, and writes a redline SVG with numbered missing/unclear items. The default output location is a `reports/` folder next to the input image.

Example Pi request:

```text
Use audit_window_elevation_sketch on E:\path\to\window-sketch.jpg
```

## WeChat Window Audit Bot

This project can connect WeChat directly to the Pi window-sketch audit flow. It uses `@wechatbot/wechatbot` for iLink media download/upload and the local `audit_window_elevation_sketch` logic for MiMo vision review.

Install the official generic WeChat Pi package once:

```powershell
npm exec -- pi install npm:@wechatbot/pi-agent
```

Then start Pi:

```powershell
npm run pi:wechat-audit
```

Inside Pi, run:

```text
/wechat-audit
```

Scan the QR image opened from `.wechat-audit-qrcode.png`, then send a door/window sketch image from WeChat. The bot replies with a text summary and uploads a generated `.audit.png` redline image for easy WeChat viewing. The source `.audit.svg` is still kept in the local report folder. Use `/wechat-audit-disconnect` to stop it.
