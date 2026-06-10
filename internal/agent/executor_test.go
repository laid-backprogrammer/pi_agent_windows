package agent

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestExecutePowerShellPreservesUTF8Output(t *testing.T) {
	if _, err := exec.LookPath("powershell.exe"); err != nil {
		if _, pwshErr := exec.LookPath("pwsh.exe"); pwshErr != nil {
			t.Skip("PowerShell is not available")
		}
	}

	result, err := ExecutePowerShell(context.Background(), ".", "Write-Output '微信'", 5*time.Second, 3500)
	if err != nil {
		t.Fatalf("ExecutePowerShell returned error: %v", err)
	}
	if !strings.Contains(result.Output, "微信") {
		t.Fatalf("output = %q, want it to contain 微信", result.Output)
	}
}

func TestWrapPowerShellUTF8ConfiguresConsoleEncoding(t *testing.T) {
	wrapped := wrapPowerShellUTF8("Write-Output 'ok'")
	for _, needle := range []string{"InputEncoding", "OutputEncoding", "$OutputEncoding", "UTF8Encoding"} {
		if !strings.Contains(wrapped, needle) {
			t.Fatalf("wrapped command missing %q: %s", needle, wrapped)
		}
	}
}
