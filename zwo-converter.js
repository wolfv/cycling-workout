// ZWO (Zwift Workout) File Converter
// Converts between Zwift's .zwo XML format and our JSON workout format

class ZwoConverter {
    // Convert our JSON workout to ZWO XML format
    static toZwo(workout) {
        const name = workout.name || 'Custom Workout';
        const description = workout.description || '';
        const ftp = workout.ftp || 200;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
    <author>Zwift Hub Controller</author>
    <name>${this.escapeXml(name)}</name>
    <description>${this.escapeXml(description)}</description>
    <sportType>bike</sportType>
    <tags></tags>
    <workout>
`;

        // Convert each interval to ZWO format
        workout.intervals.forEach(interval => {
            xml += this.intervalToZwo(interval, ftp);
        });

        xml += `    </workout>
</workout_file>`;

        return xml;
    }

    // Convert a single interval to ZWO XML element
    static intervalToZwo(interval, ftp) {
        const duration = interval.duration;
        const powerType = interval.powerType || 'relative';

        // Convert power to FTP percentage (ZWO uses 0.0-2.0 range where 1.0 = 100% FTP)
        let powerLow, powerHigh, power;

        if (powerType === 'absolute') {
            // Convert watts to FTP percentage
            power = (interval.power / ftp).toFixed(8);
        } else if (powerType === 'ramp') {
            powerLow = (interval.percentageLow / 100).toFixed(8);
            powerHigh = (interval.percentageHigh / 100).toFixed(8);
        } else {
            // relative
            power = (interval.percentage / 100).toFixed(8);
        }

        const cadence = interval.cadence || '';
        const cadenceAttr = cadence ? ` Cadence="${cadence}"` : '';

        // Map interval types to ZWO elements
        switch (interval.type) {
            case 'warmup':
                if (powerType === 'ramp') {
                    return `        <Warmup Duration="${duration}" PowerLow="${powerLow}" PowerHigh="${powerHigh}"${cadenceAttr}/>\n`;
                } else {
                    // For non-ramp warmup, use a gentle ramp from 50% to target
                    const targetPower = power || '0.6';
                    return `        <Warmup Duration="${duration}" PowerLow="0.5" PowerHigh="${targetPower}"${cadenceAttr}/>\n`;
                }

            case 'cooldown':
                if (powerType === 'ramp') {
                    return `        <Cooldown Duration="${duration}" PowerLow="${powerLow}" PowerHigh="${powerHigh}"${cadenceAttr}/>\n`;
                } else {
                    // For non-ramp cooldown, use a gentle ramp down to 40%
                    const startPower = power || '0.6';
                    return `        <Cooldown Duration="${duration}" PowerLow="${startPower}" PowerHigh="0.4"${cadenceAttr}/>\n`;
                }

            default:
                // For all other types, use SteadyState or Ramp
                if (powerType === 'ramp') {
                    return `        <Ramp Duration="${duration}" PowerLow="${powerLow}" PowerHigh="${powerHigh}"${cadenceAttr}/>\n`;
                } else {
                    return `        <SteadyState Duration="${duration}" Power="${power}"${cadenceAttr}/>\n`;
                }
        }
    }

    // Parse ZWO XML to our JSON workout format
    static fromZwo(xmlString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error('Invalid XML: ' + parserError.textContent);
        }

        // Extract metadata
        const name = xmlDoc.querySelector('name')?.textContent || 'Imported Workout';
        const description = xmlDoc.querySelector('description')?.textContent || '';
        const author = xmlDoc.querySelector('author')?.textContent || '';

        // Parse intervals
        const intervals = [];
        const workoutElement = xmlDoc.querySelector('workout');

        if (!workoutElement) {
            throw new Error('No <workout> element found in ZWO file');
        }

        // Process each child element in the workout
        Array.from(workoutElement.children).forEach(element => {
            const interval = this.parseZwoInterval(element);
            if (interval) {
                intervals.push(interval);
            }
        });

        return {
            name,
            description: description + (author ? ` (by ${author})` : ''),
            ftp: 200, // ZWO files don't contain FTP, user will adjust in app
            intervals,
            created: new Date().toISOString(),
            version: '1.0'
        };
    }

    // Parse a single ZWO interval element
    static parseZwoInterval(element) {
        const tagName = element.tagName;
        const duration = parseInt(element.getAttribute('Duration')) || 0;

        if (duration === 0) return null;

        let interval = {
            name: element.getAttribute('Name') || this.getDefaultName(tagName),
            duration: duration
        };

        switch (tagName) {
            case 'SteadyState':
                interval.type = this.inferType(parseFloat(element.getAttribute('Power')));
                interval.powerType = 'relative';
                interval.percentage = Math.round(parseFloat(element.getAttribute('Power')) * 100);
                break;

            case 'Warmup':
                interval.type = 'warmup';
                interval.powerType = 'ramp';
                interval.percentageLow = Math.round(parseFloat(element.getAttribute('PowerLow')) * 100);
                interval.percentageHigh = Math.round(parseFloat(element.getAttribute('PowerHigh')) * 100);
                break;

            case 'Cooldown':
                interval.type = 'cooldown';
                interval.powerType = 'ramp';
                interval.percentageLow = Math.round(parseFloat(element.getAttribute('PowerLow')) * 100);
                interval.percentageHigh = Math.round(parseFloat(element.getAttribute('PowerHigh')) * 100);
                break;

            case 'Ramp':
                interval.type = 'tempo'; // Default to tempo, will be inferred from power
                interval.powerType = 'ramp';
                interval.percentageLow = Math.round(parseFloat(element.getAttribute('PowerLow')) * 100);
                interval.percentageHigh = Math.round(parseFloat(element.getAttribute('PowerHigh')) * 100);
                // Infer type from average power
                const avgPower = (interval.percentageLow + interval.percentageHigh) / 2;
                interval.type = this.inferType(avgPower / 100);
                break;

            case 'IntervalsT':
                // IntervalsT is a repeating interval set - expand it
                const repeat = parseInt(element.getAttribute('Repeat')) || 1;
                const onDuration = parseInt(element.getAttribute('OnDuration')) || 0;
                const offDuration = parseInt(element.getAttribute('OffDuration')) || 0;
                const onPower = parseFloat(element.getAttribute('OnPower')) || 1.0;
                const offPower = parseFloat(element.getAttribute('OffPower')) || 0.5;

                // Return array of intervals (will be flattened)
                const intervals = [];
                for (let i = 0; i < repeat; i++) {
                    intervals.push({
                        name: `Work ${i + 1}`,
                        type: this.inferType(onPower),
                        duration: onDuration,
                        powerType: 'relative',
                        percentage: Math.round(onPower * 100)
                    });
                    intervals.push({
                        name: `Recovery ${i + 1}`,
                        type: 'endurance',
                        duration: offDuration,
                        powerType: 'relative',
                        percentage: Math.round(offPower * 100)
                    });
                }
                return intervals; // Return multiple intervals

            case 'FreeRide':
                interval.type = 'endurance';
                interval.powerType = 'relative';
                interval.percentage = 65; // Default to moderate endurance
                break;

            case 'MaxEffort':
                interval.type = 'vo2max';
                interval.powerType = 'relative';
                interval.percentage = 150; // Max effort
                break;

            default:
                // Unknown interval type, skip it
                return null;
        }

        return interval;
    }

    // Infer interval type from power percentage (0.0-2.0 scale)
    static inferType(power) {
        if (power <= 0.6) return 'warmup';
        if (power <= 0.75) return 'endurance';
        if (power <= 0.87) return 'tempo';
        if (power <= 1.05) return 'threshold';
        return 'vo2max';
    }

    // Get default interval name based on ZWO tag
    static getDefaultName(tagName) {
        const names = {
            'SteadyState': 'Steady',
            'Warmup': 'Warmup',
            'Cooldown': 'Cooldown',
            'Ramp': 'Ramp',
            'IntervalsT': 'Intervals',
            'FreeRide': 'Free Ride',
            'MaxEffort': 'Max Effort'
        };
        return names[tagName] || 'Interval';
    }

    // Escape XML special characters
    static escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

// Add to window for global access
window.ZwoConverter = ZwoConverter;
