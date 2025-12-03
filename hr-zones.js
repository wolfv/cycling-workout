// Heart Rate Zone Utilities

class HRZones {
    // Calculate HR zone (1-5) based on heart rate and max HR
    static getZone(hr, maxHR = 190) {
        if (hr === 0) return 0;

        const percentage = (hr / maxHR) * 100;

        if (percentage < 60) return 1;      // Zone 1: Recovery (50-60%)
        if (percentage < 70) return 2;      // Zone 2: Endurance (60-70%)
        if (percentage < 80) return 3;      // Zone 3: Tempo (70-80%)
        if (percentage < 90) return 4;      // Zone 4: Threshold (80-90%)
        return 5;                           // Zone 5: VO2 Max (90-100%)
    }

    // Get color for a heart rate zone
    static getZoneColor(zone) {
        const colors = {
            0: '#666666',  // No HR data - gray
            1: '#4ade80',  // Zone 1 - green
            2: '#22d3ee',  // Zone 2 - cyan
            3: '#fbbf24',  // Zone 3 - yellow/amber
            4: '#fb923c',  // Zone 4 - orange
            5: '#ef4444'   // Zone 5 - red
        };
        return colors[zone] || colors[0];
    }

    // Get zone name
    static getZoneName(zone) {
        const names = {
            0: 'No Data',
            1: 'Recovery',
            2: 'Endurance',
            3: 'Tempo',
            4: 'Threshold',
            5: 'VO2 Max'
        };
        return names[zone] || 'Unknown';
    }

    // Get color directly from HR value
    static getHRColor(hr, maxHR = 190) {
        const zone = this.getZone(hr, maxHR);
        return this.getZoneColor(zone);
    }

    // Format HR with zone indicator
    static formatHR(hr, maxHR = 190) {
        if (hr === 0) return '--';
        const zone = this.getZone(hr, maxHR);
        return `${hr} <span style="color: ${this.getZoneColor(zone)}">Z${zone}</span>`;
    }
}

// Expose globally for Alpine store
window.HRZones = HRZones;
