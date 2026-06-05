package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type BotAccount struct {
	BotID         string            `json:"bot_id"`
	UserID        string            `json:"user_id"`
	Cursor        string            `json:"cursor"`
	ContextTokens map[string]string `json:"context_tokens"`
}

type State struct {
	Token         string                `json:"token"`
	BotID         string                `json:"bot_id"`
	UserID        string                `json:"user_id"`
	Cursor        string                `json:"cursor"`
	ContextTokens map[string]string     `json:"context_tokens"`
	CurrentUser   string                `json:"current_user"`
	BotAccounts   map[string]BotAccount `json:"bot_accounts"`
	UserTokenMap  map[string]string     `json:"user_token_map"`
	AdminUserID   string                `json:"admin_user_id"`
}

func Empty() State {
	return State{
		ContextTokens: map[string]string{},
		BotAccounts:   map[string]BotAccount{},
		UserTokenMap:  map[string]string{},
	}
}

func Load(path string) (State, error) {
	state := Empty()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return state, nil
		}
		return state, err
	}
	if len(data) == 0 {
		return state, nil
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, err
	}
	normalize(&state)
	return state, nil
}

func Save(path string, state State) error {
	normalize(&state)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

func normalize(state *State) {
	if state.ContextTokens == nil {
		state.ContextTokens = map[string]string{}
	}
	if state.BotAccounts == nil {
		state.BotAccounts = map[string]BotAccount{}
	}
	if state.UserTokenMap == nil {
		state.UserTokenMap = map[string]string{}
	}
	if state.Token != "" {
		if _, ok := state.BotAccounts[state.Token]; !ok {
			state.BotAccounts[state.Token] = BotAccount{
				BotID:         state.BotID,
				UserID:        state.UserID,
				Cursor:        state.Cursor,
				ContextTokens: copyMap(state.ContextTokens),
			}
		}
		for userID := range state.ContextTokens {
			if state.UserTokenMap[userID] == "" {
				state.UserTokenMap[userID] = state.Token
			}
		}
	}
	for token, account := range state.BotAccounts {
		if account.ContextTokens == nil {
			account.ContextTokens = map[string]string{}
			state.BotAccounts[token] = account
		}
	}
}

func copyMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
