# See Figure X

A real-time party game for 2–8 players. Each round shows a prompt about a real scientific finding and a chart with labeled axes. Everyone sketches what they *think* the data looks like on their own phone. Then the real data is revealed on top of everyone's drawings, along with the citation. The fun is in arguing about why your expectations were so far off.

## Rules

1. **Join.** The host opens the site and either uses the screen as a shared board (TV or laptop) or hosts and plays from their own device. Players join on their phones with the 4-letter room code and a name.
2. **Question.** Everyone reads the question and scenario, with no chart and no timer yet. The host taps **Start drawing** when the group is ready.
3. **Draw (30, 45 or 60 s; host's choice).** The chart appears on every screen and the timer starts. Each player draws on their own private pad, then taps **Lock in**. The round ends when everyone has locked in or time runs out. An unlocked drawing is still scored as it stands.
   - **Line graph / trend line:** draw freehand from left to right.
   - **Distribution:** draw the shape. Only the shape is judged, not how tall you draw it.
   - **Bar chart:** tap or drag in each column to set a bar's height.
   - **Guess the percent:** drag around a ring to set a single percentage.
   - **Interaction:** both real lines are already drawn, unlabeled. Tap the line for the first variable; the other line gets the second (use **Swap** to flip them).
4. **Reveal.** The real data is drawn over everyone's sketches. Each player's score card starts at **100**, shows **Error = −N** in red, and counts down to the round score.
5. **Win.** The game lasts 5, 8 or 12 rounds. The highest total wins, and ties go to the lower total error.

### Scoring

```
round score = 100 − error
error       = round(100 × RMSE(drawing, real data) / chart height), capped at 100
```

- **Line and trend:** both curves are compared at 80 evenly spaced points across the data's x-range. Lifting your finger is fine: gaps are bridged and overlapping strokes are averaged.
- **Distribution:** both curves are rescaled to the same area before comparing, and the error is measured relative to the true peak.
- **Bar:** each bar is compared directly. Unset bars count as zero. Bar charts have at most 4 bars.
- **Guess the percent:** the error is how far off you were in percentage points (guess 50 when the answer is 65: Error −15, score 85).
- **Interaction:** a labeling task, so it's all or nothing. Matching the lines correctly is Error −0 (score 100), and flipping them is Error −100 (score 0). The lines are shuffled every round, so their position gives nothing away.
- **Blank drawing:** scores 0.

## Running it

```bash
cd see-figure-x
npm install
npm start          # http://localhost:3000  (set PORT to change)
npm test
```

Players need to reach the server from their phones. On the same Wi-Fi, use the computer's local IP (e.g. `http://192.168.1.20:3000`). Otherwise deploy it to a Node host that supports WebSockets (not serverless hosts like Vercel, which can't keep the game's live connections or in-memory rooms). Rooms live in memory, so restarting the server ends any games in progress.

### Deploying to Render

The repo includes a [`render.yaml`](../render.yaml) Blueprint:

1. Sign in at [render.com](https://render.com) with GitHub.
2. Choose **New → Blueprint**, select this repository, and pick the branch to deploy.
3. Click **Apply**. The first build takes a few minutes; you get a link like `https://see-figure-x.onrender.com`.

Every push to that branch redeploys automatically. On the free plan the server sleeps after about 15 minutes without visitors and takes about a minute to wake, so open the link shortly before playing. To hide the practice page (which shows all answers), change `PREVIEW` to `off` in the service's **Environment** settings.

## Demo video

`/demo` plays a scripted 30-second round (title, question, drawing, reveal, a percent round, end card) in a square 1080×1080 frame, made for screen recording or social posts. Add `?link=your text` to change the end card's last line, and `?loop=0` to play it once.

To render it straight to an MP4 (needs Playwright with Chromium, and ffmpeg):

```bash
node scripts/record-demo.js see-figure-x-demo.mp4 --link="Play at see-figure-x.onrender.com"
```

## Adding or fixing prompts

All prompts are in [`data/prompts.json`](data/prompts.json) and are validated when the server starts and in the tests. Each one has `id`, `type`, `title`, `prompt`, `xLabel`, `yLabel`, `source`, `takeaway`, an optional `note`, and the answer:

| type | answer fields |
|---|---|
| `line`, `trend` | `x`, `y` axis ranges; `points`: `[[x, y], …]` sorted by x |
| `distribution` | `x` range; `dist`: `mixture` (normal components), `splitNormal`, `exGaussian` or `logNormal` |
| `bar` | `y` range; up to 4 `categories`; `values` |
| `percent` | `value` (0–100); `yLabel` is the caption under the dial (no `xLabel` or axes) |
| `interaction` | `y` range; up to 4 `categories`; exactly two `series`: `{ name, values }` (shown unlabeled; players match names to lines) |

### Testing figures without a game

Open **`/preview`** (or tap "Practice on your own" on the home screen). Pick any figure from the list, draw it, and tap **Reveal** to see the real data and your score. Tap **Show answer** with an empty pad to see the answer without drawing. No room or other players are needed.

The preview re-reads `data/prompts.json` each time you tap "reload the figures" or refresh the page, so you can edit an entry and check it right away without restarting the server. Malformed entries are listed at the top of the page with the reason (e.g. `points must be sorted by x`) instead of breaking anything. Links like `/preview#milgram` open a specific figure.

To get a single file you can open anywhere without the server (on a phone, or to share), run `node scripts/build-standalone.js`. It bundles the preview page and every figure into `dist/see-figure-x-preview.html`.

The preview shows every answer, so set `PREVIEW=off` when running a public server where players could open it.

To run a real game with only specific prompts, start with `GB_ONLY=milgram,old-faithful npm start`; only those prompts are used, in that order.

**About the data.** Several prompts use values read off published figures or fitted to published summary statistics. Each prompt's `note` says which (e.g. "Approximate, digitized from…"). Check them against the original sources before relying on them for teaching.

## Layout

```
server.js           HTTP + WebSocket server, rooms, phases, timers, scoring
shared/scoring.js   curve math and scoring (used by both server and browser)
data/prompts.json   the prompt bank with citations
public/             client: index.html + app.js (game), preview.html + preview.js (practice),
                    chart.js (canvas + drawing pad), ui.js (score animation), style.css
test/               scoring unit tests + a full multiplayer game over WebSockets
```
