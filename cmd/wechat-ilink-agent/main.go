package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/laid-backprogrammer/pi_agent_windows/internal/agent"
	"github.com/laid-backprogrammer/pi_agent_windows/internal/config"
	"github.com/laid-backprogrammer/pi_agent_windows/internal/ilink"
	qrcode "github.com/skip2/go-qrcode"
)

const (
	cmdHelpCN    = "\u5e2e\u52a9"
	cmdStatusCN  = "\u72b6\u6001"
	cmdConfirmCN = "\u786e\u8ba4"
	cmdCancelCN  = "\u53d6\u6d88"
)

func main() {
	rootFlag := flag.String("root", ".", "workspace root for local commands")
	configFlag := flag.String("config", "wechat_bot_config.json", "iLink config file")
	flag.Parse()

	root, err := filepath.Abs(*rootFlag)
	if err != nil {
		fatal(err)
	}
	if err := agent.LoadDotEnv(filepath.Join(root, ".env")); err != nil {
		fatal(err)
	}
	state, err := config.Load(*configFlag)
	if err != nil {
		fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := ilink.NewClient()
	if state.Token == "" {
		if err := login(ctx, client, &state, *configFlag, root); err != nil {
			fatal(err)
		}
	} else {
		fmt.Printf("[iLink] Loaded saved login state. users=%d\n", len(state.ContextTokens))
	}

	planner := agent.Planner{Config: agent.ReadMimoConfig()}
	pending := agent.NewPendingStore(10 * time.Minute)
	fmt.Printf("[Agent] Workspace: %s\n", root)
	fmt.Println("[Agent] Started. Send help/status from WeChat, or send a natural-language file task.")
	runPolling(ctx, client, planner, pending, &state, *configFlag, root)
}

func login(ctx context.Context, client *ilink.Client, state *config.State, configPath, root string) error {
	fmt.Println("[iLink] Requesting QR code...")
	qr, err := client.GetQRCode(ctx)
	if err != nil {
		return err
	}
	if qr.QRCodeImgContent != "" {
		qrPath := filepath.Join(root, ".wechat-agent-qrcode.png")
		if err := qrcode.WriteFile(qr.QRCodeImgContent, qrcode.Medium, 512, qrPath); err != nil {
			fmt.Printf("[iLink] Failed to write QR PNG: %v\n", err)
		} else {
			fmt.Printf("[iLink] QR PNG saved: %s\n", qrPath)
			if err := openFile(qrPath); err != nil {
				fmt.Printf("[iLink] Could not auto-open QR PNG: %v\n", err)
			}
		}
		fmt.Println("[iLink] If the image did not open, open the QR PNG path above and scan it with WeChat.")
		fmt.Println("[iLink] Raw QR URL:")
		fmt.Println(qr.QRCodeImgContent)
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			status, err := client.GetQRCodeStatus(ctx, qr.QRCode)
			if err != nil {
				fmt.Printf("[iLink] QR status failed: %v\n", err)
				continue
			}
			switch status.Status {
			case "scaned":
				fmt.Println("[iLink] QR scanned. Waiting for phone confirmation...")
			case "confirmed":
				state.Token = status.BotToken
				state.BotID = status.IlinkBotID
				state.UserID = status.IlinkUserID
				state.BotAccounts[state.Token] = config.BotAccount{
					BotID:         state.BotID,
					UserID:        state.UserID,
					Cursor:        state.Cursor,
					ContextTokens: map[string]string{},
				}
				if err := config.Save(configPath, *state); err != nil {
					return err
				}
				fmt.Printf("[iLink] Login confirmed. bot_id=%s user_id=%s\n", state.BotID, state.UserID)
				return nil
			case "expired":
				return fmt.Errorf("QR code expired")
			}
		}
	}
}

