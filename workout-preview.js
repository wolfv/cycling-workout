// Workout Preview Canvas Renderer
class WorkoutPreview {
    static drawPreview(canvasId, intervals, ftp = 200) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#27272a';
        ctx.fillRect(0, 0, width, height);

        if (!intervals || intervals.length === 0) return;

        // Calculate max power and total duration
        const maxPower = Math.max(...intervals.map(i => Math.round(ftp * (i.percentage / 100))));
        const totalDuration = intervals.reduce((sum, i) => sum + i.duration, 0);

        // Color mapping
        const colorMap = {
            warmup: '#f59e0b',
            endurance: '#3b82f6',
            tempo: '#22c55e',
            threshold: '#ef4444',
            vo2max: '#a855f7',
            cooldown: '#6366f1'
        };

        let x = 0;
        intervals.forEach(interval => {
            const power = Math.round(ftp * (interval.percentage / 100));
            const barWidth = (interval.duration / totalDuration) * width;
            const barHeight = (power / maxPower) * height;

            ctx.fillStyle = colorMap[interval.type] || '#71717a';
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

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
