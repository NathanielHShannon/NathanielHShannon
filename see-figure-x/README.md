# See Figure X

A real-time party game for 2–8 players. Each round shows a prompt about a real scientific finding and a chart with labeled axes. Everyone sketches what they *think* the data looks like on their own phone. Then the real data is revealed on top of everyone's drawings, along with the citation. The fun is in arguing about why your expectations were so far off.

## Rules

1. **Join.** The host opens the site and either uses the screen as a shared board (TV or laptop) or hosts and plays from their own device. Players join on their phones with the 4-letter room code and a name.
2. **Prompt (8 s).** Everyone sees the question and the empty, labeled axes.
3. **Draw (30, 45 or 60 s; host's choice).** Each player draws on their own private pad, then taps **Lock in**. The round ends when everyone has locked in or time runs out. An unlocked drawing is still scored as it stands.
   - **Line graph / trend line:** draw freehand from left to right.
   - **Distribution:** draw the shape. Only the shape is judged, not how tall you draw it.
   - **Bar chart:** tap or drag in each column to set a bar's height.
   - **Interaction:** choose one of two lines, then tap each column to place its point.
4. **Reveal.** The real data is drawn over everyone's sketches. Each player's score card starts at **100**, shows **Error = −N** in red, and counts down to the round score.
5. **Win.** The game lasts 5, 8 or 12 rounds. The highest total wins, and ties go to the lower total error.

### Scoring

```
round score = 100 − error
error       = round(100 × RMSE(drawing, real data) / chart height), capped at 100
```

- **Line and trend:** both curves are compared at 80 evenly spaced points across the data's x-range. Lifting your finger is fine: gaps are bridged and overlapping strokes are averaged.
- **Distribution:** both curves are rescaled to the same area before comparing, and the error is measured relative to the true peak.
- **Bar and interaction:** each bar or point is compared directly. Unset bars or points count as zero.
- **Blank drawing:** scores 0.

## Running it

```bash
cd see-figure-x
npm install
npm start          # http://localhost:3000  (set PORT to change)
npm test
```

Players need to reach the server from their phones. On the same Wi-Fi, use the computer's local IP (e.g. `http://192.168.1.20:3000`). Otherwise deploy it to any Node host that supports WebSockets (Render, Railway, Fly.io, etc.). Rooms live in memory, so restarting the server ends any games in progress.

## Adding or fixing prompts

All prompts are in [`data/prompts.json`](data/prompts.json) and are validated when the server starts and in the tests. Each one has `id`, `type`, `title`, `prompt`, `xLabel`, `yLabel`, `source`, `takeaway`, an optional `note`, and the answer:

| type | answer fields |
|---|---|
| `line`, `trend` | `x`, `y` axis ranges; `points`: `[[x, y], …]` sorted by x |
| `distribution` | `x` range; `dist`: `mixture` (normal components), `splitNormal`, `exGaussian` or `logNormal` |
| `bar` | `y` range; `categories`; `values` |
| `interaction` | `y` range; `categories`; exactly two `series`: `{ name, values }` |

### Testing figures without a game

Open **`/preview`** (or tap "Practice on your own" on the home screen). Pick any figure from the list, draw it, and tap **Reveal** to see the real data and your score. Tap **Show answer** with an empty pad to see the answer without drawing. No room or other players are needed.

The preview re-reads `data/prompts.json` each time you tap "reload the figures" or refresh the page, so you can edit an entry and check it right away without restarting the server. Malformed entries are listed at the top of the page with the reason (e.g. `points must be sorted by x`) instead of breaking anything. Links like `/preview#milgram` open a specific figure.

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
