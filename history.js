// Ride history tab: weekly summary, ride list and ride detail with charts. Needs the account backend (account.js).
// All text reaches the page through Alpine x-text, so ride names are never parsed as HTML.

const HISTORY_COLORS = {
    power: '#c3ef73',
    hr: '#f2a2a8',
    cadence: '#7dd3fc',
    grid: '#2a3227',
    text: '#a2ac9e',
    bg: '#191d19'
};

function formatClock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${minutes}:${String(secs).padStart(2, '0')}`;
}

// "2h 05m" for tiles.
function formatTotalTime(seconds) {
    const minutes = Math.round(Math.max(0, seconds) / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatNumber(value) {
    return Math.round(value).toLocaleString('en-US');
}

function formatOptional(value, unit = '', digits = 0) {
    return value === null || value === undefined ? '—' : `${Number(value).toFixed(digits)}${unit}`;
}

// Display fields for one ride summary from GET /api/rides.
function formatRide(ride) {
    const started = new Date(ride.startedAt);
    return {
        id: ride.id,
        workoutName: ride.workoutName || 'Ride',
        dateLabel: started.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        timeLabel: started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        durationLabel: formatClock(ride.durationS),
        powerLabel: `${formatOptional(ride.avgPower)} / ${formatOptional(ride.np)} W`,
        hrLabel: formatOptional(ride.avgHr, ' bpm'),
        tssLabel: formatOptional(ride.tss),
        groupSession: Boolean(ride.groupSession),
        figures: [
            { label: 'Duration', value: formatClock(ride.durationS) },
            { label: 'Average power', value: formatOptional(ride.avgPower, ' W') },
            { label: 'Normalized power', value: formatOptional(ride.np, ' W') },
            { label: 'Peak power', value: formatOptional(ride.maxPower, ' W') },
            { label: 'Average heart rate', value: formatOptional(ride.avgHr, ' bpm') },
            { label: 'Peak heart rate', value: formatOptional(ride.maxHr, ' bpm') },
            { label: 'Average cadence', value: formatOptional(ride.avgCadence, ' rpm') },
            { label: 'Total work', value: formatOptional(ride.workKj, ' kJ') },
            { label: 'Training stress', value: formatOptional(ride.tss, ' TSS', 1) }
        ],
        ftpLabel: ride.ftp ? `${ride.ftp} W FTP` : 'No FTP set'
    };
}

function formatPeriod(period) {
    return {
        rides: String(period.rides),
        time: formatTotalTime(period.durationS),
        kj: formatNumber(period.workKj),
        tss: formatNumber(period.tss || 0)
    };
}

// Averages 1 Hz samples into at most `maxPoints` buckets so long rides draw quickly; zeros do not drag HR or cadence down.
function reduceSamples(samples, maxPoints) {
    if (samples.length <= maxPoints) return samples;
    const size = samples.length / maxPoints;
    const reduced = [];
    for (let i = 0; i < maxPoints; i++) {
        const from = Math.floor(i * size);
        const to = Math.max(from + 1, Math.floor((i + 1) * size));
        let power = 0, hr = 0, hrCount = 0, cadence = 0, cadenceCount = 0;
        for (let j = from; j < to; j++) {
            power += samples[j][1];
            if (samples[j][2] > 0) { hr += samples[j][2]; hrCount++; }
            if (samples[j][3] > 0) { cadence += samples[j][3]; cadenceCount++; }
        }
        reduced.push([
            samples[from][0],
            Math.round(power / (to - from)),
            hrCount ? Math.round(hr / hrCount) : 0,
            cadenceCount ? Math.round(cadence / cadenceCount) : 0
        ]);
    }
    return reduced;
}

// Sizes the canvas for the screen's pixel density; null while it is hidden.
function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = HISTORY_COLORS.bg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    return { ctx, width: rect.width, height: rect.height };
}

function drawMessage(view, text) {
    view.ctx.fillStyle = HISTORY_COLORS.text;
    view.ctx.font = '13px sans-serif';
    view.ctx.textAlign = 'center';
    view.ctx.fillText(text, view.width / 2, view.height / 2);
    return true;
}

// Training time per week, oldest to newest.
function drawWeeklyChart(canvas, weeks) {
    const view = prepareCanvas(canvas);
    if (!view) return false;
    const { ctx, width, height } = view;
    if (!weeks.length) return drawMessage(view, 'No weekly data yet.');
    const pad = { top: 22, right: 12, bottom: 26, left: 12 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const hours = weeks.map(week => week.durationS / 3600);
    const max = Math.max(1, ...hours);
    const slot = plotWidth / weeks.length;
    const barWidth = Math.max(4, slot * 0.62);

    ctx.fillStyle = HISTORY_COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${max.toFixed(max < 10 ? 1 : 0)} h`, pad.left, 12);
    ctx.strokeStyle = HISTORY_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + plotHeight + 0.5);
    ctx.lineTo(pad.left + plotWidth, pad.top + plotHeight + 0.5);
    ctx.stroke();

    weeks.forEach((week, index) => {
        const x = pad.left + slot * index + (slot - barWidth) / 2;
        const barHeight = Math.max(hours[index] > 0 ? 2 : 0, (hours[index] / max) * plotHeight);
        ctx.fillStyle = index === weeks.length - 1 ? HISTORY_COLORS.power : 'rgba(195, 239, 115, 0.45)';
        ctx.fillRect(x, pad.top + plotHeight - barHeight, barWidth, barHeight);
        // Label every fourth week, counted back from the current one.
        if ((weeks.length - 1 - index) % 4 === 0) {
            ctx.fillStyle = HISTORY_COLORS.text;
            ctx.textAlign = 'center';
            const label = new Date(`${week.weekStart}T00:00:00Z`)
                .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
            ctx.fillText(label, x + barWidth / 2, height - 8);
        }
    });
    return true;
}

