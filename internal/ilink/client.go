package ilink

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const DefaultBaseURL = "https://ilinkai.weixin.qq.com"

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewClient() *Client {
	return &Client{
		BaseURL: DefaultBaseURL,
		HTTPClient: &http.Client{
			Timeout: 35 * time.Second,
		},
	}
}

type QRCodeResponse struct {
	QRCode           string `json:"qrcode"`
	QRCodeImgContent string `json:"qrcode_img_content"`
}

type QRCodeStatus struct {
	Status      string `json:"status"`
	BotToken    string `json:"bot_token"`
	IlinkBotID  string `json:"ilink_bot_id"`
	IlinkUserID string `json:"ilink_user_id"`
}

type TextItem struct {
	Text string `json:"text"`
}

type MessageItem struct {
	Type     int       `json:"type,omitempty"`
	TextItem *TextItem `json:"text_item,omitempty"`
}

type IncomingMessage struct {
	FromUserID   string        `json:"from_user_id"`
	ContextToken string        `json:"context_token"`
	ItemList     []MessageItem `json:"item_list"`
}

func (m IncomingMessage) Text() string {
	for _, item := range m.ItemList {
		if item.TextItem != nil && item.TextItem.Text != "" {
			return item.TextItem.Text
		}
	}
	return ""
}

type UpdatesResponse struct {
	Ret           int               `json:"ret"`
	ErrCode       int               `json:"errcode"`
	ErrMsg        string            `json:"errmsg"`
	GetUpdatesBuf string            `json:"get_updates_buf"`
	Messages      []IncomingMessage `json:"msgs"`
}

type SendResponse struct {
	Ret     int    `json:"ret"`
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

func (c *Client) GetQRCode(ctx context.Context) (QRCodeResponse, error) {
	var out QRCodeResponse
	u := c.BaseURL + "/ilink/bot/get_bot_qrcode?bot_type=3"
	if err := c.getJSON(ctx, u, nil, &out); err != nil {
		return out, err
	}
	if out.QRCode == "" {
		return out, fmt.Errorf("iLink did not return qrcode")
	}
	return out, nil
}

func (c *Client) GetQRCodeStatus(ctx context.Context, qrcode string) (QRCodeStatus, error) {
	var out QRCodeStatus
	u := c.BaseURL + "/ilink/bot/get_qrcode_status?qrcode=" + url.QueryEscape(qrcode)
	headers := map[string]string{"iLink-App-ClientVersion": "1"}
	return out, c.getJSON(ctx, u, headers, &out)
}

func (c *Client) GetUpdates(ctx context.Context, token, cursor string, timeout time.Duration) (UpdatesResponse, error) {
	var out UpdatesResponse
	body := map[string]any{"get_updates_buf": cursor}
	err := c.postJSON(ctx, "getupdates", token, body, timeout, &out)
	return out, err
}

func (c *Client) SendText(ctx context.Context, token, toUserID, contextToken, text string) (SendResponse, error) {
	var out SendResponse
	clientID := "msg-" + strconv.FormatInt(time.Now().UnixNano(), 16)
	body := map[string]any{
		"msg": map[string]any{
			"from_user_id":  "",
			"to_user_id":    toUserID,
			"client_id":     clientID,
			"message_type":  2,
			"message_state": 2,
			"context_token": contextToken,
			"item_list": []map[string]any{
				{"type": 1, "text_item": map[string]string{"text": text}},
			},
		},
	}
	err := c.postJSON(ctx, "sendmessage", token, body, 30*time.Second, &out)
	return out, err
}

func (c *Client) postJSON(ctx context.Context, endpoint, token string, body map[string]any, timeout time.Duration, out any) error {
	body["base_info"] = map[string]string{"channel_version": "1.0.3"}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/ilink/bot/"+endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	for k, v := range BuildHeaders(token) {
		req.Header.Set(k, v)
	}
	client := *c.httpClient()
	if timeout > 0 {
		client.Timeout = timeout
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("iLink %s failed: status=%d body=%s", endpoint, resp.StatusCode, trimForError(respData))
	}
	if bytes.Equal(bytes.TrimSpace(respData), []byte("{}")) {
		respData = []byte(`{"ret":0}`)
	}
	if err := json.Unmarshal(respData, out); err != nil {
		return fmt.Errorf("decode iLink %s response: %w; body=%s", endpoint, err, trimForError(respData))
	}
	return nil
}

func (c *Client) getJSON(ctx context.Context, u string, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("iLink GET failed: status=%d body=%s", resp.StatusCode, trimForError(data))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("decode iLink GET response: %w; body=%s", err, trimForError(data))
	}
	return nil
}

func BuildHeaders(token string) map[string]string {
	uin := base64.StdEncoding.EncodeToString([]byte(strconv.FormatUint(uint64(rand.Uint32()), 10)))
	return map[string]string{
		"Content-Type":      "application/json",
		"AuthorizationType": "ilink_bot_token",
		"Authorization":     "Bearer " + token,
		"X-WECHAT-UIN":      uin,
	}
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func trimForError(data []byte) string {
	const max = 500
	s := string(data)
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}
