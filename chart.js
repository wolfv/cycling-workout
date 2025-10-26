// Real-time Chart using Canvas
class LiveChart {
    constructor(canvasId, maxDataPoints = 120) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.maxDataPoints = maxDataPoints; // Show last 2 minutes at 1Hz
        this.powerData = [];
        this.hrData = [];
        this.targetPowerData = [];
        this.timestamps = [];
        this.currentTargetPower = 0;

        // Styling
        this.colors = {
            power: '#3b82f6',
            hr: '#ef4444',
            target: '#a1a1aa',
            grid: '#27272a',
            text: '#71717a',
            bg: '#18181b'
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
        this.draw();
    }

    addDataPoint(power, hr, targetPower = null) {
        const now = Date.now();
        this.powerData.push(power);
        this.hrData.push(hr);
        this.targetPowerData.push(targetPower !== null ? targetPower : this.currentTargetPower);
        this.timestamps.push(now);

        // Keep only recent data
        if (this.powerData.length > this.maxDataPoints) {
            this.powerData.shift();
            this.hrData.shift();
            this.targetPowerData.shift();
            this.timestamps.shift();
        }

        this.draw();
    }

    setTargetPower(power) {
        this.currentTargetPower = power;
    }

    clear() {
        this.powerData = [];
        this.hrData = [];
        this.targetPowerData = [];
        this.timestamps = [];
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const padding = { top: 20, right: 60, bottom: 30, left: 50 };
        const chartWidth = this.width - padding.left - padding.right;
        const chartHeight = this.height - padding.top - padding.bottom;

        // Clear canvas
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, this.width, this.height);

        if (this.powerData.length === 0) {
            ctx.fillStyle = this.colors.text;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data yet - start pedaling!', this.width / 2, this.height / 2);
            return;
        }

        // Find max values for scaling
        const maxPower = Math.max(...this.powerData, ...this.targetPowerData, 100);
        const maxHr = Math.max(...this.hrData, 100);

        // Draw grid
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        // Draw power axis labels
        ctx.fillStyle = this.colors.text;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const value = Math.round((maxPower / 5) * (5 - i));
            const y = padding.top + (chartHeight / 5) * i;
            ctx.fillText(`${value}W`, padding.left - 10, y + 4);
        }

        // Draw HR axis labels (right side)
        ctx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
            const value = Math.round((maxHr / 5) * (5 - i));
            const y = padding.top + (chartHeight / 5) * i;
            ctx.fillText(`${value}bpm`, padding.left + chartWidth + 10, y + 4);
        }

        // Helper function to get Y coordinate
        const getY = (value, max) => {
            return padding.top + chartHeight - (value / max) * chartHeight;
        };

        // Helper function to get X coordinate
        const getX = (index) => {
            return padding.left + (index / (this.maxDataPoints - 1)) * chartWidth;
        };

        // Draw target power line (dashed)
        if (this.targetPowerData.some(v => v > 0)) {
            ctx.strokeStyle = this.colors.target;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            for (let i = 0; i < this.targetPowerData.length; i++) {
                const x = getX(i);
                const y = getY(this.targetPowerData[i], maxPower);
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw power line
        ctx.strokeStyle = this.colors.power;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < this.powerData.length; i++) {
            const x = getX(i);
            const y = getY(this.powerData[i], maxPower);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Draw HR line
        ctx.strokeStyle = this.colors.hr;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < this.hrData.length; i++) {
            if (this.hrData[i] > 0) {
                const x = getX(i);
                const y = getY(this.hrData[i], maxHr);
                if (i === 0 || this.hrData[i - 1] === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();

        // Draw legend
        const legendY = this.height - 10;
        const legendItems = [
            { color: this.colors.power, label: 'Power' },
            { color: this.colors.target, label: 'Target' },
            { color: this.colors.hr, label: 'Heart Rate' }
        ];

        ctx.font = '12px sans-serif';
        let legendX = padding.left;
        legendItems.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.fillRect(legendX, legendY - 8, 15, 3);
            ctx.fillStyle = this.colors.text;
            ctx.textAlign = 'left';
            ctx.fillText(item.label, legendX + 20, legendY);
            legendX += ctx.measureText(item.label).width + 40;
        });
    }
}
