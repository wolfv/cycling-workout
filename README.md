# Smart Trainer Controller

A professional, dark-themed dashboard for controlling smart trainers using the FTMS (Fitness Machine Service) protocol via Web Bluetooth. Supports Zwift Hub, Wahoo KICKR, Tacx NEO, Elite, and many more!

🌐 **[Try it live!](https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/)** (Replace with your GitHub Pages URL after deployment)

[![Deploy to GitHub Pages](https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/actions/workflows/deploy.yml)

## Features

### 🎨 Professional Dashboard Design
- **Dark theme** with minimal, shadcn-inspired design
- **Single-page layout** with main content and sidebar
- **Lucide icons** for a modern, professional look
- **Fully responsive** layout

### 📊 Real-time Monitoring
- Live power, heart rate, and **cadence (RPM)** display
- Real-time chart with power, heart rate, and target power
- 2-minute rolling window
- Color-coded metrics
- Cadence calculated from crank revolution data

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
- **Click to edit** intensity percentage and duration
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
- **Live race track** - see everyone's position on the workout timeline
- **Real-time metrics** - view power, cadence, and FTP for all riders
- **Session persistence** - survives page refreshes
- **Google Meet integration** - video chat while riding
- **Synchronized start** - countdown ensures everyone starts together

## Supported Devices

This app works with **any smart trainer that supports FTMS (Fitness Machine Service)** via Bluetooth. Tested and confirmed with:

### ✅ Zwift
- Zwift Hub
- Zwift Hub One

### ✅ Wahoo
- KICKR (all generations)
- KICKR CORE
- KICKR SNAP
- KICKR BIKE

### ✅ Tacx
- Tacx NEO (Smart, 2T, 2T Plus, 3M)
- Tacx Flux (S, 2)
- Tacx Genius
- Other Tacx FTMS trainers

### ✅ Elite
- Elite DRIVO (I, II)
- Elite DIRETO (X, XR, XR-T)
- Elite SUITO (T)
- Elite JUSTO
- Other Elite FTMS trainers

### ✅ Saris
- Saris H3
- Saris H2 (with FTMS firmware)
- Saris M2

### ✅ Other Brands
- JetBlack VOLT
- Kinetic ROCK AND ROLL
- Bkool trainers
- Wattbike Atom

**Note:** Your trainer must support FTMS protocol. Most modern smart trainers (2017+) support this standard.

## Getting Started

### Option 1: Use GitHub Pages (Recommended)
The app is automatically deployed to GitHub Pages via GitHub Actions.

### Option 2: Local Development
1. Open `index.html` in a modern browser (Chrome, Edge, or Opera)
2. Ensure you're using HTTPS or localhost (Web Bluetooth requirement)
3. Click **Connect** to pair with your smart trainer
4. Set your FTP in the workout designer
5. Start designing and riding!

### Browser Requirements
- **Chrome 56+**, **Edge 79+**, or **Opera 43+**
- Web Bluetooth API support
- **HTTPS or localhost** (Web Bluetooth security requirement)

## Deployment

### Deploy to GitHub Pages

1. **Create a new GitHub repository**
2. **Push your code:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Zwift Hub Controller"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
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
   - Once complete, your site will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

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
3. Click an interval to edit intensity % and duration

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
- `style.css` - Dark theme styling
- `ftms.js` - FTMS protocol handler
- `chart.js` - Real-time canvas chart
- `workout-designer.js` - Workout builder with FTP scaling
- `app.js` - Main application logic

### Browser Requirements
- Chrome 56+, Edge 79+, or Opera 43+
- Web Bluetooth API support
- HTTPS or localhost

### FTMS Protocol
- Uses Fitness Machine Service (UUID: 0x1826)
- Control Point characteristic (UUID: 0x2AD9)
- Direct power target commands
- No DirCon wrapper needed

## Color Scheme

- Background: `#0a0a0a`, `#18181b`, `#27272a`
- Borders: `#3f3f46`, `#52525b`
- Text: `#fafafa`, `#a1a1aa`, `#71717a`
- Accent: `#3b82f6` (blue)
- Success: `#22c55e` (green)
- Danger: `#ef4444` (red)
- Warning: `#f59e0b` (amber)

## Interval Color Coding

- **Warmup**: Amber accent
- **Endurance**: Blue accent
- **Tempo**: Green accent
- **Threshold**: Red accent
- **VO2 Max**: Purple accent
- **Cooldown**: Indigo accent

## License

MIT

## Credits

Built with vanilla JavaScript, Lucide icons, and the Web Bluetooth API.
