package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPythonCompatibleConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wechat_bot_config.json")
	data := `{
  "token": "bot-token",
  "bot_id": "bot-id",
  "user_id": "user-id",
  "cursor": "cursor-1",
  "context_tokens": {"wx-user": "ctx-1"},
  "current_user": "wx-user",
  "bot_accounts": {},
  "user_token_map": {}
}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if state.Token != "bot-token" {
		t.Fatalf("token = %q", state.Token)
	}
	if state.UserTokenMap["wx-user"] != "bot-token" {
		t.Fatalf("expected user token map to be backfilled")
	}
	if state.BotAccounts["bot-token"].ContextTokens["wx-user"] != "ctx-1" {
		t.Fatalf("expected bot account to be backfilled")
	}
}

func TestSaveAndReloadAdminUser(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	state := Empty()
	state.Token = "token"
	state.AdminUserID = "wx-admin"
	state.ContextTokens["wx-admin"] = "ctx"
	if err := Save(path, state); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.AdminUserID != "wx-admin" {
		t.Fatalf("admin_user_id = %q", loaded.AdminUserID)
	}
}
