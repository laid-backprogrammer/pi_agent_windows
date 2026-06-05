package agent

import (
	"bufio"
	"os"
	"strings"
)

type MimoConfig struct {
	APIKey             string
	ChatCompletionsURL string
	TextModel          string
}

func LoadDotEnv(path string) error {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

func ReadMimoConfig() MimoConfig {
	return MimoConfig{
		APIKey:             os.Getenv("XIAOMI_API_KEY"),
		ChatCompletionsURL: normalizeChatURL(os.Getenv("XIAOMI_BASE_URL")),
		TextModel:          defaultString(os.Getenv("MIMO_TEXT_MODEL"), "mimo-v2.5"),
	}
}

func normalizeChatURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "https://api.xiaomimimo.com/v1/chat/completions"
	}
	return strings.TrimRight(raw, "/")
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
