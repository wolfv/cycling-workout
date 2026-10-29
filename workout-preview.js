// Workout Preview Canvas Renderer
class WorkoutPreview {
    static drawPreview(canvasId, intervals, ftp = 200) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#191d19';
        ctx.fillRect(0, 0, width, height);

        if (!intervals || intervals.length === 0) return;

        // Calculate power for each interval based on type
        const powers = intervals.map(i => {
            const powerType = i.powerType || 'relative';
            if (powerType === 'ramp') {
                return Math.round(ftp * Math.max(i.percentageLow ?? 50, i.percentageHigh ?? 100) / 100);
            } else if (powerType === 'absolute') {
                return i.power || 0;
            } else {
                return Math.round(ftp * ((i.percentage ?? 100) / 100));
            }
        });

        // Calculate max power and total duration
        const maxPower = Math.max(1, ...powers);
        const totalDuration = intervals.reduce((sum, i) => sum + i.duration, 0);

        // Color mapping
        const colorMap = {
            warmup: '#e7bb71',
            endurance: '#78b4db',
            tempo: '#a5cb78',
            threshold: '#ee9390',
            vo2max: '#b4a0de',
            cooldown: '#91bfb9'
        };

        let x = 0;
        intervals.forEach((interval, index) => {
            const powerType = interval.powerType || 'relative';
            const barWidth = (interval.duration / totalDuration) * width;
            const color = colorMap[interval.type] || '#71717a';

            if (powerType === 'ramp') {
                // Draw ramp as a trapezoid
                const powerLow = Math.round(ftp * ((interval.percentageLow ?? 50) / 100));
                const powerHigh = Math.round(ftp * ((interval.percentageHigh ?? 100) / 100));
                const barHeightLow = (powerLow / maxPower) * height;
                const barHeightHigh = (powerHigh / maxPower) * height;

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x, height - barHeightLow);
                ctx.lineTo(x + barWidth, height - barHeightHigh);
                ctx.lineTo(x + barWidth, height);
                ctx.lineTo(x, height);
                ctx.closePath();
                ctx.fill();
            } else {
                // Draw regular interval as rectangle
                const power = powers[index];
                const barHeight = (power / maxPower) * height;

                ctx.fillStyle = color;
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            }

            x += barWidth;
        });
    }

    static refreshAllPreviews() {
        const workouts = JSON.parse(localStorage.getItem('zwift_workouts') || '{}');
        Object.keys(workouts).forEach(name => {
            const canvasId = `preview-${name.replace(/\s+/g, '-')}`;
            const workout = workouts[name];
            WorkoutPreview.drawPreview(canvasId, workout.intervals, workout.ftp || 200);
        });
    }
}
