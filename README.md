# Live Chat Flower

A Tampermonkey userscript that scrolls Twitch chat across the stream from right to left, the way comments appear on Niconico.

## Features

- Reads chat from Twitch's IRC server as an anonymous, read-only user, so it works with the chat panel closed and in fullscreen.
- Shows Twitch emotes as images.
- Removes a message from the screen when a moderator deletes it, and removes a user's messages when they are banned or timed out.
- Filters messages by word (plain text or regular expression) and by user.
- `Alt+C` shows or hides the comments.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/). In Chrome, also turn on "Allow User Scripts" on the extension's details page.
2. Open [live-chat-flower.user.js](live-chat-flower.user.js) and click "Raw". Tampermonkey will open its install page.
3. Open a live stream on Twitch.

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
| `NG_WORDS` / `NG_USERS` | Common bots | Words and users to filter out |
| `TOGGLE_HOTKEY` | `'Alt+C'` | Key that shows or hides the comments |

You can also set the text color, outline, whether to use each chatter's name color, whether to show usernames, and a length limit. The comments in the script (in Japanese) describe every option.

## How it works

Fetching chat is platform-specific; drawing it is not. The two sides only exchange `FlowComment` objects.

```
TwitchChatSource ──FlowComment──▶ LiveChatFlower ──▶ filter ──▶ FlowRenderer
```

- `TwitchChatSource` and `TwitchAdapter` (Twitch-specific) connect to chat, work out the channel from the URL, and find the `<video>` element.
- `LiveChatFlower` (shared) watches the URL and the player, and reconnects when you switch channels.
- `FlowRenderer` (shared) assigns comments to lines so they don't overlap, and animates them.

To support another site, implement a `CommentSource` and a `PlatformAdapter`, add the adapter to `ADAPTERS`, and add the site's URL to `@match` in the script header. The shared code stays the same.

## Limitations

- Live streams only. Chat replay on past broadcasts (VODs) isn't supported.
- BTTV, 7TV and FFZ emotes appear as text.
- Comments on screen are cleared whenever the video changes size, such as when you enter fullscreen or theater mode.

## License

[MIT](LICENSE)
