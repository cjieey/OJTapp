/**
 * OJT Time Tracker - Main Application
 * Progressive Web App for tracking internship hours
 */

class OJTTracker {
    constructor() {
        this.currentView = 'dashboard';
        this.currentDate = new Date();
        this.selectedDate = null;
        this.timerInterval = null;
        this.deferredPrompt = null;
        
        this.init();
    }

    async init() {
        // Wait for DB to be ready
        await db.init();
        
        // Initialize UI
        this.setupEventListeners();
        this.loadTheme();
        this.checkInstallPrompt();
        
        // Load initial data
        await this.updateDashboard();
        this.renderCalendar();
        this.renderLogs();
        
        // Check for active session
        await this.checkActiveSession();
        
        // Request notification permission if enabled
        this.setupNotifications();
        
        console.log('OJT Tracker initialized');
    }

    // ==================== NAVIGATION ====================

    showView(viewName) {
        // Hide all views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        
        // Show selected view
        const targetView = document.getElementById(`view-${viewName}`);
        if (targetView) {
            targetView.classList.add('active');
            this.currentView = viewName;
        }
        
        // Update nav
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === viewName) {
                item.classList.add('active');
            }
        });
        
        // Refresh data if needed
        if (viewName === 'dashboard') this.updateDashboard();
        if (viewName === 'calendar') this.renderCalendar();
        if (viewName === 'logs') this.renderLogs();
        if (viewName === 'settings') this.loadSettings();
        
        // Scroll to top
        document.querySelector('.main-content').scrollTop = 0;
    }

    // ==================== DASHBOARD ====================

    async updateDashboard() {
        const settings = await this.getSettings();
        const totalHours = await db.getTotalHours();
        const requiredHours = settings.requiredHours || 300;
        const percentage = Math.min((totalHours / requiredHours) * 100, 100);
        const remaining = Math.max(requiredHours - totalHours, 0);

        // Update progress ring
        const circle = document.getElementById('progress-ring');
        const radius = 54;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;
        
        circle.style.strokeDashoffset = offset;
        
        // Color based on progress
        let color = 'var(--progress-low)';
        if (percentage >= 30) color = 'var(--progress-mid)';
        if (percentage >= 70) color = 'var(--progress-high)';
        circle.style.stroke = color;

        // Update text
        document.getElementById('progress-percent').textContent = `${Math.round(percentage)}%`;
        document.getElementById('total-hours').textContent = totalHours.toFixed(1);
        document.getElementById('required-hours').textContent = requiredHours;
        document.getElementById('remaining-hours').textContent = remaining.toFixed(1);

        // Update today's status
        await this.updateTodayStatus();
        this.renderWeekPreview();
    }

    async updateTodayStatus() {
        const today = new Date().toISOString().split('T')[0];
        const todayHours = await db.getHoursByDate(today);
        const session = await db.getSession();
        
        const statusBadge = document.getElementById('status-badge');
        const btnTimeIn = document.getElementById('btn-time-in');
        const btnTimeOut = document.getElementById('btn-time-out');
        const currentSession = document.getElementById('current-session');
        const todaySummary = document.getElementById('today-summary');

        if (session) {
            // Currently clocked in
            statusBadge.textContent = 'Clocked In';
            statusBadge.classList.add('active');
            btnTimeIn.style.display = 'none';
            btnTimeOut.style.display = 'flex';
            currentSession.style.display = 'block';
            
            // Start timer
            this.startSessionTimer(new Date(session.startTime));
            
            const sessionDuration = this.calculateDuration(session.startTime, new Date().toISOString());
            const totalToday = todayHours + sessionDuration;
            todaySummary.innerHTML = `
                <strong>Today:</strong> ${this.formatDuration(totalToday)} total<br>
                <small>Current session: ${this.formatDuration(sessionDuration)}</small>
            `;
        } else {
            // Not clocked in
            statusBadge.textContent = 'Not Clocked In';
            statusBadge.classList.remove('active');
            btnTimeIn.style.display = 'flex';
            btnTimeOut.style.display = 'none';
            currentSession.style.display = 'none';
            this.stopSessionTimer();
            
            if (todayHours > 0) {
                todaySummary.innerHTML = `
                    <strong>Today:</strong> ${this.formatDuration(todayHours)} logged<br>
                    <small>Last session ended</small>
                `;
            } else {
                todaySummary.innerHTML = '<p>No hours logged today yet</p>';
            }
        }
    }

    async renderWeekPreview() {
        const container = document.getElementById('week-preview');
        const settings = await this.getSettings();
        const dailyExpected = settings.dailyHours || 8;
        
        // Get last 7 days
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d);
        }

        const html = await Promise.all(days.map(async (date) => {
            const dateStr = date.toISOString().split('T')[0];
            const hours = await db.getHoursByDate(dateStr);
            const dayName = date.toLocaleDateString('en-US', { weekday: 'narrow' });
            const isToday = dateStr === new Date().toISOString().split('T')[0];
            
            let statusClass = '';
            if (hours >= dailyExpected) statusClass = 'complete';
            else if (hours > 0) statusClass = 'partial';
            
            return `
                <div class="week-day ${statusClass} ${isToday ? 'today' : ''}">
                    <span class="week-day-label">${dayName}</span>
                    <span class="week-day-hours">${hours > 0 ? hours.toFixed(1) : '-'}</span>
                </div>
            `;
        }));

        container.innerHTML = html.join('');
    }

    // ==================== TIME IN/OUT ====================

    async timeIn() {
        // Check if already clocked in
        const existingSession = await db.getSession();
        if (existingSession) {
            this.showToast('Already clocked in! Please clock out first.', 'warning');
            return;
        }

        const now = new Date();
        const session = {
            startTime: now.toISOString(),
            date: now.toISOString().split('T')[0]
        };

        await db.setSession(session);
        
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(50);
        
        this.showToast('Time In recorded!', 'success');
        this.updateDashboard();
        
        // Set reminder for 5 PM if enabled
        this.scheduleReminder();
    }

    async timeOut() {
        const session = await db.getSession();
        if (!session) {
            this.showToast('No active session found', 'error');
            return;
        }

        const now = new Date();
        const endTime = now.toISOString();
        
        // Calculate duration in hours
        const duration = this.calculateDuration(session.startTime, endTime);
        
        if (duration < 0.016) { // Less than 1 minute
            this.showToast('Session too short (minimum 1 minute)', 'warning');
            return;
        }

        // Create entry
        const entry = {
            date: session.date,
            startTime: session.startTime,
            endTime: endTime,
            duration: duration,
            breakDuration: 0,
            notes: ''
        };

        await db.addEntry(entry);
        await db.clearSession();
        
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        
        this.showToast(`Time Out! Logged ${this.formatDuration(duration)}`, 'success');
        this.updateDashboard();
        
        // Clear reminder
        this.cancelReminder();
    }

    calculateDuration(start, end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        const diffMs = endDate - startDate;
        return diffMs / (1000 * 60 * 60); // Convert to hours
    }

    formatDuration(hours) {
        if (hours < 1) {
            const mins = Math.round(hours * 60);
            return `${mins}m`;
        }
        const wholeHours = Math.floor(hours);
        const mins = Math.round((hours - wholeHours) * 60);
        return mins > 0 ? `${wholeHours}h ${mins}m` : `${wholeHours}h`;
    }

    startSessionTimer(startTime) {
        this.stopSessionTimer();
        
        const updateTimer = () => {
            const now = new Date();
            const diff = now - startTime;
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            
            document.getElementById('session-timer').textContent = 
                `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        };
        
        updateTimer();
        this.timerInterval = setInterval(updateTimer, 1000);
    }

    stopSessionTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    async checkActiveSession() {
        const session = await db.getSession();
        if (session) {
            // Check if session is from today
            const today = new Date().toISOString().split('T')[0];
            if (session.date !== today) {
                // Auto close yesterday's session
                await this.timeOut();
                this.showToast('Previous session auto-closed', 'info');
            }
        }
    }

    // ==================== CALENDAR ====================

    async renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // Update header
        document.getElementById('calendar-month-year').textContent = 
            new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();
        
        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';
        
        const settings = await this.getSettings();
        const dailyExpected = settings.dailyHours || 8;
        const today = new Date().toISOString().split('T')[0];

        // Previous month days
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const cell = this.createCalendarCell(day, true);
            grid.appendChild(cell);
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const hours = await db.getHoursByDate(dateStr);
            const isToday = dateStr === today;
            const isFuture = new Date(dateStr) > new Date();
            const isWeekend = new Date(dateStr).getDay() === 0 || new Date(dateStr).getDay() === 6;
            
            let statusClass = '';
            if (isFuture || isWeekend) {
                statusClass = '';
            } else if (hours >= dailyExpected) {
                statusClass = 'complete';
            } else if (hours > 0) {
                statusClass = 'partial';
            } else {
                statusClass = 'missing';
            }

            const cell = this.createCalendarCell(day, false, statusClass, hours, isToday, dateStr);
            grid.appendChild(cell);
        }

        // Next month days
        const remainingCells = 42 - (firstDay + daysInMonth);
        for (let day = 1; day <= remainingCells; day++) {
            const cell = this.createCalendarCell(day, true);
            grid.appendChild(cell);
        }
    }

    createCalendarCell(day, isOtherMonth, statusClass = '', hours = 0, isToday = false, dateStr = null) {
        const cell = document.createElement('div');
        cell.className = `calendar-day ${isOtherMonth ? 'other-month' : ''} ${statusClass} ${isToday ? 'today' : ''}`;
        
        if (dateStr && !isOtherMonth) {
            cell.onclick = () => this.showDayDetails(dateStr);
        }

        const dayNum = document.createElement('span');
        dayNum.className = 'calendar-day-number';
        dayNum.textContent = day;
        cell.appendChild(dayNum);

        if (hours > 0 && !isOtherMonth) {
            const hoursEl = document.createElement('span');
            hoursEl.className = 'calendar-day-hours';
            hoursEl.textContent = hours.toFixed(1) + 'h';
            cell.appendChild(hoursEl);
        }

        return cell;
    }

    changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.renderCalendar();
    }

    async showDayDetails(dateStr) {
        this.selectedDate = dateStr;
        const entries = await db.getEntriesByDate(dateStr);
        const dateObj = new Date(dateStr);
        
        document.getElementById('modal-date').textContent = dateObj.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });

        const body = document.getElementById('modal-body');
        
        if (entries.length === 0) {
            body.innerHTML = '<p class="text-center">No entries for this day.</p>';
        } else {
            body.innerHTML = entries.map(entry => `
                <div class="modal-entry">
                    <div class="modal-entry-time">
                        ${new Date(entry.startTime).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})} - 
                        ${new Date(entry.endTime).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div class="modal-entry-duration">${this.formatDuration(entry.duration)}</div>
                    ${entry.notes ? `<div class="modal-entry-notes">${entry.notes}</div>` : ''}
                    <div style="margin-top: 8px;">
                        <button class="btn btn-text" onclick="app.editEntry(${entry.id})">Edit</button>
                        <button class="btn btn-text" style="color: var(--error)" onclick="app.deleteEntry(${entry.id})">Delete</button>
                    </div>
                </div>
            `).join('');
        }

        document.getElementById('day-modal').classList.add('active');
    }

    closeModal() {
        document.getElementById('day-modal').classList.remove('active');
    }

    addEntryForDate() {
        this.closeModal();
        this.showView('add');
        document.getElementById('entry-date').value = this.selectedDate;
    }

    // ==================== LOGS ====================

    async renderLogs() {
        const entries = await db.getAllEntries();
        const container = document.getElementById('logs-list');
        const emptyState = document.getElementById('logs-empty');

        if (entries.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        
        container.innerHTML = entries.map(entry => {
            const date = new Date(entry.date);
            const start = new Date(entry.startTime);
            const end = new Date(entry.endTime);
            
            return `
                <div class="log-item">
                    <div class="log-info">
                        <div class="log-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div class="log-time">
                            ${start.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})} - 
                            ${end.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                            ${entry.notes ? `• ${entry.notes}` : ''}
                        </div>
                    </div>
                    <div class="log-duration">
                        <div class="log-hours">${entry.duration.toFixed(1)}h</div>
                        <div class="log-label">total</div>
                    </div>
                    <div class="log-actions">
                        <button class="icon-btn" onclick="app.editEntry(${entry.id})" title="Edit">✏️</button>
                        <button class="icon-btn" onclick="app.deleteEntry(${entry.id})" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==================== ADD/EDIT ENTRY ====================

    async saveEntry(event) {
        event.preventDefault();
        
        const id = document.getElementById('entry-id').value;
        const date = document.getElementById('entry-date').value;
        const startTime = document.getElementById('entry-start').value;
        const endTime = document.getElementById('entry-end').value;
        const breakMins = parseInt(document.getElementById('entry-break').value) || 0;
        const notes = document.getElementById('entry-notes').value;

        if (!date || !startTime || !endTime) {
            this.showToast('Please fill in all required fields', 'error');
            return;
        }

        // Create ISO strings
        const startDateTime = new Date(`${date}T${startTime}`);
        const endDateTime = new Date(`${date}T${endTime}`);
        
        if (endDateTime <= startDateTime) {
            this.showToast('End time must be after start time', 'error');
            return;
        }

        const duration = (endDateTime - startDateTime) / (1000 * 60 * 60) - (breakMins / 60);

        const entry = {
            date: date,
            startTime: startDateTime.toISOString(),
            endTime: endDateTime.toISOString(),
            duration: Math.max(0, duration),
            breakDuration: breakMins,
            notes: notes
        };

        try {
            if (id) {
                await db.updateEntry(parseInt(id), entry);
                this.showToast('Entry updated successfully!', 'success');
            } else {
                await db.addEntry(entry);
                this.showToast('Entry added successfully!', 'success');
            }
            
            // Reset form
            document.getElementById('entry-form').reset();
            document.getElementById('entry-id').value = '';
            
            // Go back to dashboard
            this.showView('dashboard');
        } catch (error) {
            this.showToast('Error saving entry: ' + error.message, 'error');
        }
    }

    async editEntry(id) {
        const entry = await db.getEntry(id);
        if (!entry) {
            this.showToast('Entry not found', 'error');
            return;
        }

        // Populate form
        document.getElementById('entry-id').value = entry.id;
        document.getElementById('entry-date').value = entry.date;
        document.getElementById('entry-start').value = new Date(entry.startTime).toTimeString().slice(0, 5);
        document.getElementById('entry-end').value = new Date(entry.endTime).toTimeString().slice(0, 5);
        document.getElementById('entry-break').value = entry.breakDuration || 0;
        document.getElementById('entry-notes').value = entry.notes || '';

        this.closeModal();
        this.showView('add');
    }

    async deleteEntry(id) {
        if (!confirm('Are you sure you want to delete this entry?')) return;
        
        try {
            await db.deleteEntry(id);
            this.showToast('Entry deleted', 'success');
            this.updateDashboard();
            this.renderCalendar();
            this.renderLogs();
            this.closeModal();
        } catch (error) {
            this.showToast('Error deleting entry', 'error');
        }
    }

    // ==================== SETTINGS ====================

    async getSettings() {
        return {
            requiredHours: await db.getSetting('requiredHours', 300),
            dailyHours: await db.getSetting('dailyHours', 8),
            darkMode: await db.getSetting('darkMode', false),
            reminderEnabled: await db.getSetting('reminderEnabled', false)
        };
    }

    async loadSettings() {
        const settings = await this.getSettings();
        
        document.getElementById('setting-required').value = settings.requiredHours;
        document.getElementById('setting-daily').value = settings.dailyHours;
        document.getElementById('setting-darkmode').checked = settings.darkMode;
        document.getElementById('setting-reminder').checked = settings.reminderEnabled;
    }

    async saveSettings() {
        const required = parseInt(document.getElementById('setting-required').value) || 300;
        const daily = parseInt(document.getElementById('setting-daily').value) || 8;
        const darkMode = document.getElementById('setting-darkmode').checked;
        const reminder = document.getElementById('setting-reminder').checked;

        await db.setSetting('requiredHours', required);
        await db.setSetting('dailyHours', daily);
        await db.setSetting('darkMode', darkMode);
        await db.setSetting('reminderEnabled', reminder);

        // Apply theme immediately
        this.applyTheme(darkMode);
        
        // Setup/clear reminder
        if (reminder) this.scheduleReminder();
        else this.cancelReminder();

        this.showToast('Settings saved!', 'success');
        this.showView('dashboard');
    }

    openSettings() {
        this.showView('settings');
    }

    // ==================== THEME ====================

    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        this.applyTheme(savedTheme === 'dark');
    }

    applyTheme(isDark) {
        if (isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        }
    }

    toggleTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        this.applyTheme(!isDark);
    }

    // ==================== DATA EXPORT/IMPORT ====================

    async exportData() {
        try {
            const data = await db.exportAllData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `ojt-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showToast('Data exported successfully!', 'success');
        } catch (error) {
            this.showToast('Export failed: ' + error.message, 'error');
        }
    }

    async importData(input) {
        const file = input.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (confirm('This will replace all existing data. Continue?')) {
                await db.importData(data);
                this.showToast('Data imported successfully!', 'success');
                this.updateDashboard();
                this.renderCalendar();
                this.renderLogs();
            }
        } catch (error) {
            this.showToast('Import failed: ' + error.message, 'error');
        }
        
        input.value = ''; // Reset input
    }

    async clearAllData() {
        if (!confirm('WARNING: This will delete ALL your data. Are you sure?')) return;
        if (!confirm('This action cannot be undone. Type "yes" to confirm.')) return;
        
        try {
            await db.clearAllData();
            this.showToast('All data cleared', 'success');
            this.updateDashboard();
            this.renderCalendar();
            this.renderLogs();
        } catch (error) {
            this.showToast('Error clearing data', 'error');
        }
    }

    // ==================== NOTIFICATIONS ====================

    setupNotifications() {
        if ('Notification' in window) {
            Notification.requestPermission();
        }
    }

    async scheduleReminder() {
        // Simple reminder using setTimeout (in real app, use service worker push)
        const session = await db.getSession();
        if (!session) return;

        const now = new Date();
        const fivePM = new Date();
        fivePM.setHours(17, 0, 0, 0);
        
        if (fivePM > now) {
            const delay = fivePM - now;
            setTimeout(() => {
                this.showNotification('Still clocked in?', 'Don\'t forget to clock out when you finish work!');
            }, delay);
        }
    }

    cancelReminder() {
        // Clear any pending reminders (simplified)
    }

    showNotification(title, body) {
        if (Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: 'icons/icon-192x192.png',
                badge: 'icons/icon-72x72.png'
            });
        }
    }

    // ==================== INSTALL PROMPT ====================

    checkInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            
            // Show custom install prompt after 3 seconds
            setTimeout(() => {
                if (!window.matchMedia('(display-mode: standalone)').matches) {
                    document.getElementById('install-prompt').style.display = 'block';
                }
            }, 3000);
        });

        window.addEventListener('appinstalled', () => {
            this.deferredPrompt = null;
            document.getElementById('install-prompt').style.display = 'none';
            this.showToast('App installed successfully!', 'success');
        });
    }

    async installApp() {
        if (!this.deferredPrompt) return;
        
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            this.deferredPrompt = null;
            document.getElementById('install-prompt').style.display = 'none';
        }
    }

    dismissInstall() {
        document.getElementById('install-prompt').style.display = 'none';
    }

    // ==================== UTILITY ====================

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    setupEventListeners() {
        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        
        // Close modal on backdrop click
        document.getElementById('day-modal').addEventListener('click', (e) => {
            if (e.target.id === 'day-modal') this.closeModal();
        });
        
        // Handle visibility change (refresh when app comes back)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkActiveSession();
                this.updateDashboard();
            }
        });
    }
}

// Initialize app
const app = new OJTTracker();
