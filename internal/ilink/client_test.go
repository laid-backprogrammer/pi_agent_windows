package ilink

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildHeaders(t *testing.T) {
	headers := BuildHeaders("token-1")
	if headers["AuthorizationType"] != "ilink_bot_token" {
		t.Fatalf("AuthorizationType = %q", headers["AuthorizationType"])
	}
	if headers["Authorization"] != "Bearer token-1" {
		t.Fatalf("Authorization = %q", headers["Authorization"])
	}
	if headers["X-WECHAT-UIN"] == "" {
		t.Fatalf("X-WECHAT-UIN is empty")
	}
}

func TestGetUpdatesBodyAndHeaders(t *testing.T) {
	var sawBaseInfo bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/getupdates" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("AuthorizationType") != "ilink_bot_token" {
			t.Fatalf("missing AuthorizationType")
		}
		if r.Header.Get("Authorization") != "Bearer token-1" {
			t.Fatalf("bad auth header")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["get_updates_buf"] != "cursor-1" {
			t.Fatalf("cursor = %#v", body["get_updates_buf"])
		}
		base, ok := body["base_info"].(map[string]any)
		if ok && base["channel_version"] == "1.0.3" {
			sawBaseInfo = true
		}
		_, _ = w.Write([]byte(`{"ret":0,"get_updates_buf":"cursor-2","msgs":[]}`))
	}))
	defer server.Close()
	client := NewClient()
	client.BaseURL = server.URL
	got, err := client.GetUpdates(context.Background(), "token-1", "cursor-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetUpdatesBuf != "cursor-2" || !sawBaseInfo {
		t.Fatalf("unexpected response/body state: %#v sawBaseInfo=%v", got, sawBaseInfo)
	}
}

func TestSendTextBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		msg := body["msg"].(map[string]any)
		if msg["to_user_id"] != "wx-user" || msg["context_token"] != "ctx" {
			t.Fatalf("bad msg: %#v", msg)
		}
		items := msg["item_list"].([]any)
		item := items[0].(map[string]any)
		text := item["text_item"].(map[string]any)["text"]
		if !strings.Contains(text.(string), "hello") {
			t.Fatalf("text = %#v", text)
		}
		_, _ = w.Write([]byte(`{"ret":0}`))
	}))
	defer server.Close()
	client := NewClient()
	client.BaseURL = server.URL
	if _, err := client.SendText(context.Background(), "token", "wx-user", "ctx", "hello"); err != nil {
		t.Fatal(err)
	}
}
