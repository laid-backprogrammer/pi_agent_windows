package agent

import "testing"

func TestParsePlanPlainJSON(t *testing.T) {
	plan, err := ParsePlan(`{"summary":"列文件","powershell":"Get-ChildItem .","risk":"low","expected_paths":["."]}`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Summary != "列文件" || plan.Risk != "low" {
		t.Fatalf("bad plan: %#v", plan)
	}
}

func TestParsePlanFencedJSON(t *testing.T) {
	plan, err := ParsePlan("```json\n{\"summary\":\"读文件\",\"powershell\":\"Get-Content README.md\",\"risk\":\"low\",\"expected_paths\":[\"README.md\"]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if plan.PowerShell != "Get-Content README.md" {
		t.Fatalf("powershell = %q", plan.PowerShell)
	}
}

func TestParsePlanInvalidJSON(t *testing.T) {
	if _, err := ParsePlan("not json"); err == nil {
		t.Fatalf("expected invalid JSON error")
	}
}
