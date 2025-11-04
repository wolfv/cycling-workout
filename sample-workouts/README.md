# Workout File Format

This directory contains sample workout files in JSON format that can be imported into the Zwift Hub Controller.

## Workout Structure

Each workout file is a JSON file with the following structure:

```json
{
  "name": "Workout Name",
  "description": "Optional description of the workout",
  "ftp": 200,
  "intervals": [...],
  "created": "2025-10-28T12:00:00.000Z",
  "version": "1.0"
}
```

### Fields

- **name** (string, required): The name of the workout
- **description** (string, optional): A description of what the workout is for
- **ftp** (number, optional): Default FTP value for the workout
- **intervals** (array, required): Array of interval objects
- **created** (string, optional): ISO 8601 timestamp of when the workout was created
- **version** (string, optional): Workout format version

## Interval Structure

Each interval in the `intervals` array can use **relative power** (% of FTP), **absolute power** (fixed watts), or **ramp** (gradually increasing power).

### Relative Power Interval

Relative power intervals scale with your FTP setting:

```json
{
  "name": "Threshold",
  "type": "threshold",
  "duration": 300,
  "powerType": "relative",
  "percentage": 100
}
```

**Fields:**
- **name** (string, required): Display name for the interval
- **type** (string, required): Type of interval - affects color in UI
  - `warmup`, `endurance`, `tempo`, `threshold`, `vo2max`, `cooldown`, `custom`
- **duration** (number, required): Duration in seconds
- **powerType** (string): Set to `"relative"` (or omit, as it's the default)
- **percentage** (number, required): Target power as percentage of FTP (10-200)

### Absolute Power Interval

Absolute power intervals use fixed wattage regardless of FTP:

```json
{
  "name": "Ramp Step 5",
  "type": "threshold",
  "duration": 60,
  "powerType": "absolute",
  "power": 180
}
```

**Fields:**
- **name** (string, required): Display name for the interval
- **type** (string, required): Type of interval
- **duration** (number, required): Duration in seconds
- **powerType** (string, required): Set to `"absolute"`
- **power** (number, required): Target power in watts (10-1000)

### Ramp Interval

Ramp intervals gradually increase power from a low to high percentage over the duration:

```json
{
  "name": "Progressive Ramp",
  "type": "tempo",
  "duration": 600,
  "powerType": "ramp",
  "percentageLow": 50,
  "percentageHigh": 80
}
```

**Fields:**
- **name** (string, required): Display name for the interval
- **type** (string, required): Type of interval
- **duration** (number, required): Duration in seconds
- **powerType** (string, required): Set to `"ramp"`
- **percentageLow** (number, required): Starting power as percentage of FTP (10-200)
- **percentageHigh** (number, required): Ending power as percentage of FTP (10-200)

**How it works:**
- Power increases linearly from `percentageLow` to `percentageHigh` over the interval duration
- The trainer updates target power every second for a smooth progression
- Perfect for gradual warmups or progressive overload intervals

## Use Cases

### When to Use Relative Power

Use relative power (% of FTP) for:
- Traditional training workouts
- Structured intervals where intensity should scale with fitness
- Workouts shared between athletes with different FTP levels

### When to Use Absolute Power

Use absolute power (watts) for:
- **Stepwise ramp tests** - Discrete power steps to determine FTP
- **Beginner workouts** - Fixed power for learning bike handling
- **Recovery rides** - Specific low power targets
- **Calibration tests** - Testing trainer accuracy at specific watts

### When to Use Ramp Intervals

Use ramp intervals (gradual power increase) for:
- **Smooth ramp tests** - Progressive power increase without sudden jumps
- **Extended warmups** - Gradually building from easy to moderate intensity
- **Build intervals** - Progressively harder efforts within a single interval
- **Cooldowns** - Gradually reducing power from workout to recovery pace

## Example Workouts

### 1. Ramp Test (`ramp-test-ftp.json`)

A progressive FTP test using absolute power that increases by 20W every minute. This is perfect for determining your current FTP.

### 2. Sweet Spot Intervals (`sweet-spot-intervals.json`)

Classic 4x10 minute sweet spot intervals at 90% FTP with recovery periods. Uses relative power so it scales with your FTP.

### 3. Ramp Test Workout (`ramp-workout.json`)

Progressive ramp intervals that smoothly increase power over time. Features various ramp types from warmup through VO2 max intensities.

## Creating Your Own Workouts

### JSON Format

1. Create a new JSON file
2. Follow the structure above
3. Add intervals with either relative or absolute power
4. Import the file using the "Import JSON" button in the Workout Designer

### ZWO Format (Zwift Native)

You can also import and export workouts in Zwift's native `.zwo` format:

1. **Import ZWO**: Click "Import ZWO" button and select a `.zwo` file from Zwift or other workout editors
2. **Export ZWO**: Click "Export ZWO" to save your workout in Zwift-compatible format
3. **External Editors**: Create workouts using tools like [zwiftworkout.com](https://www.zwiftworkout.com/) and import them directly

The app automatically converts between formats, supporting:
- `<SteadyState>` - Constant power intervals
- `<Warmup>` - Gradual power ramps (warmup)
- `<Cooldown>` - Gradual power ramps (cooldown)
- `<Ramp>` - Progressive power increases
- `<IntervalsT>` - Repeating on/off intervals (expanded automatically)

## Tips

- Start with a warmup interval at 50-60% FTP for 10-15 minutes
- End with a cooldown interval at 40-50% FTP for 10 minutes
- Recovery intervals should be 50-60% FTP
- Sweet spot is 88-94% FTP
- Threshold is 95-105% FTP
- VO2 Max is 106-120% FTP
- For ramp tests, increment by 15-25W per minute
