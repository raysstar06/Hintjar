# HintJar

HintJar is a local Twitch chat bot and OBS browser overlay for catching backseat hints. It removes matching chat messages, saves them to a local jar, and lets the streamer reveal them when needed. The local demo works without Twitch credentials.

## Requirements

- Node.js 18 or newer (for built-in `fetch`)
- A Twitch account for the bot, and a Twitch application

## Setup

1. Create a Twitch application at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). Set the OAuth redirect URL to `http://localhost:3000/auth/callback` and the category to **Website Integration**.
2. Copy `.env.example` to `.env`. Add your application's client ID and client secret, and the broadcaster's Twitch login. Leave `PORT=3000` unless you also change the redirect URL in the Twitch application.
3. Add the bot account as a moderator on the broadcaster's channel using `/mod bot_login` in the channel chat. The bot account is the account that authorizes at the login page.
4. In this folder run:

   ```sh
   npm install
   npm start
   ```

5. Visit [http://localhost:3000/auth/login](http://localhost:3000/auth/login) and authorize the bot account. HintJar stores access and refresh tokens in `tokens.json`, refreshes access tokens automatically, and reconnects to EventSub on startup.
6. Add an OBS **Browser Source** with URL `http://localhost:3000/overlay`, width `1920`, and height `1080`. Keep HintJar running while streaming. The overlay has a transparent background.

## Commands

- `!spoilers word1, word2, ...` — broadcaster/mod sets spoiler terms for this run.
- `!jar` — reveals the oldest sealed hint in chat and on the overlay.
- `!spill` — reveals all sealed hints one by one, three seconds apart.
- `!jarcount` — anyone can check the sealed count.
- `!jarreset` — empties the jar.

Hint patterns and spoiler matching are in `detector.js`. Broadcaster and moderator messages, and messages starting with `!`, are ignored by the detector. Hints and revealed state are stored in `jar.json` locally. Use `!jarreset` to clear them.

## Local demo

Open [http://localhost:3000/test](http://localhost:3000/test) to simulate viewer messages without connecting Twitch. Try `go left`, `look behind the door`, and ordinary text. You can also try `!spoilers key, door`, then send a message containing `key`, or use `!jar`, `!spill`, and `!jarreset`. The simulated `!spoilers` command configures terms in memory for the current server run.

## How Codex was used

Codex helped build the local Node.js service, rule-based detector, Twitch OAuth and EventSub integration, OBS overlay, and local demo. The code uses plain JavaScript, HTML, and CSS with no build step, framework, paid API, or database.
