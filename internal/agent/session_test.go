package agent

import (
	"testing"
	"time"
)

func TestPendingStoreConfirmAndCancel(t *testing.T) {
	store := NewPendingStore(time.Minute)
	item, err := store.Create("user-1", Plan{PowerShell: "Get-ChildItem ."})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("user-2", item.Code); err == nil {
		t.Fatalf("expected wrong user rejection")
	}
	confirmed, err := store.Confirm("user-1", item.Code)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Code != item.Code {
		t.Fatalf("confirmed code = %q", confirmed.Code)
	}
	item, err = store.Create("user-1", Plan{PowerShell: "Get-ChildItem ."})
	if err != nil {
		t.Fatal(err)
	}
	if !store.Cancel("user-1", item.Code) {
		t.Fatalf("expected cancel success")
	}
	if _, err := store.Confirm("user-1", item.Code); err == nil {
		t.Fatalf("expected cancelled code to be gone")
	}
}

func TestPendingStoreExpires(t *testing.T) {
	store := NewPendingStore(time.Nanosecond)
	item, err := store.Create("user-1", Plan{PowerShell: "Get-ChildItem ."})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	if _, err := store.Confirm("user-1", item.Code); err == nil {
		t.Fatalf("expected expired code")
	}
}
