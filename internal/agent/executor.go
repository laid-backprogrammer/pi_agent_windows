package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type ExecResult struct {
	Output   string
	ExitCode int
	SavedTo  string
}

func ExecutePowerShell(ctx context.Context, root, command string, timeout time.Duration, maxChars int) (ExecResult, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if maxChars <= 0 {
		maxChars = 3500
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	exe := "powershell.exe"
	if _, err := exec.LookPath(exe); err != nil {
		if _, pwshErr := exec.LookPath("pwsh.exe"); pwshErr == nil {
			exe = "pwsh.exe"
		}
	}
	cmd := exec.CommandContext(ctx, exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	result := ExecResult{Output: strings.TrimSpace(string(out))}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
	} else if err != nil {
		return result, err
	}
	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("PowerShell command timed out after %s", timeout)
	}
	if result.Output == "" {
		result.Output = "命令已执行，没有输出。"
	}
	if len(result.Output) > maxChars {
		full := result.Output
		dir := filepath.Join(root, ".wechat-agent-output")
		if mkErr := os.MkdirAll(dir, 0o755); mkErr == nil {
			name := "output-" + time.Now().Format("20060102-150405") + ".txt"
			path := filepath.Join(dir, name)
			if writeErr := os.WriteFile(path, []byte(full), 0o600); writeErr == nil {
				result.SavedTo = filepath.Join(".wechat-agent-output", name)
			}
		}
		result.Output = full[:maxChars] + "\n\n[输出过长，已截断]"
		if result.SavedTo != "" {
			result.Output += "\n完整输出: " + result.SavedTo
		}
	}
	return result, nil
}
