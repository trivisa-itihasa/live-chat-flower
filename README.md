# Live Chat Flower

A Tampermonkey userscript that scrolls Twitch and YouTube live chat across the stream from right to left, the way comments appear on Niconico.

## Features

- Reads chat as an anonymous, read-only user, so it works with the chat panel closed and in fullscreen.
  - Twitch: connects to Twitch's IRC server.
  - YouTube: polls the chat API that YouTube's own web player uses, every 2 seconds. Messages that arrive together are spread out using the times they were posted, so they don't burst onto the screen all at once.
- Shows Twitch emotes and YouTube custom (channel member) emoji as images.
- Removes a message from the screen when a moderator deletes it, and removes a user's messages when they are banned or timed out.
- Filters messages by word (plain text or regular expression) and by user.
- `Alt+C` shows or hides the comments.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/). In Chrome, also turn on "Allow User Scripts" on the extension's details page.
2. Open [live-chat-flower.user.js](live-chat-flower.user.js) and click "Raw". Tampermonkey will open its install page.
3. Open a live stream on Twitch or YouTube.

## Configuration

Edit the `CONFIG` object at the top of the script. The main options are:

| Option | Default | Description |
|---|---|---|
| `OPACITY` | `0.8` | Comment opacity, from 0 to 1 |
| `FONT_FAMILY` / `FONT_WEIGHT` | Hiragino, Meiryo / `bold` | Font |
| `LINES` | `12` | How many lines the video height is divided into. Higher values give smaller text. |
| `DURATION_SEC` | `5` | Seconds a comment takes to cross the screen. Lower is faster. |
| `SPEED_MODE` | `'nico'` | `'nico'`: every comment takes the same time to cross, so longer ones move faster. `'constant'`: every comment moves at the same speed. |
| `DISPLAY_AREA` | `1.0` | Portion of the video, measured from the top, that comments can use. `0.5` is the top half. |
| `WHEN_FULL` | `'overlap'` | What happens when every line is taken: overlap other comments (`'overlap'`) or skip the new one (`'drop'`). |
| `NG_WORDS` / `NG_USERS` | Common bots | Words and users to filter out. On YouTube, a user can be given by handle (with or without `@`) or channel ID. |
| `TOGGLE_HOTKEY` | `'Alt+C'` | Key that shows or hides the comments |
| `YOUTUBE.CHAT_MODE` | `'all'` | `'all'`: every message ("Live chat" in YouTube's chat panel). `'top'`: "Top chat", which leaves out messages that may be spam. |

You can also set the text color, outline, whether to use each chatter's name color (on YouTube, the colors for the channel owner, moderators and members), whether to show usernames, a length limit, and whether to show messages attached to Twitch subscriptions or YouTube Super Chats. The comments in the script (in Japanese) describe every option.

## How it works

Fetching chat is platform-specific; drawing it is not. The two sides only exchange `FlowComment` objects.

```
TwitchChatSource  ─┐
                   ├─FlowComment──▶ LiveChatFlower ──▶ filter ──▶ FlowRenderer
YouTubeChatSource ─┘
```

- `TwitchChatSource` and `TwitchAdapter` (Twitch-specific) connect to chat, work out the channel from the URL, and find the `<video>` element.
- `YouTubeChatSource` and `YouTubeAdapter` (YouTube-specific) read the API settings from the video's chat page, poll for new messages, and find the video. The video ID is read from the watch page rather than the URL, so channel URLs like `/@name/live` work too. Videos with no chat panel are skipped without fetching anything.
- `LiveChatFlower` (shared) watches the URL and the player, and reconnects when you switch channels or videos.
- `FlowRenderer` (shared) assigns comments to lines so they don't overlap, and animates them.

To support another site, implement a `CommentSource` and a `PlatformAdapter`, add the adapter to `ADAPTERS`, and add the site's URL to `@match` in the script header. The shared code stays the same.

## Limitations

- Live streams only. Chat replay on past broadcasts (Twitch VODs, YouTube archives) isn't supported.
- BTTV, 7TV and FFZ emotes appear as text.
- Comments on screen are cleared whenever the video changes size, such as when you enter fullscreen or theater mode.
- YouTube:
  - Comments appear a second or two after they show up in YouTube's own chat panel, because the script polls every 2 seconds.
  - Only messages typed by viewers are shown. Super Stickers, gifts and new-member announcements aren't.
  - Members-only chat isn't supported.
  - `Alt+C` doesn't work while YouTube's chat panel has keyboard focus. Click the video first.
  - The mobile site (m.youtube.com) and embedded players aren't supported.

## License

[MIT](LICENSE)
