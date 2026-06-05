---
name: computer-control
description: Use for Xiaomi MiMo screen understanding and carefully gated Windows keyboard/mouse control through Pi tools.
---

# Computer Control

Use this skill when the user asks Pi to inspect the screen, understand an image/screenshot, or control the local Windows desktop with keyboard and mouse actions.

## Model Routing

- Use `describe_screen` for visual interpretation. It captures a screenshot and sends it to Xiaomi `mimo-v2.5`, the multimodal model.
- Use text-only reasoning with `mimo-v2.5-pro`; do not use `mimo-v2.5-pro` for image or screenshot understanding.
- If a task requires visual coordinates, first call `describe_screen` with a prompt asking for visible UI elements and approximate coordinates.

## Safe Workflow

1. Observe first with `screenshot_screen` or `describe_screen`.
2. Explain the intended next action in normal assistant text.
3. Use one sensitive action tool at a time.
4. Re-observe after clicks, typing, hotkeys, or drag operations.

## Tools

- Read-only tools: `screenshot_screen`, `describe_screen`, `wait`, `start_wechat`.
- Sensitive tools: `windows_powershell`, `click`, `double_click`, `right_click`, `move_mouse`, `drag`, `scroll`, `type_text`, `press_key`, `hotkey`.

Sensitive tools require user confirmation by default. If confirmation is denied, treat the action as not executed and re-plan.

On Windows, do not use Pi's built-in `bash` tool for Windows commands. Use `start_wechat` to open WeChat and `windows_powershell` for Windows shell checks.

After every sensitive action, inspect the returned `afterScreenshot` or call `describe_screen` before choosing the next action. Do not chain multiple clicks, drags, hotkeys, or typing actions without an observation step.

## Coordinate Rules

- Prefer normalized coordinates for all mouse actions: pass `nx` and `ny`, each from 0 to 1, instead of pixel `x` and `y`.
- `nx=0, ny=0` is the top-left of the current virtual screen; `nx=1, ny=1` is the bottom-right; `nx=0.5, ny=0.5` is screen center.
- `describe_screen` asks MiMo to return both normalized `nx/ny` and best-effort pixel `x/y`; use `nx/ny` when available.
- Pixel `x/y` remains supported, but it is less reliable across resolution, DPI scaling, or monitor-layout changes.
- For mouse targeting, prefer full-screen `describe_screen` calls. If `describe_screen` was called with `region`, its `nx/ny` are relative to that cropped region and must not be passed directly to mouse tools.
- Do not guess coordinates from memory. Use `describe_screen` or a screenshot before clicking.
- For drag, prefer `fromNx/fromNy/toNx/toNy` instead of `fromX/fromY/toX/toY`.

## Text Entry

`type_text` uses clipboard paste with best-effort text clipboard restoration. Avoid using it for secrets unless the user explicitly asks.