func runPolling(ctx context.Context, client *ilink.Client, planner agent.Planner, pending *agent.PendingStore, state *config.State, configPath, root string) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if len(state.BotAccounts) == 0 && state.Token != "" {
			state.BotAccounts[state.Token] = config.BotAccount{
				BotID:         state.BotID,
				UserID:        state.UserID,
				Cursor:        state.Cursor,
				ContextTokens: state.ContextTokens,
			}
		}
		for token, account := range state.BotAccounts {
			updates, err := client.GetUpdates(ctx, token, account.Cursor, 25*time.Second)
			if err != nil {
				fmt.Printf("[POLL] getupdates failed: %v\n", err)
				time.Sleep(2 * time.Second)
				continue
			}
			if updates.GetUpdatesBuf != "" {
				account.Cursor = updates.GetUpdatesBuf
				state.BotAccounts[token] = account
				if token == state.Token {
					state.Cursor = updates.GetUpdatesBuf
				}
				_ = config.Save(configPath, *state)
			}
			for _, msg := range updates.Messages {
				if msg.FromUserID == "" || msg.ContextToken == "" {
					continue
				}
				registerUser(state, token, msg.FromUserID, msg.ContextToken)
				account.ContextTokens[msg.FromUserID] = msg.ContextToken
				state.BotAccounts[token] = account
				_ = config.Save(configPath, *state)
				text := strings.TrimSpace(msg.Text())
				if text == "" {
					continue
				}
				fmt.Printf("[MSG] %s: %s\n", msg.FromUserID, text)
				handleMessage(ctx, client, planner, pending, state, configPath, root, token, msg.FromUserID, text)
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func registerUser(state *config.State, token, userID, contextToken string) {
	if state.ContextTokens == nil {
		state.ContextTokens = map[string]string{}
	}
	if state.UserTokenMap == nil {
		state.UserTokenMap = map[string]string{}
	}
	state.ContextTokens[userID] = contextToken
	state.UserTokenMap[userID] = token
	if state.CurrentUser == "" {
		state.CurrentUser = userID
	}
	if state.AdminUserID == "" {
		state.AdminUserID = userID
		fmt.Printf("[AUTH] Bound first admin user: %s\n", userID)
	}
}

func handleMessage(ctx context.Context, client *ilink.Client, planner agent.Planner, pending *agent.PendingStore, state *config.State, configPath, root, token, fromUser, text string) {
	if state.AdminUserID != "" && fromUser != state.AdminUserID {
		reply(ctx, client, state, token, fromUser, "This agent is already bound to an admin user. This chat cannot run local operations.")
		return
	}
	lower := strings.ToLower(text)
	switch {
	case text == cmdHelpCN || lower == "help":
		reply(ctx, client, state, token, fromUser, "Send a natural-language file task. I will reply with a PowerShell plan. Reply 'confirm <code>' or '\u786e\u8ba4 <code>' to run it, or 'cancel <code>' / '\u53d6\u6d88 <code>' to discard it. Commands are limited to the workspace.")
	case text == cmdStatusCN || lower == "status":
		reply(ctx, client, state, token, fromUser, fmt.Sprintf("Connected.\nWorkspace: %s\nAdmin: %s\nChats: %d", root, state.AdminUserID, len(state.ContextTokens)))
	case hasCommandPrefix(text, lower, cmdConfirmCN, "confirm"):
		code := commandArgument(text)
		item, err := pending.Confirm(fromUser, strings.ToUpper(code))
		if err != nil {
			reply(ctx, client, state, token, fromUser, "Confirm failed: "+err.Error())
			return
		}
		if err := agent.ValidatePowerShell(root, item.Plan); err != nil {
			reply(ctx, client, state, token, fromUser, "Safety check failed before execution: "+err.Error())
			return
		}
		result, err := agent.ExecutePowerShell(ctx, root, item.Plan.PowerShell, 30*time.Second, 3500)
		if err != nil {
			reply(ctx, client, state, token, fromUser, "Execution failed: "+err.Error()+"\n"+result.Output)
			return
		}
		reply(ctx, client, state, token, fromUser, fmt.Sprintf("Done. exit_code=%d\n%s", result.ExitCode, result.Output))
	case hasCommandPrefix(text, lower, cmdCancelCN, "cancel"):
		code := commandArgument(text)
		if pending.Cancel(fromUser, strings.ToUpper(code)) {
			reply(ctx, client, state, token, fromUser, "Cancelled.")
		} else {
			reply(ctx, client, state, token, fromUser, "Confirmation code not found.")
		}
	default:
		plan, err := planner.Plan(ctx, text, root)
		if err != nil {
			reply(ctx, client, state, token, fromUser, "Planning failed: "+err.Error())
			return
		}
		if err := agent.ValidatePowerShell(root, plan); err != nil {
			reply(ctx, client, state, token, fromUser, "Rejected: "+err.Error()+"\nPlan summary: "+plan.Summary)
			return
		}
		item, err := pending.Create(fromUser, plan)
		if err != nil {
			reply(ctx, client, state, token, fromUser, "Could not create confirmation code: "+err.Error())
			return
		}
		msg := fmt.Sprintf("Pending plan [%s]\nSummary: %s\nRisk: %s\nCommand:\n%s\n\nReply 'confirm %s' or '\u786e\u8ba4 %s' to run it. Reply 'cancel %s' or '\u53d6\u6d88 %s' to discard it.", item.Code, plan.Summary, plan.Risk, plan.PowerShell, item.Code, item.Code, item.Code, item.Code)
		reply(ctx, client, state, token, fromUser, msg)
	}
	_ = config.Save(configPath, *state)
}

func hasCommandPrefix(text, lower, cn, en string) bool {
	return strings.HasPrefix(text, cn+" ") || strings.HasPrefix(lower, en+" ")
}

func commandArgument(text string) string {
	parts := strings.Fields(text)
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

func reply(ctx context.Context, client *ilink.Client, state *config.State, token, toUser, text string) {
	contextToken := state.ContextTokens[toUser]
	if contextToken == "" {
		fmt.Printf("[SEND] Missing context token for %s\n", toUser)
		return
	}
	resp, err := client.SendText(ctx, token, toUser, contextToken, text)
	if err != nil {
		fmt.Printf("[SEND] failed: %v\n", err)
		return
	}
	if resp.Ret != 0 && resp.ErrCode != 0 {
		fmt.Printf("[SEND] iLink error: ret=%d errcode=%d errmsg=%s\n", resp.Ret, resp.ErrCode, resp.ErrMsg)
	}
}

func openFile(path string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("cmd", "/c", "start", "", path).Start()
	case "darwin":
		return exec.Command("open", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
