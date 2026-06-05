# Pi Agent Reference Summary

- Pi extensions are TypeScript modules that can register tools, commands, event handlers, and providers.
- Current project-local extension auto-discovery paths are `.pi/extensions/*.ts` and `.pi/extensions/*/index.ts`.
- Current project-local skill discovery paths include `.pi/skills/`.
- `pi.registerTool()` registers LLM-callable tools. Tool definitions include `name`, `label`, `description`, `parameters`, and `execute()`.
- `ctx.ui.confirm(title, message)` is available for interactive confirmation before sensitive actions.
- `pi.registerProvider()` can register an OpenAI-compatible provider using `api: "openai-completions"`.

Sources:
- https://pi.dev/docs/latest/extensions
- https://pi.dev/docs/latest/skills
- https://pi.dev/docs/latest/providers
- https://pi.dev/docs/latest/models

