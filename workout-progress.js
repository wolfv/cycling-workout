// Workout Progress Visualizer
class WorkoutProgressVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.intervals = [];
        this.currentIntervalIndex = -1;
        this.intervalStartTime = 0;
        this.workoutStartTime = 0;
        this.ftp = 200;
        this.intensityScale = 1;

        // Colors matching workout zones
        this.colorMap = {
            warmup: '#f59e0b',
            endurance: '#3b82f6',
            tempo: '#22c55e',
            threshold: '#ef4444',
            vo2max: '#a855f7',
            cooldown: '#6366f1'
        };

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.width = rect.width;
        this.height = rect.height;
    }

    setWorkout(intervals, ftp, intensityScale = 1) {
        this.intervals = intervals;
        this.ftp = ftp;
        this.intensityScale = intensityScale;
        this.currentIntervalIndex = -1;
        this.draw();
    }

    start(startTime) {
        this.workoutStartTime = startTime;
        this.currentIntervalIndex = 0;
        this.intervalStartTime = startTime;
    }

    updateProgress(currentIntervalIndex, elapsed) {
        this.currentIntervalIndex = currentIntervalIndex;
        this.draw(elapsed);
    }

    draw(elapsedInInterval = 0) {
        const ctx = this.ctx;
        const width = this.width;
        const height = this.height;

        // Clear canvas
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, width, height);

        if (!this.intervals || this.intervals.length === 0) return;

        const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration, 0);
        
        // Calculate power for each interval based on type
        const powers = this.intervals.map(i => {
            const powerType = i.powerType || 'relative';
            if (powerType === 'ramp') {
                // For ramps, use the high value for max calculation
                return Math.round(this.ftp * this.intensityScale * ((i.percentageHigh || 100) / 100));
            } else if (powerType === 'absolute') {
                return Math.round((i.power || 0) * this.intensityScale);
            } else {
                return Math.round(this.ftp * this.intensityScale * ((i.percentage || 100) / 100));
            }
        });

        const maxPower = Math.max(...powers);

        let x = 0;
        this.intervals.forEach((interval, index) => {
            const powerType = interval.powerType || 'relative';
            const barWidth = (interval.duration / totalDuration) * width;
            const power = powers[index];

            // Determine color and opacity
            let color = this.colorMap[interval.type] || '#71717a';
            let opacity = 1;

            if (this.currentIntervalIndex !== -1) {
                if (index < this.currentIntervalIndex) {
                    opacity = 0.3; // Completed - dimmed
                } else if (index === this.currentIntervalIndex) {
                    opacity = 1; // Current - highlighted
                } else {
                    opacity = 0.6; // Upcoming - medium dim
                }
            }

            // Draw interval shape based on type
            if (powerType === 'ramp') {
                // Draw ramp as trapezoid
                const powerLow = Math.round(this.ftp * this.intensityScale * ((interval.percentageLow || 50) / 100));
                const powerHigh = Math.round(this.ftp * this.intensityScale * ((interval.percentageHigh || 100) / 100));
                const barHeightLow = (powerLow / maxPower) * (height - 30);
                const barHeightHigh = (powerHigh / maxPower) * (height - 30);

                // Handle progress for current ramp interval
                if (index === this.currentIntervalIndex && elapsedInInterval > 0 && interval.duration > 0) {
                    const progress = Math.min(elapsedInInterval / interval.duration, 1);
                    const progressWidth = barWidth * progress;

                    // Calculate intermediate height at progress point
                    const progressHeight = barHeightLow + (barHeightHigh - barHeightLow) * progress;

                    // Draw completed portion (brighter)
                    if (progressWidth > 0) {
                        ctx.fillStyle = this.adjustOpacity(color, 1);
                        ctx.beginPath();
                        ctx.moveTo(x, height - barHeightLow - 30);
                        ctx.lineTo(x + progressWidth, height - progressHeight - 30);
                        ctx.lineTo(x + progressWidth, height - 30);
                        ctx.lineTo(x, height - 30);
                        ctx.closePath();
                        ctx.fill();
                    }

                    // Draw remaining portion (dimmed)
                    if (progressWidth < barWidth) {
                        ctx.fillStyle = this.adjustOpacity(color, 0.5);
                        ctx.beginPath();
                        ctx.moveTo(x + progressWidth, height - progressHeight - 30);
                        ctx.lineTo(x + barWidth, height - barHeightHigh - 30);
                        ctx.lineTo(x + barWidth, height - 30);
                        ctx.lineTo(x + progressWidth, height - 30);
                        ctx.closePath();
                        ctx.fill();
                    }
                } else {
                    // Draw full ramp trapezoid
                    ctx.fillStyle = this.adjustOpacity(color, opacity);
                    ctx.beginPath();
                    ctx.moveTo(x, height - barHeightLow - 30);
                    ctx.lineTo(x + barWidth, height - barHeightHigh - 30);
                    ctx.lineTo(x + barWidth, height - 30);
                    ctx.lineTo(x, height - 30);
                    ctx.closePath();
                    ctx.fill();
                }
            } else {
                // Draw regular interval as rectangle
                const barHeight = (power / maxPower) * (height - 30);

                if (index === this.currentIntervalIndex && elapsedInInterval > 0 && interval.duration > 0) {
                    const progress = Math.min(elapsedInInterval / interval.duration, 1);
                    const progressWidth = barWidth * progress;

                    // Draw completed portion brighter
                    ctx.fillStyle = this.adjustOpacity(color, 1);
                    ctx.fillRect(x, height - barHeight - 30, progressWidth, barHeight);

                    // Draw remaining portion dimmed
                    ctx.fillStyle = this.adjustOpacity(color, 0.5);
                    ctx.fillRect(x + progressWidth, height - barHeight - 30, barWidth - progressWidth, barHeight);
                } else {
                    ctx.fillStyle = this.adjustOpacity(color, opacity);
                    ctx.fillRect(x, height - barHeight - 30, barWidth, barHeight);
                }
            }

            // Draw separator line
            if (index > 0) {
                ctx.strokeStyle = '#27272a';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, height - 30);
                ctx.lineTo(x, height - barHeight - 30);
                ctx.stroke();
            }

            // Draw label for current interval
            if (index === this.currentIntervalIndex && barWidth > 60) {
                ctx.fillStyle = '#fafafa';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${power}W`, x + barWidth / 2, height - barHeight - 40);
            }

            x += barWidth;
        });

        // Draw timeline labels at bottom
        ctx.fillStyle = '#71717a';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';

        x = 0;
        this.intervals.forEach((interval, index) => {
            const barWidth = (interval.duration / totalDuration) * width;
            if (barWidth > 40) {
                const mins = Math.floor(interval.duration / 60);
                const secs = interval.duration % 60;
                const label = secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins}m`;
                ctx.fillText(label, x + barWidth / 2, height - 10);
            }
            x += barWidth;
        });
    }

    adjustOpacity(color, opacity) {
        // Convert hex to rgba with opacity
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    setIntensityScale(scale) {
        this.intensityScale = Math.max(0.5, Math.min(1.5, scale || 1));
        this.draw();
    }

    clear() {
        this.intervals = [];
        this.currentIntervalIndex = -1;
        const ctx = this.ctx;
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, this.width, this.height);
    }
}
