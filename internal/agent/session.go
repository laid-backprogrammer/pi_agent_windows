package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type PendingCommand struct {
	Code      string
	UserID    string
	Plan      Plan
	CreatedAt time.Time
	ExpiresAt time.Time
}

type PendingStore struct {
	mu      sync.Mutex
	ttl     time.Duration
	pending map[string]PendingCommand
}

func NewPendingStore(ttl time.Duration) *PendingStore {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &PendingStore{ttl: ttl, pending: map[string]PendingCommand{}}
}

func (s *PendingStore) Create(userID string, plan Plan) (PendingCommand, error) {
	code, err := randomCode()
	if err != nil {
		return PendingCommand{}, err
	}
	now := time.Now()
	item := PendingCommand{
		Code:      code,
		UserID:    userID,
		Plan:      plan,
		CreatedAt: now,
		ExpiresAt: now.Add(s.ttl),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	s.pending[code] = item
	return item, nil
}

func (s *PendingStore) Confirm(userID, code string) (PendingCommand, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(time.Now())
	item, ok := s.pending[code]
	if !ok {
		return PendingCommand{}, fmt.Errorf("confirmation code not found or expired")
	}
	if item.UserID != userID {
		return PendingCommand{}, fmt.Errorf("confirmation code belongs to another user")
	}
	delete(s.pending, code)
	return item, nil
}

func (s *PendingStore) Cancel(userID, code string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.pending[code]
	if !ok || item.UserID != userID {
		return false
	}
	delete(s.pending, code)
	return true
}

func (s *PendingStore) cleanupLocked(now time.Time) {
	for code, item := range s.pending {
		if now.After(item.ExpiresAt) {
			delete(s.pending, code)
		}
	}
}

func randomCode() (string, error) {
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return stringsUpper(hex.EncodeToString(b[:])), nil
}

func stringsUpper(value string) string {
	out := []byte(value)
	for i, b := range out {
		if b >= 'a' && b <= 'f' {
			out[i] = b - 32
		}
	}
	return string(out)
}
