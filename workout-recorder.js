// Workout Recorder - Records workout data and exports to TCX/FIT formats
class WorkoutRecorder {
    constructor() {
        this.isRecording = false;
        this.dataPoints = [];
        this.startTime = null;
        this.workoutName = null;
        this.workoutType = 'Bike'; // Default activity type
    }

    start(workoutName = 'Indoor Cycling') {
        this.isRecording = true;
        this.dataPoints = [];
        this.startTime = new Date();
        this.workoutName = workoutName;
        console.log('Recording started:', workoutName);
    }

    recordDataPoint(power, heartRate, cadence) {
        if (!this.isRecording) return;

        const timestamp = new Date();
        const elapsedSeconds = (timestamp - this.startTime) / 1000;

        this.dataPoints.push({
            timestamp,
            elapsedSeconds,
            power: Math.max(0, power || 0),
            heartRate: heartRate || 0,
            cadence: cadence || 0
        });
    }

    stop() {
        this.isRecording = false;
        const duration = this.dataPoints.length > 0
            ? this.dataPoints[this.dataPoints.length - 1].elapsedSeconds
            : 0;
        console.log(`Recording stopped. Duration: ${Math.round(duration)}s, Data points: ${this.dataPoints.length}`);
        return this.dataPoints.length;
    }

    clear() {
        this.dataPoints = [];
        this.startTime = null;
        this.isRecording = false;
    }

    // Calculate summary statistics
    getStats() {
        if (this.dataPoints.length === 0) {
            return {
                duration: 0,
                avgPower: 0,
                maxPower: 0,
                avgHeartRate: 0,
                maxHeartRate: 0,
                avgCadence: 0,
                totalWork: 0
            };
        }

        const powers = this.dataPoints.map(p => p.power).filter(p => p > 0);
        const heartRates = this.dataPoints.map(p => p.heartRate).filter(hr => hr > 0);
        const cadences = this.dataPoints.map(p => p.cadence).filter(c => c > 0);

        const avgPower = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;
        const maxPower = powers.length > 0 ? Math.max(...powers) : 0;
        const avgHeartRate = heartRates.length > 0 ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : 0;
        const maxHeartRate = heartRates.length > 0 ? Math.max(...heartRates) : 0;
        const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

        const duration = this.dataPoints[this.dataPoints.length - 1].elapsedSeconds;
        const totalWork = avgPower * duration; // kilojoules

        return {
            duration: Math.round(duration),
            avgPower: Math.round(avgPower),
            maxPower: Math.round(maxPower),
            avgHeartRate: Math.round(avgHeartRate),
            maxHeartRate: Math.round(maxHeartRate),
            avgCadence: Math.round(avgCadence),
            totalWork: Math.round(totalWork / 1000) // kJ
        };
    }

    // Export to TCX format (Training Center XML)
    // Compatible with: Strava, Garmin Connect, TrainingPeaks, etc.
    exportTCX() {
        if (this.dataPoints.length === 0) {
            throw new Error('No data to export');
        }

        const stats = this.getStats();
        const startTime = this.startTime.toISOString();

        let tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${stats.duration}</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
`;

        // Add trackpoints
        this.dataPoints.forEach((point, index) => {
            // Sample every 1 second or every point if less frequent
            if (index === 0 || point.elapsedSeconds - this.dataPoints[index - 1].elapsedSeconds >= 0.9) {
                tcx += `          <Trackpoint>
            <Time>${point.timestamp.toISOString()}</Time>
            <Cadence>${point.cadence}</Cadence>
`;

                if (point.heartRate > 0) {
                    tcx += `            <HeartRateBpm>
              <Value>${point.heartRate}</Value>
            </HeartRateBpm>
`;
                }

                if (point.power > 0) {
                    tcx += `            <Extensions>
              <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
                <Watts>${point.power}</Watts>
              </TPX>
            </Extensions>
`;
                }

                tcx += `          </Trackpoint>
`;
            }
        });

        tcx += `        </Track>
        <Extensions>
          <LX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
            <AvgWatts>${stats.avgPower}</AvgWatts>
            <MaxWatts>${stats.maxPower}</MaxWatts>
          </LX>
        </Extensions>
      </Lap>
      <Notes>${this.workoutName}</Notes>
    </Activity>
  </Activities>
  <Author xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Application_t">
    <Name>Smart Trainer Controller</Name>
    <Build>
      <Version>
        <VersionMajor>1</VersionMajor>
        <VersionMinor>0</VersionMinor>
      </Version>
    </Build>
    <LangID>en</LangID>
    <PartNumber>000-00000-00</PartNumber>
  </Author>
</TrainingCenterDatabase>`;

        return tcx;
    }

    // Download TCX file
    downloadTCX() {
        try {
            const tcx = this.exportTCX();
            const blob = new Blob([tcx], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);

            const filename = `workout_${this.startTime.toISOString().replace(/[:.]/g, '-').split('T')[0]}_${Date.now()}.tcx`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();

            URL.revokeObjectURL(url);

            return filename;
        } catch (err) {
            console.error('Failed to download TCX:', err);
            throw err;
        }
    }

    // Export to JSON format (for backup/import)
    exportJSON() {
        const stats = this.getStats();

        return JSON.stringify({
            workoutName: this.workoutName,
            startTime: this.startTime.toISOString(),
            duration: stats.duration,
            stats,
            dataPoints: this.dataPoints.map(p => ({
                timestamp: p.timestamp.toISOString(),
                elapsed: Math.round(p.elapsedSeconds),
                power: p.power,
                heartRate: p.heartRate,
                cadence: p.cadence
            }))
        }, null, 2);
    }

    // Download JSON file
    downloadJSON() {
        try {
            const json = this.exportJSON();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const filename = `workout_${this.startTime.toISOString().replace(/[:.]/g, '-').split('T')[0]}_${Date.now()}.json`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();

            URL.revokeObjectURL(url);

            return filename;
        } catch (err) {
            console.error('Failed to download JSON:', err);
            throw err;
        }
    }

    // Format duration for display
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}
