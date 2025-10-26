// Race Track Visualization - shows participants as moving dots on workout timeline
class RaceTrackVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error('Canvas not found:', canvasId);
            return;
        }
        this.ctx = this.canvas.getContext('2d');
        this.intervals = [];
        this.ftp = 200;
        this.participants = [];
        this.totalDuration = 0;
        this.animationFrame = null;

        // Color palette for participants
        this.colors = [
            '#3b82f6', // blue
            '#10b981', // green
            '#f59e0b', // orange
            '#ef4444', // red
            '#8b5cf6', // purple
            '#ec4899', // pink
            '#06b6d4', // cyan
            '#84cc16'  // lime
        ];
    }

    setWorkout(intervals, ftp) {
        this.intervals = intervals;
        this.ftp = ftp;
        this.totalDuration = intervals.reduce((sum, i) => sum + i.duration, 0);
    }

    setParticipants(participants) {
        this.participants = participants.map((p, index) => ({
            ...p,
            color: this.colors[index % this.colors.length]
        }));
        this.draw();
    }

    draw() {
        if (!this.canvas || !this.ctx) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = 40;
        const trackHeight = height - padding * 2;
        const trackWidth = width - padding * 2;

        // Clear canvas
        this.ctx.fillStyle = '#18181b';
        this.ctx.fillRect(0, 0, width, height);

        if (this.intervals.length === 0) return;

        // Draw workout intervals as background
        this.drawIntervals(padding, trackHeight, trackWidth);

        // Draw participants as dots
        this.drawParticipants(padding, trackHeight, trackWidth);

        // Draw legend
        this.drawLegend(padding, height);
    }

    drawIntervals(padding, trackHeight, trackWidth) {
        const maxPower = Math.max(...this.intervals.map(i => Math.round(this.ftp * (i.percentage / 100))));

        let x = padding;
        this.intervals.forEach(interval => {
            const power = Math.round(this.ftp * (interval.percentage / 100));
            const barWidth = (interval.duration / this.totalDuration) * trackWidth;
            const barHeight = (power / maxPower) * trackHeight;

            // Color based on interval type
            const colorMap = {
                warmup: '#4ade80',
                endurance: '#3b82f6',
                tempo: '#f59e0b',
                threshold: '#ef4444',
                vo2max: '#a855f7',
                cooldown: '#6366f1'
            };

            this.ctx.fillStyle = colorMap[interval.type] || '#6b7280';
            this.ctx.globalAlpha = 0.2;
            this.ctx.fillRect(x, padding + trackHeight - barHeight, barWidth, barHeight);
            this.ctx.globalAlpha = 1;

            // Draw interval border
            this.ctx.strokeStyle = '#3f3f46';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, padding, barWidth, trackHeight);

            x += barWidth;
        });

        // Draw baseline
        this.ctx.strokeStyle = '#52525b';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(padding, padding + trackHeight);
        this.ctx.lineTo(padding + trackWidth, padding + trackHeight);
        this.ctx.stroke();
    }

    drawParticipants(padding, trackHeight, trackWidth) {
        this.participants.forEach((participant, index) => {
            // Calculate position based on progress (0-1)
            const x = padding + (participant.progress * trackWidth);

            // Vertical position: stagger participants slightly
            const laneHeight = 20;
            const y = padding + trackHeight + 10 + (index % 4) * laneHeight;

            // Draw dot
            this.ctx.fillStyle = participant.color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 8, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw outline
            this.ctx.strokeStyle = participant.isHost ? '#fbbf24' : '#27272a';
            this.ctx.lineWidth = participant.isHost ? 3 : 2;
            this.ctx.stroke();

            // Draw name label
            this.ctx.fillStyle = '#fafafa';
            this.ctx.font = '12px system-ui, -apple-system, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(participant.name, x, y + 25);

            // Draw metrics below name
            this.ctx.font = '10px system-ui, -apple-system, sans-serif';

            // Power and cadence in gray
            this.ctx.fillStyle = '#a1a1aa';
            const metricsText = `${participant.power}W  ${participant.cadence}rpm`;
            const metricsWidth = this.ctx.measureText(metricsText).width;
            this.ctx.fillText(metricsText, x - metricsWidth/2 - 15, y + 37);

            // Heart rate with zone color
            if (participant.heartRate && participant.heartRate > 0) {
                const hrColor = HRZones.getHRColor(participant.heartRate);
                this.ctx.fillStyle = hrColor;
                this.ctx.fillText(`${participant.heartRate}bpm`, x + metricsWidth/2 - 5, y + 37);
            }
        });
    }

    drawLegend(padding, height) {
        const legendY = height - 15;
        let legendX = padding;

        this.ctx.font = '11px system-ui, -apple-system, sans-serif';
        this.ctx.textAlign = 'left';

        this.participants.forEach((participant) => {
            // Draw color dot
            this.ctx.fillStyle = participant.color;
            this.ctx.beginPath();
            this.ctx.arc(legendX, legendY, 5, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw name
            this.ctx.fillStyle = '#d4d4d8';
            this.ctx.fillText(participant.name, legendX + 10, legendY + 4);

            // Draw host badge
            if (participant.isHost) {
                this.ctx.fillStyle = '#fbbf24';
                this.ctx.font = 'bold 9px system-ui, -apple-system, sans-serif';
                const nameWidth = this.ctx.measureText(participant.name).width;
                this.ctx.fillText('HOST', legendX + 12 + nameWidth, legendY + 4);
                this.ctx.font = '11px system-ui, -apple-system, sans-serif';
            }

            legendX += this.ctx.measureText(participant.name).width + 60 + (participant.isHost ? 30 : 0);
        });
    }

    start() {
        this.draw();
    }

    stop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    clear() {
        this.stop();
        if (!this.canvas || !this.ctx) return;
        this.ctx.fillStyle = '#18181b';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
