package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Plan struct {
	Summary       string   `json:"summary"`
	PowerShell    string   `json:"powershell"`
	Risk          string   `json:"risk"`
	ExpectedPaths []string `json:"expected_paths"`
}

type Planner struct {
	Config     MimoConfig
	HTTPClient *http.Client
}

func (p Planner) Plan(ctx context.Context, userText, root string) (Plan, error) {
	if strings.TrimSpace(p.Config.APIKey) == "" {
		return Plan{}, errors.New("missing XIAOMI_API_KEY")
	}
	prompt := fmt.Sprintf(`你是一个本地 Windows 文件操作 agent 的命令规划器。
只输出 JSON，不要输出 Markdown，不要解释。
JSON schema:
{"summary":"一句中文摘要","powershell":"单条或多条 PowerShell 命令","risk":"low|medium|high","expected_paths":["相对工作区路径"]}

硬性规则:
- 工作区根目录是: %s
- 命令必须能在该工作区作为当前目录执行。
- 优先使用相对路径。
- 不要访问工作区外的路径，不要使用绝对路径，不要使用 ..。
- 不要执行网络下载、注册表、服务、计划任务、权限修改、进程结束或系统配置命令。
- 如果用户请求不安全或超出工作区，输出 powershell 为空字符串，risk 为 high，并在 summary 说明拒绝原因。

用户请求: %s`, root, userText)
	reqBody := map[string]any{
		"model": p.Config.TextModel,
		"messages": []map[string]string{
			{"role": "system", "content": "You output strict JSON only."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0,
	}
	data, err := json.Marshal(reqBody)
	if err != nil {
		return Plan{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.Config.ChatCompletionsURL, bytes.NewReader(data))
	if err != nil {
		return Plan{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", p.Config.APIKey)
	req.Header.Set("Authorization", "Bearer "+p.Config.APIKey)
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return Plan{}, err
	}
	defer resp.Body.Close()
	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return Plan{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Plan{}, fmt.Errorf("MiMo request failed: status=%d body=%s", resp.StatusCode, trim(respData, 500))
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respData, &decoded); err != nil {
		return Plan{}, err
	}
	if len(decoded.Choices) == 0 {
		return Plan{}, errors.New("MiMo response had no choices")
	}
	return ParsePlan(decoded.Choices[0].Message.Content)
}

func ParsePlan(content string) (Plan, error) {
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```") {
		lines := strings.Split(content, "\n")
		if len(lines) >= 3 {
			lines = lines[1 : len(lines)-1]
			content = strings.TrimSpace(strings.Join(lines, "\n"))
		}
	}
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}
	var plan Plan
	if err := json.Unmarshal([]byte(content), &plan); err != nil {
		return plan, err
	}
	plan.Summary = strings.TrimSpace(plan.Summary)
	plan.PowerShell = strings.TrimSpace(plan.PowerShell)
	plan.Risk = strings.ToLower(strings.TrimSpace(plan.Risk))
	if plan.Risk == "" {
		plan.Risk = "medium"
	}
	return plan, nil
}

func trim(data []byte, max int) string {
	s := string(data)
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}
