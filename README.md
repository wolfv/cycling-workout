# Cadence — Indoor Cycling

A browser-based training dashboard for FTMS smart trainers, including Zwift Hub, Wahoo KICKR, Tacx NEO, and Elite. Build workouts, control resistance, and ride with friends without a subscription.

🌐 **[Try it live!](https://wolfv.github.io/cycling-workout/)**

[![Deploy to GitHub Pages](https://wolfv.github.io/cycling-workout/actions/workflows/deploy.yml/badge.svg)](https://wolfv.github.io/cycling-workout/actions/workflows/deploy.yml)

## Features

### 📊 Real-time Monitoring
- Live power, heart rate, and **cadence (RPM)** display
- Real-time chart with power, heart rate, and target power
- 2-minute rolling window
- Color-coded metrics
- Correct FTMS half-RPM decoding, with CSC and Cycling Power crank data as fallbacks
- One active cadence source at a time; stale readings clear after three seconds
- Large ride metrics, mobile navigation, and keyboard-accessible device and interval dialogs

### 🎯 FTP-Based Workout Designer
- **Percentage-based intervals** - all workouts scale with your FTP
- **Six workout types**:
  - Warmup (50% FTP)
  - Endurance (65% FTP)
  - Tempo (85% FTP)
  - Threshold (100% FTP)
  - VO2 Max (120% FTP)
  - Cooldown (40% FTP)
- **Drag and drop** to reorder intervals
- **Select to edit** duration, relative power, absolute watts, and ramp endpoints in a dialog
- **Visual timeline** with color-coded intervals
- **Automatic execution** - trainer adjusts power automatically

### 💾 Workout Management
- **Save** workouts to localStorage with custom names
- **Load** saved workouts from browser storage
- **Export** workouts as JSON files
- **Import** workouts from JSON files
- Share workouts with friends!

### ⚡ Quick Controls
- Manual power target slider
- Instant power adjustment
- Connection management

### 👥 Collaborative Sessions
- **Ride with friends** in real-time using peer-to-peer connections
- **Workout sharing** - host sends workout to all participants
- **Individual FTP scaling** - everyone rides at their own intensity
- **Real-time metrics** - view power, cadence, and FTP for all riders
- **Synchronized start** - countdown ensures everyone starts together

## Supported Devices

This app works with **any smart trainer that supports FTMS (Fitness Machine Service)** via Bluetooth. Tested and confirmed with Zwift Hub and Wahoo Kickr.

**Note:** Your trainer must support FTMS protocol. Most modern smart trainers (2017+) support this standard.

## Getting Started

### Option 1: Use GitHub Pages (Recommended)
The app is automatically deployed to GitHub Pages via GitHub Actions.

### Option 2: Local Development
1. Run `python3 -m http.server 8000` from this directory.
2. Open `http://localhost:8000` in Chrome, Edge, or Opera (Web Bluetooth requires HTTPS or localhost).
3. Click **Connect** to pair with your smart trainer
4. Set your FTP in the workout designer
5. Start designing and riding!

### Browser Requirements
- Current Chrome, Edge, or Opera on a platform with Web Bluetooth
- Web Bluetooth API support
- **HTTPS or localhost** (Web Bluetooth security requirement)

## Reliability and Testing

- Unexpected trainer disconnects trigger up to five reconnect attempts with increasing delays. An active workout keeps its original clock and restores the current interval's target after reconnecting. Without an active workout, reconnecting sets the target to zero.
- FTMS commands wait for both the Bluetooth write and the trainer's response. Stale queued power targets are discarded; a five-second timeout disconnects and retries the connection.
- Group starts use a round-trip clock-offset estimate and one shared start timestamp. Late joins and delayed browser timers catch up to the current interval instead of extending the workout.
- Signaling connections retry up to five times. The host also recreates closed peer connections. Leaving a session cancels retries and pending countdowns.

Run the dependency-free regression suite with Node.js 22 or newer:

```sh
node --test tests/*.test.cjs
```

The deployment workflow runs these tests before publishing. Tests use simulated Bluetooth devices, peer connections, clocks, and DOM elements; they do not replace a real trainer and multi-browser ride test.

### Browser checks (optional)

The browser smoke test exercises editing, saving/loading, starting/stopping rides, summaries, dialogs, and layouts from 320 to 1440 pixels. It also runs axe accessibility checks. With the local server running on port 8000:

```sh
npm install --prefix /tmp/cadence-browser-tools playwright @axe-core/playwright
/tmp/cadence-browser-tools/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/cadence-browser-tools/node_modules node tests/browser-smoke.cjs
```

Set `APP_URL` for a different server address, or `CHROME_PATH` to use an existing Chrome executable. Browser-test dependencies stay outside the application. Screenshots are written to `/tmp/cadence-*.png`.

**Limits:** Keep the ride tab visible and prevent the computer from sleeping. A suspended browser cannot update trainer resistance until it resumes; the trainer may retain its last target during an outage. WebRTC currently uses STUN only, so some restrictive networks need a TURN relay that is not configured here. Automatic recovery covers the trainer, not a separate heart-rate monitor. Reconnect does not prevent all radio or network failures.

## Deployment

### Deploy to GitHub Pages

1. **Create a new GitHub repository**
2. **Push your code:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Zwift Hub Controller"
   git branch -M main
   git remote add origin https://github.com/wolfv/cycling-workout
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - Go to your repository settings
   - Navigate to **Pages** (left sidebar)
   - Under "Build and deployment":
     - Source: **GitHub Actions**

4. **Wait for deployment:**
   - The GitHub Action will automatically run
   - Check the **Actions** tab to see deployment progress
   - Once complete, your site will be live at: `https://wolfv.github.io/cycling-workout`

5. **Update the README** with your actual URL

## Workout Designer Usage

### Setting Your FTP
1. Enter your FTP (Functional Threshold Power) in the input field at the top of the Workout Designer
2. All intervals will automatically scale based on this value

### Creating a Workout
1. Click interval buttons to add segments:
   - **Warmup** - Easy spinning
   - **Endurance** - Long steady efforts
   - **Tempo** - Moderate intensity
   - **Threshold** - At FTP
   - **VO2 Max** - High intensity intervals
   - **Cooldown** - Easy recovery
2. Drag intervals to reorder them
3. Select an interval to edit its name, duration, and power type. Ramps have separate starting and ending percentages.

### Running a Workout
1. Click **Start Workout**
2. Your trainer will automatically adjust resistance
3. The timeline highlights the current interval
4. Click **Stop Workout** to end early

### Saving & Loading
- **Save**: Stores workout in browser (persists across sessions)
- **Load**: Browse and load saved workouts
- **Export**: Download workout as JSON file
- **Import**: Load JSON workout files

## Workout JSON Format

```json
{
  "name": "My Workout",
  "ftp": 200,
  "intervals": [
    {
      "type": "warmup",
      "name": "Warmup",
      "percentage": 50,
      "duration": 300
    },
    {
      "type": "threshold",
      "name": "Threshold",
      "percentage": 100,
      "duration": 600
    }
  ],
  "created": "2025-10-26T10:00:00.000Z"
}
```

## Technical Details

### Files
- `index.html` - Main HTML structure
- `style.css` - Responsive dashboard, navigation, and dialog styling
- `ftms.js` - FTMS protocol handler
- `chart.js` - Real-time canvas chart
- `workout-designer.js` - Workout builder with FTP scaling
- `app.js` - Main application logic

### Browser Requirements
- Current Chrome, Edge, or Opera on a platform with Web Bluetooth
- Web Bluetooth API support
- HTTPS or localhost

### FTMS Protocol
- Uses Fitness Machine Service (UUID: 0x1826)
- Control Point characteristic (UUID: 0x2AD9)
- Direct power target commands
- No DirCon wrapper needed

## License

MIT

## Credits

Built with vanilla JavaScript, Alpine.js, Basecoat CSS, Lucide icons, and the Web Bluetooth API.
