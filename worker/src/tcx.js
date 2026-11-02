// TCX export. Same structure as WorkoutRecorder.exportTCX() in the frontend (workout-recorder.js).

function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** ride: summary object (see rides.js rowToSummary); samples: [[t, power, hr, cadence], ...] */
export function buildTcx(ride, samples) {
    const startMs = new Date(ride.startedAt).getTime();
    const startTime = new Date(startMs).toISOString();

    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${ride.durationS}</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
`);

    for (const [t, power, hr, cadence] of samples) {
        out.push(`          <Trackpoint>
            <Time>${new Date(startMs + t * 1000).toISOString()}</Time>
            <Cadence>${cadence}</Cadence>
`);
        if (hr > 0) {
            out.push(`            <HeartRateBpm>
              <Value>${hr}</Value>
            </HeartRateBpm>
`);
        }
        if (power > 0) {
            out.push(`            <Extensions>
              <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
                <Watts>${power}</Watts>
              </TPX>
            </Extensions>
`);
        }
        out.push(`          </Trackpoint>
`);
    }

    out.push(`        </Track>
        <Extensions>
          <LX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
            <AvgWatts>${ride.avgPower}</AvgWatts>
            <MaxWatts>${ride.maxPower}</MaxWatts>
          </LX>
        </Extensions>
      </Lap>
      <Notes>${xmlEscape(ride.workoutName)}</Notes>
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
</TrainingCenterDatabase>`);
    return out.join('');
}

export function tcxFilename(startedAt) {
    return `cadence-${new Date(startedAt).toISOString().slice(0, 10)}.tcx`;
}
