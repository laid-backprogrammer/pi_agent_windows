# Pi Agent + Xiaomi MiMo Computer Control

This workspace contains a project-local Pi extension that adds Xiaomi MiMo model routing and Windows computer-control tools.

## Layout

- `.pi/extensions/computer-control/index.ts` is the Pi auto-discovered extension entrypoint.
- `.pi/skills/computer-control.md` is the Pi skill that explains when to use the tools.
- `.env` stores local Xiaomi MiMo credentials and model routing. It is intentionally ignored by Git.
- `docs/references/` contains local summaries of the referenced Pi and MiMo docs.

Pi's current project-local auto-discovery paths are `.pi/extensions/` and `.pi/skills/`. The earlier `.pi/agent/...` path is global-only in current Pi docs, so this project uses the local paths.

## Model Routing

- Text-only planning and reasoning uses `MIMO_TEXT_MODEL` (`mimo-v2.5-pro`).
- Screen/image understanding uses `MIMO_VISION_MODEL` (`mimo-v2.5`).
- Xiaomi MiMo calls use the OpenAI-compatible `chat/completions` endpoint with the `api-key` header.

## Safety

Read-only tools (`screenshot_screen`, `describe_screen`, `wait`, `start_wechat`) run directly. Sensitive tools (`windows_powershell`, `click`, `double_click`, `right_click`, `move_mouse`, `drag`, `scroll`, `type_text`, `press_key`, `hotkey`) require user confirmation by default.

Set `PI_CONTROL_REQUIRE_CONFIRM=false` only when you intentionally want unattended keyboard and mouse execution.

Each sensitive keyboard/mouse action waits for `PI_CONTROL_ACTION_DELAY_MS` after execution and returns a fresh screenshot path in `afterScreenshot`, so the agent can inspect after every step instead of chaining blind clicks.

On Windows, prefer the extension tools `start_wechat` and `windows_powershell` over Pi's built-in `bash` tool. The built-in `bash` may use WSL and can fail on systems without a configured Linux distribution.

Mouse tools support normalized coordinates for cross-resolution use. Prefer `nx` and `ny` in the range `0..1` over pixel `x/y`. Drag supports `fromNx/fromNy/toNx/toNy`.


## Setup

```powershell
npm install
npm test
npm run typecheck
```

The `pi` command was not present on PATH during setup. Install or expose Pi CLI before launching this project with Pi.
