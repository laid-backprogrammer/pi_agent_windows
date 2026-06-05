# Xiaomi MiMo Reference Summary

- OpenAI-compatible chat endpoint: `https://api.xiaomimimo.com/v1/chat/completions`.
- Authentication supports an `api-key` header and also `Authorization: Bearer`.
- `mimo-v2.5-pro` is the text model used here for planning and text-only reasoning.
- `mimo-v2.5` is the multimodal model used here for screenshot and image understanding.
- Image input uses OpenAI-style content parts with `type: "image_url"` and either a public URL or a `data:{MIME_TYPE};base64,{BASE64}` URL.
- Xiaomi's image understanding page currently lists image understanding support for `mimo-v2.5`.

Sources:
- https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api
- https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/multimodal-understanding/image-understanding
- https://platform.xiaomimimo.com/docs/zh-CN/quick-start/model

