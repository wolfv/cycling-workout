# Cadence (RPM) Display Implementation

## Overview
Your Zwift Hub with Cog broadcasts cadence data via the Cycling Power Service. The cadence is calculated from crank revolution data embedded in the power measurement characteristic.

## How It Works

### 1. Data Source
- **Service**: Cycling Power Service (0x1818)
- **Characteristic**: Cycling Power Measurement (0x2A63)
- **Flag Bit 5 (0x20)**: Indicates Crank Revolution Data is present

### 2. Data Format
```
Bytes 0-1: Flags (uint16)
Bytes 2-3: Instantaneous Power (sint16)
[If flag bit 5 set:]
Bytes 4-5: Cumulative Crank Revolutions (uint16)
Bytes 6-7: Last Crank Event Time (uint16) in 1/1024 seconds
```

### 3. Cadence Calculation
```javascript
// Calculate deltas between consecutive measurements
revDelta = currentRevs - lastRevs
timeDelta = (currentTime - lastTime) / 1024.0  // Convert to seconds

// RPM = (revolutions / seconds) * 60
cadence = (revDelta / timeDelta) * 60
```

### 4. Your Setup
- **Zwift Cog**: Virtual shifting system
- **Chain Position**: Large front gear
- **Data**: Hub measures actual crank rotations
- **No gear calculation needed**: The hub directly measures crank RPM, not wheel speed

## Display
The cadence is now shown in the metrics grid:
- **Power** | **Heart Rate** | **Cadence** | **Target** | **Status**
- Updates in real-time as you pedal
- Shows 0 when not pedaling or no data

## Notes
- The Zwift Hub measures **crank cadence**, not wheel/cassette speed
- Works independently of the Cog's virtual gear selection
- The large front chainring doesn't affect the measurement
- No ANT+ sensor needed - built into the hub!

## Troubleshooting
If cadence shows 0:
1. Make sure you're pedaling
2. Check that the hub is properly connected
3. The first few rotations may not show data (needs delta calculation)
4. Verify in browser console for any parse errors

## Technical Details
- **Resolution**: 1 RPM
- **Update Rate**: Same as power (typically 1-4 Hz)
- **Range**: 0-255 RPM (more than enough for cycling!)
- **Accuracy**: Very high - direct crank measurement
