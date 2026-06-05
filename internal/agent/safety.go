package agent

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var forbiddenPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(invoke-webrequest|iwr|curl|wget|invoke-restmethod|irm)\b`),
	regexp.MustCompile(`(?i)\b(start-process|stop-process|kill|taskkill|sc\.exe|net\s+start|net\s+stop)\b`),
	regexp.MustCompile(`(?i)\b(new-service|set-service|remove-service|start-service|stop-service)\b`),
	regexp.MustCompile(`(?i)\b(schtasks|register-scheduledtask|unregister-scheduledtask)\b`),
	regexp.MustCompile(`(?i)\b(set-executionpolicy|start-bitstransfer|powershell\s+-|pwsh\s+-)\b`),
	regexp.MustCompile(`(?i)\b(reg|regedit|hklm:|hkcu:|registry::)\b`),
	regexp.MustCompile(`(?i)\b(takeown|icacls|runas|new-localuser|set-localuser|add-localgroupmember)\b`),
	regexp.MustCompile(`(?i)\b(cd|set-location)\s+([a-z]:|\\\\|/)`),
	regexp.MustCompile(`(?i)(^|[\s'"` + "`" + `])([a-z]:\\|\\\\)`),
}

var pathTokenPattern = regexp.MustCompile(`(?i)(?:'([^']+)'|"([^"]+)"|([^\s;|&<>]+))`)

func ValidatePowerShell(root string, plan Plan) error {
	cmd := strings.TrimSpace(plan.PowerShell)
	if cmd == "" {
		return fmt.Errorf("empty powershell command")
	}
	if strings.Contains(cmd, "..") {
		return fmt.Errorf("command contains parent-directory traversal")
	}
	for _, pattern := range forbiddenPatterns {
		if pattern.MatchString(cmd) {
			return fmt.Errorf("command contains forbidden pattern: %s", pattern.String())
		}
	}
	if strings.EqualFold(plan.Risk, "high") {
		return fmt.Errorf("planner marked this command as high risk")
	}
	for _, p := range plan.ExpectedPaths {
		if err := validateRelativePath(root, p); err != nil {
			return err
		}
	}
	for _, match := range pathTokenPattern.FindAllStringSubmatch(cmd, -1) {
		token := firstNonEmpty(match[1], match[2], match[3])
		if looksLikePath(token) {
			if err := validateRelativePath(root, token); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateRelativePath(root, raw string) error {
	raw = strings.TrimSpace(strings.Trim(raw, `"'`))
	if raw == "" {
		return nil
	}
	if strings.Contains(raw, "..") {
		return fmt.Errorf("path %q contains parent-directory traversal", raw)
	}
	if filepath.IsAbs(raw) || regexp.MustCompile(`(?i)^[a-z]:\\`).MatchString(raw) || strings.HasPrefix(raw, `\\`) {
		return fmt.Errorf("path %q is outside the workspace because it is absolute", raw)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(filepath.Join(rootAbs, raw))
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path %q resolves outside the workspace", raw)
	}
	return nil
}

func looksLikePath(token string) bool {
	token = strings.Trim(token, `"'`)
	if token == "" || strings.HasPrefix(token, "-") || strings.HasPrefix(token, "$") {
		return false
	}
	if strings.ContainsAny(token, `\/`) {
		return true
	}
	ext := filepath.Ext(token)
	if ext != "" && len(ext) <= 8 {
		return true
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