// Power (area and line), heart rate and cadence over the ride, each on its own scale.
function drawRideChart(canvas, samples) {
    const view = prepareCanvas(canvas);
    if (!view) return false;
    const { ctx, width, height } = view;
    if (!samples.length) return drawMessage(view, 'No samples for this ride.');
    const pad = { top: 14, right: width < 480 ? 38 : 50, bottom: 26, left: width < 480 ? 38 : 50 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const points = reduceSamples(samples, Math.max(2, Math.floor(plotWidth)));
    const duration = Math.max(1, samples[samples.length - 1][0]);
    const maxPower = Math.max(100, Math.ceil(Math.max(...points.map(p => p[1])) / 50) * 50);
    const hrValues = points.map(p => p[2]).filter(value => value > 0);
    const hrMax = hrValues.length ? Math.max(...hrValues) + 10 : 0;
    const hrMin = hrValues.length ? Math.max(0, Math.min(...hrValues) - 10) : 0;
    const maxCadence = Math.max(120, ...points.map(p => p[3]));
    const x = t => pad.left + (t / duration) * plotWidth;
    const bottom = pad.top + plotHeight;

    ctx.strokeStyle = HISTORY_COLORS.grid;
    ctx.fillStyle = HISTORY_COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y + 0.5);
        ctx.lineTo(pad.left + plotWidth, y + 0.5);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round((maxPower / 4) * (4 - i))}`, pad.left - 6, y + 4);
        if (hrMax) {
            ctx.textAlign = 'left';
            ctx.fillText(`${Math.round(hrMin + ((hrMax - hrMin) / 4) * (4 - i))}`, pad.left + plotWidth + 6, y + 4);
        }
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
        const seconds = (duration / 4) * i;
        ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
        ctx.fillText(formatClock(seconds - (seconds % 60)), pad.left + (plotWidth / 4) * i, height - 8);
    }

    const line = (index, scale, color, lineWidth) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let drawing = false;
        for (const point of points) {
            if (point[index] <= 0) { drawing = false; continue; }
            const px = x(point[0]);
            const py = scale(point[index]);
            if (drawing) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
            drawing = true;
        }
        ctx.stroke();
    };
    line(3, value => bottom - (value / maxCadence) * plotHeight, HISTORY_COLORS.cadence, 1);
    if (hrMax) line(2, value => bottom - ((value - hrMin) / (hrMax - hrMin)) * plotHeight, HISTORY_COLORS.hr, 1.5);

    ctx.beginPath();
    ctx.moveTo(x(points[0][0]), bottom);
    for (const point of points) ctx.lineTo(x(point[0]), bottom - (point[1] / maxPower) * plotHeight);
    ctx.lineTo(x(points[points.length - 1][0]), bottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(195, 239, 115, 0.14)';
    ctx.fill();
    line(1, value => bottom - (value / maxPower) * plotHeight, HISTORY_COLORS.power, 1.75);
    return true;
}

class RideHistory {
    constructor(account, options = {}) {
        this.account = account;
        this.explicitState = options.state || null;
        this.pageSize = 20;
        this.weeks = [];
        this.samples = []; // raw samples of the open ride, kept out of the reactive store
        this.reloadWhenIdle = false;
    }

    get state() {
        return this.explicitState || Alpine.store('app').rideHistory;
    }

    reset() {
        Object.assign(this.state, {
            loaded: false, loading: false, loadingMore: false, error: '', rides: [], nextCursor: null,
            stats: null, selected: null, detailLoading: false, confirmingDelete: false, weeklySummary: '', rideSummary: ''
        });
        this.weeks = [];
        this.samples = [];
        if (window.app && window.app.currentTab === 'history') window.app.switchTab('ride');
    }

    // A new ride was saved: refresh now when the list is on screen, otherwise on the next visit.
    markStale() {
        const state = this.state;
        state.loaded = false;
        if (window.app && window.app.currentTab === 'history' && !state.selected) this.load();
    }

    async onShow() {
        if (!this.state.loaded && !this.state.loading) await this.load();
        this.drawSoon();
    }

    // Alpine reveals elements a moment after the state changes; draw once the canvas has a size.
    drawSoon(attempts = 10) {
        setTimeout(() => {
            if (!this.drawCharts() && attempts > 0) this.drawSoon(attempts - 1);
        }, 30);
    }

    focusSoon(id, attempts = 10) {
        setTimeout(() => {
            const element = document.getElementById(id);
            if (element && element.offsetParent === null && attempts > 0) this.focusSoon(id, attempts - 1);
            else if (element) element.focus();
        }, 30);
    }

    async load() {
        const state = this.state;
        if (state.loading) {
            this.reloadWhenIdle = true;
            return;
        }
        state.loading = true;
        state.error = '';
        try {
            const [stats, page] = await Promise.all([
                this.account.request('GET', '/api/stats'),
                this.account.request('GET', `/api/rides?limit=${this.pageSize}`)
            ]);
            this.applyStats(stats);
            state.rides = page.rides.map(formatRide);
            state.nextCursor = page.nextCursor || null;
            state.loaded = true;
        } catch (error) {
            state.error = `Could not load your rides. ${describeError(error)}`;
        } finally {
            state.loading = false;
        }
        if (this.reloadWhenIdle) {
            this.reloadWhenIdle = false;
            return this.load();
        }
        this.drawSoon();
    }

    applyStats(stats) {
        const state = this.state;
        this.weeks = stats.weeks || [];
        state.stats = { week: formatPeriod(stats.thisWeek), month: formatPeriod(stats.thisMonth) };
        const totalHours = this.weeks.reduce((sum, week) => sum + week.durationS, 0) / 3600;
        state.weeklySummary = `Training time per week over the last 12 weeks, ${totalHours.toFixed(1)} hours in total.`;
    }

    async loadMore() {
        const state = this.state;
        if (!state.nextCursor || state.loadingMore) return;
        state.loadingMore = true;
        state.error = '';
        try {
            const page = await this.account.request(
                'GET', `/api/rides?limit=${this.pageSize}&cursor=${encodeURIComponent(state.nextCursor)}`
            );
            state.rides = [...state.rides, ...page.rides.map(formatRide)];
            state.nextCursor = page.nextCursor || null;
        } catch (error) {
            state.error = `Could not load more rides. ${describeError(error)}`;
        } finally {
            state.loadingMore = false;
        }
    }

    async open(id) {
        const state = this.state;
        state.error = '';
        state.confirmingDelete = false;
        state.detailLoading = true;
        state.selected = state.rides.find(ride => ride.id === id) || { id, workoutName: 'Ride', dateLabel: '', timeLabel: '', figures: [], ftpLabel: '' };
        this.samples = [];
        try {
            const detail = await this.account.request('GET', `/api/rides/${encodeURIComponent(id)}`);
            if (!state.selected || state.selected.id !== id) return; // closed or switched meanwhile
            this.samples = detail.samples || [];
            state.selected = formatRide(detail);
            state.rideSummary = `Power, heart rate and cadence over ${formatClock(detail.durationS)}.`;
        } catch (error) {
            state.error = `Could not open this ride. ${describeError(error)}`;
            state.selected = null;
        } finally {
            state.detailLoading = false;
        }
        this.drawSoon();
        this.focusSoon('rideDetailHeading');
    }

    closeDetail() {
        const state = this.state;
        const id = state.selected && state.selected.id;
        state.selected = null;
        state.confirmingDelete = false;
        this.samples = [];
        this.drawSoon();
        setTimeout(() => {
            const row = id && document.querySelector(`[data-ride-id="${CSS.escape(id)}"]`);
            if (row) row.focus();
        }, 60);
    }

    async downloadTcx() {
        const state = this.state;
        if (!state.selected) return;
        try {
            await this.account.download(`/api/rides/${encodeURIComponent(state.selected.id)}/tcx`, 'cadence-ride.tcx');
        } catch (error) {
            state.error = `Could not download the TCX file. ${describeError(error)}`;
        }
    }

    requestDelete() {
        this.state.confirmingDelete = true;
        this.focusSoon('confirmDeleteRide');
    }

    cancelDelete() {
        this.state.confirmingDelete = false;
    }

    async confirmDelete() {
        const state = this.state;
        if (!state.selected) return;
        const id = state.selected.id;
        state.error = '';
        try {
            await this.account.request('DELETE', `/api/rides/${encodeURIComponent(id)}`);
        } catch (error) {
            state.error = `Could not delete this ride. ${describeError(error)}`;
            return;
        }
        state.rides = state.rides.filter(ride => ride.id !== id);
        state.selected = null;
        state.confirmingDelete = false;
        this.samples = [];
        try {
            this.applyStats(await this.account.request('GET', '/api/stats'));
        } catch (_) {
            state.loaded = false; // totals refresh on the next visit
        }
        this.drawSoon();
    }

    // Returns false while the chart is not laid out yet (hidden tab or view), true when nothing is left to draw.
    drawCharts() {
        if (!window.app || window.app.currentTab !== 'history') return true;
        const state = this.state;
        const weekly = document.getElementById('weeklyChart');
        if (weekly && !state.selected && state.stats) return drawWeeklyChart(weekly, this.weeks);
        const ride = document.getElementById('rideChart');
        if (ride && state.selected && !state.detailLoading) return drawRideChart(ride, this.samples);
        return true;
    }
}

// --- bootstrap (not part of the unit-tested class code) ---
(function startRideHistory() {
    const start = () => {
        const history = new RideHistory(window.accountManager);
        window.rideHistory = history;
        window.accountManager.on('user', user => { if (!user) history.reset(); });
        window.accountManager.on('rideSaved', () => history.markStale());
        let frame = null;
        window.addEventListener('resize', () => {
            if (frame === null) frame = requestAnimationFrame(() => { frame = null; history.drawCharts(); });
        });
    };
    if (window.Alpine && Alpine.store && Alpine.store('app')) start();
    else document.addEventListener('alpine:initialized', start, { once: true });
})();
