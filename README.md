# Smart Trainer Controller

A professional, dark-themed dashboard for controlling smart trainers using the FTMS (Fitness Machine Service) protocol via Web Bluetooth. Supports Zwift Hub, Wahoo KICKR, Tacx NEO, Elite, and many more!

🌐 **[Try it live!](https://wolfv.github.io/cycling-workout/)** (Replace with your GitHub Pages URL after deployment)

[![Deploy to GitHub Pages](https://wolfv.github.io/cycling-workout/actions/workflows/deploy.yml/badge.svg)](https://wolfv.github.io/cycling-workout/actions/workflows/deploy.yml)

## Features

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
- **Real-time metrics** - view power, cadence, and FTP for all riders
- **Synchronized start** - countdown ensures everyone starts together

## Supported Devices

This app works with **any smart trainer that supports FTMS (Fitness Machine Service)** via Bluetooth. Tested and confirmed with Zwift Hub and Wahoo Kickr.

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

## License

MIT

## Credits

Built with vanilla JavaScript, Lucide icons, and the Web Bluetooth API.
